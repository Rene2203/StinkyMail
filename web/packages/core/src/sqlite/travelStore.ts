import type Database from "better-sqlite3";
import { cancellationReference, findBookings, groupTrips, type BookingKind, type StoredBooking, type TravelView } from "../travel.js";
import { archiveDuplicate } from "./repository.js";

type Row = Record<string, unknown>;

/** Buchungen kommen oft Monate vorher – ein Jahr zurück lesen; Vergangenes 90 Tage zeigen */
const scanDays = 365;
const pastDays = 90;

function bookingFromRow(r: Row): StoredBooking {
  const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
  return {
    id: String(r.id), kind: String(r.kind) as BookingKind, title: String(r.title), start: String(r.start), end: s(r.end),
    from: s(r.origin), to: s(r.destination), place: s(r.place), reference: s(r.reference), source: String(r.source) as "schema" | "text",
    canceled: Number(r.canceled) === 1, messageId: s(r.messageId), mailSubject: String(r.mailSubject),
  };
}

/** Reise-Zeitleiste (W12.2): Suchlauf per Code und Reisen. */
export class TravelStore {
  constructor(private readonly db: Database.Database) {}

  scan(now: Date = new Date(), limit = 3000): number {
    const since = new Date(now.getTime() - scanDays * 86_400_000).toISOString();
    const rows = this.db
      .prepare(
        `SELECT message.id, message.subject, message.date, substr(message.bodyText, 1, 20000) AS bodyText, substr(message.bodyHTML, 1, 300000) AS bodyHtml
         FROM message JOIN mailbox ON mailbox.id = message.mailboxId
         LEFT JOIN travelScan s ON s.messageId = message.id
         WHERE s.messageId IS NULL AND mailbox.role IN ('inbox', 'archive', 'custom') AND NOT ${archiveDuplicate} AND message.date >= ?
         ORDER BY message.date LIMIT ?`,
      )
      .all(since, limit) as Row[];
    if (rows.length === 0) return 0;
    const upsert = this.db.prepare(
      `INSERT INTO travelBooking (id, kind, title, start, "end", origin, destination, place, reference, source, canceled, messageId, mailSubject, updatedAt)
       VALUES (@id, @kind, @title, @start, @end, @from, @to, @place, @reference, @source, @canceled, @messageId, @mailSubject, @updatedAt)
       ON CONFLICT(id) DO UPDATE SET
         "end" = COALESCE(excluded."end", "end"), origin = COALESCE(excluded.origin, origin), destination = COALESCE(excluded.destination, destination),
         place = COALESCE(excluded.place, place), canceled = MAX(canceled, excluded.canceled), messageId = excluded.messageId,
         mailSubject = excluded.mailSubject, updatedAt = excluded.updatedAt
       WHERE excluded.updatedAt >= travelBooking.updatedAt`,
    );
    // Stornierung ohne vollständige Angaben: alle Buchungen mit derselben Buchungsnummer
    const cancelByReference = this.db.prepare("UPDATE travelBooking SET canceled = 1 WHERE reference = ?");
    const mark = this.db.prepare("INSERT OR IGNORE INTO travelScan (messageId, scannedAt) VALUES (?, ?)");
    const at = now.toISOString();
    this.db.transaction(() => {
      for (const r of rows) {
        const date = String(r.date);
        const bookings = findBookings({ subject: String(r.subject), bodyText: r.bodyText ? String(r.bodyText) : null, bodyHtml: r.bodyHtml ? String(r.bodyHtml) : null, date });
        const canceledReference = cancellationReference({ subject: String(r.subject), bodyText: r.bodyText ? String(r.bodyText) : null, bodyHtml: r.bodyHtml ? String(r.bodyHtml) : null });
        if (canceledReference) cancelByReference.run(canceledReference);
        for (const b of bookings) {
          upsert.run({ ...b, canceled: b.canceled ? 1 : 0, messageId: String(r.id), mailSubject: String(r.subject), updatedAt: date });
          if (b.canceled && b.reference) cancelByReference.run(b.reference);
        }
        mark.run(String(r.id), at);
      }
    })();
    return rows.length;
  }

  list(now: Date = new Date()): TravelView {
    const pad = (n: number) => String(n).padStart(2, "0");
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const pastLimit = new Date(now.getTime() - pastDays * 86_400_000).toISOString().slice(0, 10);
    const bookings = (this.db.prepare("SELECT * FROM travelBooking WHERE removed = 0 AND start >= ? ORDER BY start").all(pastLimit) as Row[]).map(bookingFromRow);
    const trips = groupTrips(bookings);
    return {
      upcoming: trips.filter((t) => t.end >= today),
      past: trips.filter((t) => t.end < today).reverse(),
    };
  }

  booking(id: string): StoredBooking | null {
    const row = this.db.prepare("SELECT * FROM travelBooking WHERE id = ?").get(id) as Row | undefined;
    return row ? bookingFromRow(row) : null;
  }

  remove(id: string): void {
    this.db.prepare("UPDATE travelBooking SET removed = 1 WHERE id = ?").run(id);
  }
}
