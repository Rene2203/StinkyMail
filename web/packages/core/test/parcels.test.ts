import { describe, expect, it } from "vitest";
import { expectedDate, findParcels, parcelStatus, trackingUrlFor } from "../src/index.js";

// Testdaten erfunden; Sendungsnummern ausgedacht.
const mail = (from: string, subject: string, bodyText: string | null, bodyHtml: string | null = null, date = "2026-10-08T09:00:00Z") => ({
  from: { name: null, address: from }, subject, bodyText, bodyHtml, date,
});

describe("Paket-Übersicht (W12.1): Erkennung", () => {
  it("DHL-Nummer mit Stichwort, auch mit Leerzeichen; Status unterwegs; Termin", () => {
    const [p] = findParcels(mail("versand@gartenland.example", "Ihre Bestellung ist unterwegs",
      "Hallo,\nIhre Bestellung 4471-B wurde an DHL übergeben.\nSendungsnummer: 0034 0434 1234 5678 9012\nVoraussichtliche Zustellung am 10.10.\n"));
    expect(p).toMatchObject({ trackingNumber: "00340434123456789012", carrier: "dhl", status: "inTransit", expected: "2026-10-10", source: "text" });
  });

  it("Link zur Sendungsverfolgung (Hermes, DPD, UPS) – Dienst aus dem Link", () => {
    const html = `<p>Dein Paket ist auf dem Weg.</p>
      <a href="https://www.myhermes.de/empfangen/sendungsverfolgung/sendungsinformation#H1000123456789012345">Sendung verfolgen</a>
      <a href="https://tracking.dpd.de/status/de_DE/parcel/01234567890123">DPD</a>
      <a href="https://www.ups.com/track?loc=de_DE&amp;tracknum=1Z999AA10123456784">UPS</a>`;
    const found = findParcels(mail("shop@moebel.example", "Versandbestätigung", null, html));
    expect(found.map((f) => [f.carrier, f.trackingNumber, f.source])).toEqual([
      ["hermes", "H1000123456789012345", "link"],
      ["dpd", "01234567890123", "link"],
      ["ups", "1Z999AA10123456784", "link"],
    ]);
    expect(found[1]?.trackingUrl).toBe("https://tracking.dpd.de/status/de_DE/parcel/01234567890123");
  });

  it("schema.org ParcelDelivery hat Vorrang (Status, Termin, Dienst)", () => {
    const html = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"ParcelDelivery",
      "trackingNumber":"JJD000390012345678901","provider":{"@type":"Organization","name":"DHL"},
      "deliveryStatus":{"@type":"OutForDelivery"},"expectedArrivalUntil":"2026-10-09T18:00:00+02:00"}</script><p>Heute bei dir</p>`;
    expect(findParcels(mail("info@shop.example", "Heute kommt dein Paket", null, html))).toEqual([
      { trackingNumber: "JJD000390012345678901", carrier: "dhl", status: "outForDelivery", expected: "2026-10-09", trackingUrl: null, source: "schema" },
    ]);
  });

  it("Amazon-, UPS- und Post-Nummern im Text, zugestellt, abholbereit", () => {
    expect(findParcels(mail("versand@amazon.example", "Zugestellt: Dein Paket", "Dein Paket wurde zugestellt. Sendungs-ID: TBA312345678901"))[0])
      .toMatchObject({ trackingNumber: "TBA312345678901", carrier: "amazon", status: "delivered" });
    expect(findParcels(mail("x@shop.example", "Versand", "Tracking number: 1Z999AA10123456784 – shipped with UPS"))[0])
      .toMatchObject({ carrier: "ups", status: "inTransit" });
    expect(findParcels(mail("noreply@dhl.example", "Abholbereit", "Ihre Sendung RR123456789DE liegt in der Filiale abholbereit. Sendungsnummer RR123456789DE"))[0])
      .toMatchObject({ trackingNumber: "RR123456789DE", carrier: "deutschePost", status: "pickup" });
  });

  it("Fallen: Bestell-, Kunden- und Rechnungsnummern, Newsletter mit DHL-Erwähnung", () => {
    expect(findParcels(mail("shop@x.example", "Bestellbestätigung", "Bestellnummer: 123456789012\nKundennummer 98765432\nVersand mit DHL in 2–3 Tagen."))).toEqual([]);
    expect(findParcels(mail("rechnung@stadtwerke.example", "Rechnung", "Rechnungsnummer 2026-100234\nVertragsnummer 4000123456"))).toEqual([]);
    expect(findParcels(mail("news@shop.example", "Gratis-Versand", "Jetzt mit DHL GoGreen versandkostenfrei bestellen! Gutscheincode 12345678"))).toEqual([]);
    // Telefonnummer neben dem Stichwort-Wort „Tracking“ ohne Ziffernfolge danach
    expect(findParcels(mail("a@b.example", "Tracking-Schutz", "Tracking ist bei uns aus. Hotline 0800 1234567"))).toEqual([]);
  });

  it("Status, Termin und Verfolgen-Link per Code", () => {
    expect(parcelStatus("Ihre Sendung wurde erfolgreich zugestellt.")).toBe("delivered");
    expect(parcelStatus("Zustellung nicht möglich – wir versuchen es morgen erneut.")).toBe("problem");
    expect(parcelStatus("Ihr Paket ist heute in Zustellung")).toBe("outForDelivery");
    expect(expectedDate("Lieferung voraussichtlich am Dienstag, 14. Oktober", "2026-10-11T10:00:00Z")).toBe("2026-10-14");
    expect(expectedDate("Zustellung voraussichtlich 05.01.", "2026-12-30T10:00:00Z")).toBe("2027-01-05");
    // Freitag 9.10. → „am Montag“ = 12.10.; „morgen“ = 10.10.
    expect(expectedDate("Voraussichtliche Zustellung am Montag.", "2026-10-09T10:00:00Z")).toBe("2026-10-12");
    expect(expectedDate("wird voraussichtlich morgen zugestellt", "2026-10-09T10:00:00Z")).toBe("2026-10-10");
    expect(trackingUrlFor("dhl", "00340434123456789012")).toBe("https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=00340434123456789012");
    expect(trackingUrlFor("amazon", "TBA1")).toBeNull();
  });
});

describe("Paket-Übersicht (W12.1): Speicher und Suchlauf", async () => {
  const { MailWriter, openDatabase, ParcelStore } = await import("../src/sqlite/index.js");
  it("legt Sendungen an, aktualisiert mit neueren Mails, zugestellt → erledigt, entfernt bleibt entfernt", () => {
    const db = openDatabase(":memory:");
    const writer = new MailWriter(db);
    writer.insertAccount({
      id: "acc", email: "anna@example.test", displayName: "Anna", provider: "imap", username: "anna@example.test",
      imapHost: "imap.example.test", imapPort: 993, imapSecurity: "tls", smtpHost: "smtp.example.test", smtpPort: 465, smtpSecurity: "tls",
      authType: "password", color: "blue", aiCloudAllowed: false, sortOrder: 0,
    });
    writer.upsertMailbox({ id: "acc/inbox", accountId: "acc", name: "INBOX", role: "inbox" });
    let uid = 0;
    const add = (fromName: string, subject: string, body: string, date: string) => {
      uid += 1;
      writer.insertMessage({
        id: `acc/inbox#1:${uid}`, accountId: "acc", mailboxId: "acc/inbox", uid, messageId: `<p${uid}@example.test>`, threadId: `t${uid}`, threadSubject: subject,
        from: { name: fromName, address: "versand@shop.example" }, to: [], cc: [], subject, date, snippet: "", bodyText: body, bodyHtml: null, flags: 0, attachments: [],
      });
    };
    const now = new Date("2026-10-11T12:00:00Z");
    add("Gartenland Versand", "Versandt", "Ihre Bestellung wurde an DHL übergeben. Sendungsnummer: 00340434123456789012. Zustellung voraussichtlich am 13.10.", "2026-10-09T08:00:00Z");
    add("Möbel Muster", "Unterwegs", "Mit Hermes unterwegs. Sendungsnummer: H1000123456789012345", "2026-10-10T08:00:00Z");
    add("Bestellshop", "Danke für die Bestellung", "Bestellnummer 123456789012", "2026-10-10T09:00:00Z");
    const store = new ParcelStore(db);
    expect(store.scan(now)).toBe(3);
    expect(store.scan(now)).toBe(0); // nichts doppelt
    let view = store.list(now);
    expect(view.open.map((p) => [p.trackingNumber, p.carrier, p.shop, p.expected])).toEqual([
      ["00340434123456789012", "dhl", "Gartenland Versand", "2026-10-13"],
      ["H1000123456789012345", "hermes", "Möbel Muster", null],
    ]);
    expect(view.open[0]?.trackingUrl).toContain("piececode=00340434123456789012");

    add("DHL", "Zugestellt", "Ihre Sendung 00340434123456789012 wurde zugestellt. Sendungsnummer 00340434123456789012", "2026-10-11T10:00:00Z");
    store.scan(now);
    view = store.list(now);
    expect(view.open.map((p) => p.trackingNumber)).toEqual(["H1000123456789012345"]);
    expect(view.done[0]).toMatchObject({ trackingNumber: "00340434123456789012", status: "delivered", done: true, shop: "Gartenland Versand" });

    store.remove("H1000123456789012345");
    add("Möbel Muster", "Heute", "Sendungsnummer: H1000123456789012345 – heute in Zustellung", "2026-10-11T11:00:00Z");
    store.scan(now);
    expect(store.list(now).open).toEqual([]);
    store.setDone("00340434123456789012", false);
    expect(store.list(now).open.map((p) => p.trackingNumber)).toEqual(["00340434123456789012"]);
    // Ohne neue Mail nach 30 Tagen nicht mehr offen
    expect(store.list(new Date("2026-11-20T12:00:00Z")).open).toEqual([]);
  });
});
