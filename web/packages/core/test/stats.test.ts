import { describe, expect, it } from "vitest";
import { emptyRule, medianOf, MessageFlag, weekStart, type Account } from "../src/index.js";
import { MailWriter, openDatabase, PriorityStore, RuleStore, StatsStore } from "../src/sqlite/index.js";

// Testdaten erfunden.
function setup() {
  const db = openDatabase(":memory:");
  const writer = new MailWriter(db);
  const account: Account = {
    id: "acc", email: "anna@example.test", displayName: "Anna", provider: "imap", username: "anna@example.test",
    imapHost: "imap.example.test", imapPort: 993, imapSecurity: "tls", smtpHost: "smtp.example.test", smtpPort: 465, smtpSecurity: "tls",
    authType: "password", color: "blue", aiCloudAllowed: false, sortOrder: 0,
  };
  writer.insertAccount(account);
  writer.upsertMailbox({ id: "acc/inbox", accountId: "acc", name: "INBOX", role: "inbox" });
  writer.upsertMailbox({ id: "acc/sent", accountId: "acc", name: "Sent", role: "sent" });
  writer.upsertMailbox({ id: "acc/spam", accountId: "acc", name: "Spam", role: "spam" });
  let uid = 0;
  const add = (o: { box?: string; from: string; to?: string; date: Date; flags?: number; category?: "newsletter" | "personal" | "notification" | null; unsub?: string | null; thread?: string }) => {
    uid += 1;
    const box = o.box ?? "inbox";
    const id = `acc/${box}#1:${uid}`;
    writer.insertMessage({
      id, accountId: "acc", mailboxId: `acc/${box}`, uid, messageId: `<m${uid}@example.test>`, threadId: o.thread ?? `t${uid}`, threadSubject: "Betreff",
      from: { name: null, address: o.from }, to: [{ name: null, address: o.to ?? "anna@example.test" }], cc: [], subject: "Betreff", date: o.date.toISOString(),
      snippet: "", bodyText: null, bodyHtml: null, flags: o.flags ?? 0, category: o.category ?? null, listUnsubscribe: o.unsub === undefined ? "" : o.unsub, attachments: [],
    });
    return id;
  };
  return { db, add, store: new StatsStore(db) };
}

const now = new Date(2026, 9, 3, 12);
const daysAgo = (d: number, hour = 9) => {
  const date = new Date(now);
  date.setDate(date.getDate() - d);
  date.setHours(hour, 0, 0, 0);
  return date;
};
const unsub = JSON.stringify({ http: "https://news.example/abmelden", mailto: null, oneClick: true });

