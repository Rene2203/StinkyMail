import { describe, expect, it } from "vitest";
import { MessageFlag, trackerReport, type Account } from "../src/index.js";
import { MailWriter, openDatabase, StatsStore } from "../src/sqlite/index.js";

// Testdaten erfunden; Dienst-Domains nur als Erkennungsmerkmal.
const newsletter = `<p>Hallo!</p>
<img src="https://shop.example/logo.png" width="200" height="60">
<img src="https://mcusercontent.example/bild.jpg" width="600">
<img src="https://shop.us1.list-manage.com/track/open.php?u=1&amp;id=2" width="1" height="1">
<img src="https://stats.tracker.example/p.gif" width="1" height="1" style="display:none">
<img src="https://www.google-analytics.com/collect?v=1&amp;tid=UA-1" alt="">
<a href="https://shop.us1.list-manage.com/track/click?u=1">Zum Shop</a>
<a href="https://shop.example/angebot?utm_source=newsletter&amp;utm_medium=mail">Angebot</a>
<a href="https://shop.example/impressum">Impressum</a>`;

describe("Tracker-Report (W11.2)", () => {
  it("findet Zählpixel bekannter und unbekannter Dienste, ignoriert normale Bilder", () => {
    const report = trackerReport(newsletter);
    expect(report.pixels).toEqual([
      { service: "Mailchimp", host: "shop.us1.list-manage.com" },
      { service: "stats.tracker.example", host: "stats.tracker.example" },
      { service: "Google Analytics", host: "www.google-analytics.com" },
    ]);
    expect(report.trackedLinks).toBe(2);
    expect(report.services).toEqual(["Google Analytics", "Mailchimp", "stats.tracker.example"]);
    expect(trackerReport("<p>Ohne Bilder</p>")).toEqual({ pixels: [], trackedLinks: 0, services: [] });
    expect(trackerReport(null).pixels).toEqual([]);
  });

  it("merkt sich Pixel beim Abgleich und zeigt in der Statistik, wer trackt (auch alte Mails nachträglich)", () => {
    const db = openDatabase(":memory:");
    const writer = new MailWriter(db);
    const account: Account = {
      id: "acc", email: "anna@example.test", displayName: "Anna", provider: "imap", username: "anna@example.test",
      imapHost: "imap.example.test", imapPort: 993, imapSecurity: "tls", smtpHost: "smtp.example.test", smtpPort: 465, smtpSecurity: "tls",
      authType: "password", color: "blue", aiCloudAllowed: false, sortOrder: 0,
    };
    writer.insertAccount(account);
    writer.upsertMailbox({ id: "acc/inbox", accountId: "acc", name: "INBOX", role: "inbox" });
    const add = (uid: number, from: string, html: string | null) =>
      writer.insertMessage({
        id: `acc/inbox#1:${uid}`, accountId: "acc", mailboxId: "acc/inbox", uid, messageId: `<t${uid}@example.test>`, threadId: `t${uid}`, threadSubject: "x",
        from: { name: null, address: from }, to: [], cc: [], subject: "x", date: new Date(Date.now() - uid * 3_600_000).toISOString(), snippet: "", bodyText: null, bodyHtml: html,
        flags: MessageFlag.seen, attachments: [],
      });
    add(1, "news@shop.example", newsletter);
    add(2, "news@shop.example", newsletter);
    add(3, "lea@freunde.example", "<p>Hallo</p>");
    add(4, "info@verein.example", null);
    expect(db.prepare("SELECT trackers FROM message ORDER BY uid").all()).toEqual([
      { trackers: JSON.stringify(["Mailchimp", "stats.tracker.example", "Google Analytics"]) }, { trackers: JSON.stringify(["Mailchimp", "stats.tracker.example", "Google Analytics"]) }, { trackers: "" }, { trackers: "" },
    ]);
    // Wie eine Mail von vor der Migration: noch nicht geprüft
    db.prepare("UPDATE message SET trackers = NULL WHERE uid = 2").run();
    const tracking = new StatsStore(db).overview(30).tracking;
    expect(tracking.mails).toBe(2);
    expect(tracking.senders).toEqual([{ address: "news@shop.example", name: null, mails: 2, services: ["Google Analytics", "Mailchimp", "stats.tracker.example"] }]);
    expect(tracking.services[0]).toEqual({ service: "Google Analytics", mails: 2 });
  });
});
