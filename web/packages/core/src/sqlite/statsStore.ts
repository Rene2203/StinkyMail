import type Database from "better-sqlite3";
import { MessageFlag } from "../models.js";
import type { RuleDefinition } from "../rules.js";
import { dietThresholds, medianOf, weekStart, type DietSuggestion, type MailboxStats, type SenderStat, type StatsPeriod } from "../stats.js";
import { archiveDuplicate } from "./repository.js";

type Row = Record<string, unknown>;

/** Erhaltene Mails: Posteingang, Archiv, eigene Ordner – ohne Gesendet, Entwürfe, Spam, Papierkorb. */
const receivedWhere = `mailbox.role IN ('inbox', 'archive', 'custom') AND NOT ${archiveDuplicate}`;

interface SenderAgg extends SenderStat {
  newest: string;
  newestId: string;
  /** true/false; null = Abmelde-Angabe noch nicht gelesen (ältere Mails) */
  hasUnsubscribe: boolean | null;
  personal: boolean;
  bulk: boolean;
}

/** Postfach-Statistik und Mail-Diät (W10.1). Nur Lesen, außer dem Ausblenden von Vorschlägen. */
export class StatsStore {
  constructor(private readonly db: Database.Database) {}

  overview(period: StatsPeriod, now: Date = new Date()): MailboxStats {
    const since = new Date(now.getTime() - period * 86_400_000).toISOString();

    // Wochen vorbelegen, damit leere Wochen als 0 erscheinen
    const weeks = new Map<string, { week: string; received: number; sent: number }>();
    for (let t = new Date(since).getTime(); t <= now.getTime(); t += 7 * 86_400_000) {
      const w = weekStart(new Date(t));
      weeks.set(w, { week: w, received: 0, sent: 0 });
    }
    const nowWeek = weekStart(now);
    if (!weeks.has(nowWeek)) weeks.set(nowWeek, { week: nowWeek, received: 0, sent: 0 });

    const senders = new Map<string, SenderAgg>();
    const categories = new Map<string, number>();
    const weekdays = new Array<number>(8).fill(0);
    const hours = new Array<number>(24).fill(0);
    let received = 0;
    let unread = 0;

    const rows = this.db
      .prepare(
        `SELECT message.id, message.fromName, message.fromAddress, message.date, message.flags, message.category,
                message.listUnsubscribe
         FROM message JOIN mailbox ON mailbox.id = message.mailboxId
         WHERE ${receivedWhere} AND message.date >= ?`,
      )
      .iterate(since) as IterableIterator<Row>;
    for (const r of rows) {
      const date = new Date(String(r.date));
      if (Number.isNaN(date.getTime())) continue;
      const flags = Number(r.flags);
      const seen = (flags & MessageFlag.seen) !== 0;
      received += 1;
      if (!seen) unread += 1;
      const week = weeks.get(weekStart(date));
      if (week) week.received += 1;
      weekdays[((date.getDay() + 6) % 7) + 1] = (weekdays[((date.getDay() + 6) % 7) + 1] ?? 0) + 1;
      hours[date.getHours()] = (hours[date.getHours()] ?? 0) + 1;
      const category = r.category ? String(r.category) : "uncategorized";
      categories.set(category, (categories.get(category) ?? 0) + 1);

      const address = String(r.fromAddress).toLowerCase();
      if (!address) continue;
      let s = senders.get(address);
      if (!s) {
        s = { address, name: null, received: 0, read: 0, replied: 0, newest: "", newestId: "", hasUnsubscribe: false, personal: false, bulk: false };
        senders.set(address, s);
      }
      s.received += 1;
      if (seen) s.read += 1;
      if ((flags & MessageFlag.answered) !== 0) s.replied += 1;
      if (r.category === "personal") s.personal = true;
      if (r.category === "newsletter") s.bulk = true;
      const iso = date.toISOString();
      if (iso > s.newest) {
        s.newest = iso;
        s.newestId = String(r.id);
        s.hasUnsubscribe = hasUnsubscribeHeader(r.listUnsubscribe);
        const name = r.fromName ? String(r.fromName).trim() : "";
        if (name) s.name = name;
      }
    }

    let sent = 0;
    for (const r of this.db
      .prepare(`SELECT message.date FROM message JOIN mailbox ON mailbox.id = message.mailboxId WHERE mailbox.role = 'sent' AND message.date >= ?`)
      .all(since) as Row[]) {
      const date = new Date(String(r.date));
      if (Number.isNaN(date.getTime())) continue;
      sent += 1;
      const week = weeks.get(weekStart(date));
      if (week) week.sent += 1;
    }

    const topSenders = [...senders.values()]
      .sort((a, b) => b.received - a.received || a.address.localeCompare(b.address))
      .slice(0, 10)
      .map(({ address, name, received: n, read, replied }) => ({ address, name, received: n, read, replied }));

    return {
      period,
      since,
      received,
      sent,
      unreadShare: received ? unread / received : 0,
      weeks: [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week)),
      topSenders,
      categories: [...categories.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count || a.category.localeCompare(b.category)),
      myReply: this.#myReply(since),
      busiestWeekday: maxIndex(weekdays, 1),
      busiestHour: maxIndex(hours, 0),
      suggestions: this.#suggestions(senders, since),
    };
  }

  /** Antwortzeit: je gesendeter Mail die letzte erhaltene Mail im selben Verlauf davor (höchstens 30 Tage zurück). */
  #myReply(since: string): MailboxStats["myReply"] {
    const rows = this.db
      .prepare(
        `SELECT s.date AS sentDate,
                (SELECT max(m.date) FROM message m JOIN mailbox mb ON mb.id = m.mailboxId
                 WHERE m.threadId = s.threadId AND mb.role IN ('inbox', 'archive', 'custom') AND m.date < s.date) AS receivedDate
         FROM message s JOIN mailbox ON mailbox.id = s.mailboxId
         WHERE mailbox.role = 'sent' AND s.date >= ?`,
      )
      .all(since) as Row[];
    const delays: number[] = [];
    let sameDay = 0;
    for (const r of rows) {
      if (!r.receivedDate) continue;
      const got = new Date(String(r.receivedDate));
      const answered = new Date(String(r.sentDate));
      const hours = (answered.getTime() - got.getTime()) / 3_600_000;
      if (!(hours >= 0) || hours > 30 * 24) continue;
      delays.push(hours);
      if (got.toDateString() === answered.toDateString()) sameDay += 1;
    }
    const median = medianOf(delays);
    if (median === null || delays.length < 3) return null;
    return { medianHours: median, sameDayShare: sameDay / delays.length, count: delays.length };
  }

  #suggestions(senders: Map<string, SenderAgg>, since: string): DietSuggestion[] {
    const dismissed = new Set((this.db.prepare("SELECT key FROM dietDismissed").all() as Row[]).map((r) => String(r.key)));
    const important = new Set(
      (this.db.prepare("SELECT lower(address) AS a FROM senderProfile WHERE userPriority = 1").all() as Row[]).map((r) => String(r.a)),
    );
    const unsubscribed = new Set((this.db.prepare("SELECT lower(address) AS a FROM unsubscribed").all() as Row[]).map((r) => String(r.a)));
    const writtenTo = new Set(
      (
        this.db
          .prepare(
            `SELECT DISTINCT lower(json_extract(r.value, '$.address')) AS a
             FROM message JOIN mailbox ON mailbox.id = message.mailboxId, json_each(message."to") AS r WHERE mailbox.role = 'sent'`,
          )
          .all() as Row[]
      ).map((r) => String(r.a)),
    );
    const ruleFrom = (this.db.prepare("SELECT definition FROM mailRule WHERE enabled = 1").all() as Row[]).flatMap((r) => {
      try {
        const definition = JSON.parse(String(r.definition)) as Partial<RuleDefinition>;
        return (definition.from ?? []).map((f) => f.toLowerCase()).filter(Boolean);
      } catch {
        return [];
      }
    });
    const trashed = new Map<string, number>();
    for (const r of this.db
      .prepare(
        `SELECT json_extract(metadata, '$.from') AS a, COUNT(*) AS n FROM behaviorEvent
         WHERE type = 'trash' AND json_valid(metadata) AND json_extract(metadata, '$.unread') AND timestamp >= ? GROUP BY 1`,
      )
      .all(since) as Row[]) {
      trashed.set(String(r.a ?? "").toLowerCase(), Number(r.n));
    }

    const result: DietSuggestion[] = [];
    for (const s of senders.values()) {
      if (s.received < dietThresholds.minMails) continue;
      if (important.has(s.address) || writtenTo.has(s.address) || s.personal || s.replied > 0) continue;
      const name = (s.name ?? "").toLowerCase();
      if (ruleFrom.some((f) => s.address.includes(f) || (name && name.includes(f)))) continue;
      const readShare = s.read / s.received;
      // Ohne gelesene Angabe: Newsletter/Werbung vermutlich abbestellbar – die Leiste prüft es beim Klick
      const canUnsubscribe = s.hasUnsubscribe ?? s.bulk;
      let kind: DietSuggestion["kind"] | null = null;
      if (canUnsubscribe && !unsubscribed.has(s.address) && readShare <= dietThresholds.maxReadShareUnsubscribe) kind = "unsubscribe";
      else if (!canUnsubscribe && s.received >= dietThresholds.minMailsArchive && readShare <= dietThresholds.maxReadShareArchive) kind = "autoArchive";
      if (!kind) continue;
      const key = `${kind}:${s.address}`;
      if (dismissed.has(key)) continue;
      result.push({ key, kind, address: s.address, name: s.name, received: s.received, read: s.read, trashedUnread: trashed.get(s.address) ?? 0, messageId: s.newestId });
    }
    return result.sort((a, b) => b.received - a.received || a.address.localeCompare(b.address));
  }

  dismiss(key: string, at: string = new Date().toISOString()): void {
    this.db.prepare("INSERT INTO dietDismissed (key, dismissedAt) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET dismissedAt = excluded.dismissedAt").run(key, at);
  }

  resetDismissed(): void {
    this.db.prepare("DELETE FROM dietDismissed").run();
  }
}

/** listUnsubscribe: null = noch nicht gelesen, '' oder '[]' = keine Angabe */
function hasUnsubscribeHeader(raw: unknown): boolean | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  return text !== "" && text !== "[]" && text !== "{}" && text !== "null";
}

function maxIndex(values: number[], offset: number): number | null {
  let best = -1;
  let bestValue = 0;
  values.forEach((v, i) => {
    if (i >= offset && v > bestValue) {
      best = i;
      bestValue = v;
    }
  });
  return best >= 0 ? best : null;
}