describe("Postfach-Statistik (W10.1)", () => {
  it("Hilfsfunktionen: Median und Wochenbeginn", () => {
    expect(medianOf([])).toBeNull();
    expect(medianOf([3, 1, 2])).toBe(2);
    expect(medianOf([1, 2, 3, 10])).toBe(2.5);
    expect(weekStart(new Date(2026, 9, 4, 23))).toBe("2026-09-28"); // Sonntag → Montag davor
    expect(weekStart(new Date(2026, 9, 5, 0, 30))).toBe("2026-10-05");
  });

  it("zählt Mails, Wochen, Absender, Antwortzeit und lässt Spam außen vor", () => {
    const { add, store } = setup();
    for (let i = 0; i < 4; i++) add({ from: "news@shop.example", date: daysAgo(i * 7 + 1), category: "newsletter", unsub });
    add({ from: "lea@freunde.example", date: daysAgo(2, 8), flags: MessageFlag.seen | MessageFlag.answered, category: "personal", thread: "ta" });
    add({ box: "sent", from: "anna@example.test", to: "lea@freunde.example", date: daysAgo(2, 10), thread: "ta" });
    add({ from: "lea@freunde.example", date: daysAgo(5, 8), flags: MessageFlag.seen, thread: "tb" });
    add({ box: "sent", from: "anna@example.test", to: "lea@freunde.example", date: daysAgo(4, 8), thread: "tb" });
    add({ from: "lea@freunde.example", date: daysAgo(9, 8), flags: MessageFlag.seen, thread: "tc" });
    add({ box: "sent", from: "anna@example.test", to: "lea@freunde.example", date: daysAgo(9, 12), thread: "tc" });
    add({ box: "spam", from: "x@spam.example", date: daysAgo(1) });
    add({ from: "alt@archiv.example", date: daysAgo(60) });

    const stats = store.overview(30, now);
    expect(stats.received).toBe(7);
    expect(stats.sent).toBe(3);
    expect(stats.unreadShare).toBeCloseTo(4 / 7);
    expect(stats.weeks.reduce((n, w) => n + w.received, 0)).toBe(7);
    expect(stats.weeks.reduce((n, w) => n + w.sent, 0)).toBe(3);
    expect(stats.weeks.length).toBeGreaterThanOrEqual(5);
    expect(stats.topSenders[0]).toMatchObject({ address: "news@shop.example", received: 4, read: 0 });
    expect(stats.topSenders[1]).toMatchObject({ address: "lea@freunde.example", received: 3, read: 3, replied: 1 });
    expect(stats.categories[0]).toEqual({ category: "newsletter", count: 4 });
    // Antwortzeiten 2 h, 24 h, 4 h → Median 4 h, zwei am selben Tag
    expect(stats.myReply).toEqual({ medianHours: 4, sameDayShare: 2 / 3, count: 3 });
    expect(stats.busiestHour).toBe(9);
    expect(stats.busiestWeekday).not.toBeNull();
    expect(store.overview(365, now).received).toBe(8);
  });

  it("Mail-Diät: schlägt ungelesene Newsletter zum Abbestellen und Massenmails zum Archivieren vor", () => {
    const { db, add, store } = setup();
    const ids = [0, 1, 2, 3].map((i) => add({ from: "news@shop.example", date: daysAgo(i * 3 + 1), category: "newsletter", unsub }));
    for (let i = 0; i < 6; i++) add({ from: "info@paket.example", date: daysAgo(i * 2 + 1), category: "notification" });
    // gelesen → kein Vorschlag
    for (let i = 0; i < 4; i++) add({ from: "brief@lesenswert.example", date: daysAgo(i + 1), flags: MessageFlag.seen, category: "newsletter", unsub });
    // wichtig markiert, persönlich, angeschrieben → nie
    for (let i = 0; i < 6; i++) add({ from: "chef@firma.example", date: daysAgo(i + 1) });
    for (let i = 0; i < 6; i++) add({ from: "oma@familie.example", date: daysAgo(i + 1), category: "personal" });
    for (let i = 0; i < 6; i++) add({ from: "verein@club.example", date: daysAgo(i + 1) });
    add({ box: "sent", from: "anna@example.test", to: "Verein@club.example", date: daysAgo(3) });
    db.prepare("INSERT INTO senderProfile (address, domain, userPriority) VALUES ('chef@firma.example', 'firma.example', 1)").run();
    // nur zwei Mails → zu wenig
    for (let i = 0; i < 2; i++) add({ from: "selten@shop.example", date: daysAgo(i + 1), category: "newsletter", unsub });
    // ältere Mails ohne gelesene Abmelde-Angabe: Newsletter zählt als abbestellbar
    for (let i = 0; i < 3; i++) add({ from: "alt@magazin.example", date: daysAgo(i + 1), category: "newsletter", unsub: null });
    new PriorityStore(db).record("trash", [ids[0] ?? ""], now.toISOString());

    let suggestions = store.overview(30, now).suggestions;
    expect(suggestions.map((s) => s.key)).toEqual(["autoArchive:info@paket.example", "unsubscribe:news@shop.example", "unsubscribe:alt@magazin.example"]);
    const news = suggestions.find((s) => s.address === "news@shop.example");
    expect(news).toMatchObject({ received: 4, read: 0, trashedUnread: 1 });
    expect(news?.messageId).toBe(ids[0]);

    // Regel deckt den Absender ab → kein Vorschlag mehr; ausblenden und wieder zeigen
    new RuleStore(db).insert({ id: "r1", text: "Paket ins Archiv", accountId: null, definition: { ...emptyRule, from: ["paket.example"], move: "archive" }, enabled: true, createdAt: now.toISOString() });
    store.dismiss("unsubscribe:alt@magazin.example");
    suggestions = store.overview(30, now).suggestions;
    expect(suggestions.map((s) => s.key)).toEqual(["unsubscribe:news@shop.example"]);
    store.resetDismissed();
    expect(store.overview(30, now).suggestions).toHaveLength(2);

    // schon abbestellt → kein Vorschlag
    db.prepare("INSERT INTO unsubscribed (address, method, requestedAt) VALUES ('news@shop.example', 'oneClick', ?)").run(now.toISOString());
    expect(store.overview(30, now).suggestions.map((s) => s.address)).toEqual(["alt@magazin.example"]);
  });
});
