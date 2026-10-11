import type Database from "better-sqlite3";
import { findParcels, trackingUrlFor, type Carrier, type ParcelStatus, type ParcelsView, type StoredParcel } from "../parcels.js";
import { archiveDuplicate } from "./repository.js";

type Row = Record<string, unknown>;

/** Wie weit zurück Versandmails gelesen werden und wie lange Erledigtes sichtbar bleibt */
const scanDays = 120;
const doneVisibleDays = 14;
/** Ohne neue Mail so lange offen, danach gilt die Sendung als erledigt (Zustellmails fehlen oft) */
const staleDays = 30;

function parcelFromRow(r: Row): StoredParcel {
  const carrier = String(r.carrier) as Carrier;
  const number = String(r.trackingNumber);
  return {
    trackingNumber: number,
    carrier,
    status: String(r.status) as ParcelStatus,
    expected: r.expected ? String(r.expected) : null,
    shop: String(r.shop),
    subject: String(r.subject),
    firstSeen: String(r.firstSeen),
    updatedAt: String(r.updatedAt),
    messageId: r.messageId ? String(r.messageId) : null,
    trackingUrl: (r.trackingUrl ? String(r.trackingUrl) : null) ?? trackingUrlFor(carrier, number) ?? "",
    done: Number(r.done) === 1,
  };
}

/** Paket-Übersicht (W12.1): Suchlauf per Code über neue Mails und Liste. Schnell genug, um vor jeder Anzeige zu laufen. */
export class ParcelStore {
  constructor(private readonly db: Database.Database) {}

  /** Noch nicht gelesene Mails der letzten Monate durchsuchen; gibt die Zahl gelesener Mails zurück */
  scan(now: Date = new Date(), limit = 3000): number {
    const since = new Date(now.getTime() - scanDays * 86_400_000).toISOString();
    const rows = this.db
      .prepare(
        `SELECT message.id, message.fromName, message.fromAddress, message.subject, message.date,
                substr(message.bodyText, 1, 20000) AS bodyText, substr(message.bodyHTML, 1, 200000) AS bodyHtml
         FROM message JOIN mailbox ON mailbox.id = message.mailboxId
         LEFT JOIN parcelScan s ON s.messageId = message.id
         WHERE s.messageId IS NULL AND mailbox.role IN ('inbox', 'archive', 'custom') AND NOT ${archiveDuplicate} AND message.date >= ?
         ORDER BY message.date LIMIT ?`,
      )
      .all(since, limit) as Row[];
    if (rows.length === 0) return 0;
    const at = now.toISOString();
    const get = this.db.prepare("SELECT * FROM parcel WHERE trackingNumber = ?");
    const insert = this.db.prepare(
      `INSERT INTO parcel (trackingNumber, carrier, status, expected, shop, subject, firstSeen, updatedAt, messageId, trackingUrl, done, doneAt)
       VALUES (@trackingNumber, @carrier, @status, @expected, @shop, @subject, @date, @date, @messageId, @trackingUrl, @done, @doneAt)`,
    );
    const update = this.db.prepare(
      `UPDATE parcel SET status = @status, expected = COALESCE(@expected, expected), updatedAt = @date, messageId = @messageId,
         trackingUrl = COALESCE(trackingUrl, @trackingUrl), carrier = CASE WHEN carrier = 'other' THEN @carrier ELSE carrier END,
         done = CASE WHEN @status = 'delivered' THEN 1 ELSE done END, doneAt = CASE WHEN @status = 'delivered' THEN @date ELSE doneAt END
       WHERE trackingNumber = @trackingNumber`,
    );
    const mark = this.db.prepare("INSERT OR IGNORE INTO parcelScan (messageId, scannedAt) VALUES (?, ?)");
    this.db.transaction(() => {
      for (const r of rows) {
        const date = String(r.date);
        const findings = findParcels({
          from: { name: r.fromName ? String(r.fromName) : null, address: String(r.fromAddress) },
          subject: String(r.subject),
          bodyText: r.bodyText ? String(r.bodyText) : null,
          bodyHtml: r.bodyHtml ? String(r.bodyHtml) : null,
          date,
        });
        for (const f of findings) {
          const existing = get.get(f.trackingNumber) as Row | undefined;
          const values = {
            trackingNumber: f.trackingNumber, carrier: f.carrier, status: f.status, expected: f.expected, date, messageId: String(r.id),
            trackingUrl: f.trackingUrl, shop: String(r.fromName ?? "").trim() || String(r.fromAddress), subject: String(r.subject),
            done: f.status === "delivered" ? 1 : 0, doneAt: f.status === "delivered" ? date : null,
          };
          if (!existing) insert.run(values);
          // Ältere Mails (nachgeladen) ändern den Stand nicht; entfernte Sendungen bleiben entfernt
          else if (Number(existing.removed) !== 1 && date >= String(existing.updatedAt)) update.run(values);
        }
        mark.run(String(r.id), at);
      }
    })();
    return rows.length;
  }

  list(now: Date = new Date()): ParcelsView {
    const rows = (this.db.prepare("SELECT * FROM parcel WHERE removed = 0 ORDER BY updatedAt DESC").all() as Row[]).map((r) => ({ row: r, parcel: parcelFromRow(r) }));
    const doneSince = new Date(now.getTime() - doneVisibleDays * 86_400_000).toISOString();
    const staleBefore = new Date(now.getTime() - staleDays * 86_400_000).toISOString();
    const open: StoredParcel[] = [];
    const done: StoredParcel[] = [];
    for (const { row, parcel } of rows) {
      if (!parcel.done && parcel.updatedAt >= staleBefore) open.push(parcel);
      else if (parcel.done && String(row.doneAt ?? row.updatedAt) >= doneSince) done.push(parcel);
    }
    // Offene: was bald kommt zuerst (Termin), dann neueste
    open.sort((a, b) => (a.expected ?? "9999").localeCompare(b.expected ?? "9999") || b.updatedAt.localeCompare(a.updatedAt));
    return { open, done };
  }

  setDone(trackingNumber: string, done: boolean, at: string = new Date().toISOString()): void {
    this.db.prepare("UPDATE parcel SET done = ?, doneAt = ? WHERE trackingNumber = ?").run(done ? 1 : 0, done ? at : null, trackingNumber);
  }

  remove(trackingNumber: string): void {
    this.db.prepare("UPDATE parcel SET removed = 1 WHERE trackingNumber = ?").run(trackingNumber);
  }

  /** Offene Sendungen (für den Zähler in der Seitenleiste) */
  openCount(now: Date = new Date()): number {
    return this.list(now).open.length;
  }
}
