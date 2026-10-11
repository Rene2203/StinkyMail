import { describe, expect, it } from "vitest";
import { findBookings, groupTrips, type StoredBooking } from "../src/index.js";

// Testdaten erfunden (Buchungsnummern, Namen, Hotels); Flughafen-Kürzel nur als Format.
const mail = (subject: string, bodyText: string | null, bodyHtml: string | null = null, date = "2026-10-01T09:00:00Z") => ({ subject, bodyText, bodyHtml, date });

describe("Reise-Zeitleiste (W12.2): Erkennung", () => {
  it("schema.org: Flug, Hotel und Veranstaltung", () => {
    const html = `<script type="application/ld+json">[
      {"@context":"http://schema.org","@type":"FlightReservation","reservationNumber":"QX7K2P",
       "reservationFor":{"@type":"Flight","flightNumber":"2034","airline":{"@type":"Airline","name":"Beispiel Air","iataCode":"LH"},
       "departureAirport":{"@type":"Airport","name":"Frankfurt","iataCode":"FRA"},"departureTime":"2026-11-14T07:25:00+01:00",
       "arrivalAirport":{"@type":"Airport","name":"Wien","iataCode":"VIE"},"arrivalTime":"2026-11-14T08:55:00+01:00"}},
      {"@context":"http://schema.org","@type":"LodgingReservation","reservationNumber":"H-55120",
       "reservationFor":{"@type":"LodgingBusiness","name":"Hotel Donaublick","address":{"@type":"PostalAddress","streetAddress":"Uferweg 3","postalCode":"1020","addressLocality":"Wien"}},
       "checkinTime":"2026-11-14T15:00:00+01:00","checkoutTime":"2026-11-16T11:00:00+01:00"}]</script>`;
    const found = findBookings(mail("Ihre Reise nach Wien", null, html));
    expect(found.map(({ id, ...b }) => b)).toEqual([
      { kind: "flight", title: "LH 2034", start: "2026-11-14T07:25", end: "2026-11-14T08:55", from: "Frankfurt (FRA)", to: "Wien (VIE)", place: null, reference: "QX7K2P", source: "schema", canceled: false },
      { kind: "hotel", title: "Hotel Donaublick", start: "2026-11-14T15:00", end: "2026-11-16T11:00", from: null, to: null, place: "Uferweg 3, 1020 Wien", reference: "H-55120", source: "schema", canceled: false },
    ]);
    const event = findBookings(mail("Deine Tickets", null, `<script type="application/ld+json">{"@type":"EventReservation","reservationNumber":"T-9","reservationFor":{"@type":"Event","name":"Jazz im Park","startDate":"2026-11-15T19:30","location":{"@type":"Place","name":"Stadtpark Wien"}}}</script>`));
    expect(event[0]).toMatchObject({ kind: "event", title: "Jazz im Park", start: "2026-11-15T19:30", place: "Stadtpark Wien" });
  });

  it("Bahn-Bestätigung als Text: Hin- und Rückfahrt", () => {
    const text = `Ihre Buchungsbestätigung
Auftragsnummer: 8KX4TZ
Hinfahrt am 12.11.2026
Hamburg Hbf ab 08:12
München Hbf an 14:01
ICE 581
Rückfahrt am 15.11.2026
München Hbf ab 16:30
Hamburg Hbf an 22:41
ICE 600`;
    const found = findBookings(mail("Ihre Fahrkarte", text));
    expect(found.map((b) => [b.kind, b.title, b.start, b.end, b.from, b.to, b.reference])).toEqual([
      ["train", "ICE 581", "2026-11-12T08:12", "2026-11-12T14:01", "Hamburg Hbf", "München Hbf", "8KX4TZ"],
      ["train", "ICE 600", "2026-11-15T16:30", "2026-11-15T22:41", "München Hbf", "Hamburg Hbf", "8KX4TZ"],
    ]);
  });

  it("Flug, Hotel und Mietwagen als Text", () => {
    const flight = findBookings(mail("Buchungsbestätigung Ihres Fluges", "Buchungscode: PQ9X3Z\nFlug EW 2462 am 03.12.2026\nKöln/Bonn (CGN) → Palma (PMI)\nAbflug 06:05, Ankunft 08:20"));
    expect(flight[0]).toMatchObject({ kind: "flight", title: "EW 2462", start: "2026-12-03T06:05", end: "2026-12-03T08:20", from: "Köln/Bonn (CGN)", to: "Palma (PMI)", reference: "PQ9X3Z" });
    const hotel = findBookings(mail("Ihre Reservierung im Hotel Seeblick", "Vielen Dank für Ihre Buchung!\nAnreise: Fr, 03.12.2026 (Check-in ab 15:00)\nAbreise: So, 05.12.2026\nReservierungsnummer: 77812\nAdresse: Strandweg 1, Palma"));
    expect(hotel[0]).toMatchObject({ kind: "hotel", title: "Hotel Seeblick", start: "2026-12-03T15:00", end: "2026-12-05", place: "Strandweg 1, Palma", reference: "77812" });
    const car = findBookings(mail("Ihre Mietwagen-Reservierung", "Sixt – Ihr Fahrzeug ist reserviert.\nAbholung: Flughafen Palma, 03.12.2026, 09:00\nRückgabe: Flughafen Palma, 05.12.2026, 18:00"));
    expect(car[0]).toMatchObject({ kind: "car", title: "Mietwagen Sixt", start: "2026-12-03T09:00", end: "2026-12-05T18:00", from: "Flughafen Palma", to: "Flughafen Palma" });
  });

  it("Fallen: Werbung, Einladung mit „Anreise“, Bestellung – und Stornierung", () => {
    expect(findBookings(mail("Flüge ab 49 €", "Jetzt Flug buchen! Angebote bis 30.11.2026 – z. B. nach Palma ab 49 €."))).toEqual([]);
    expect(findBookings(mail("Einladung Sommerfest", "Anreise am besten mit der Bahn. Wir feiern am 12.07.2026 ab 15:00 im Garten."))).toEqual([]);
    expect(findBookings(mail("Bestellung versandt", "Lieferung am 12.11.2026. Sendungsnummer 00340434123456789012"))).toEqual([]);
    const canceled = findBookings(mail("Stornierung bestätigt", "Ihre Buchung wurde storniert.\nAuftragsnummer: 8KX4TZ\nHinfahrt am 12.11.2026\nHamburg Hbf ab 08:12\nMünchen Hbf an 14:01\nICE 581"));
    expect(canceled[0]).toMatchObject({ canceled: true, reference: "8KX4TZ" });
  });

  it("gruppiert zu Reisen: aufeinanderfolgend = eine Reise, Ziel aus dem ersten Ankunftsort", () => {
    const b = (kind: StoredBooking["kind"], start: string, end: string | null, to: string | null, title: string = kind): StoredBooking => ({
      id: `${kind}-${start}`, kind, title, start, end, from: null, to, place: null, reference: null, source: "text", canceled: false, messageId: null, mailSubject: "",
    });
    const trips = groupTrips([
      b("hotel", "2026-11-14T15:00", "2026-11-16T11:00", null, "Hotel Donaublick"),
      b("flight", "2026-11-14T07:25", "2026-11-14T08:55", "Wien (VIE)"),
      b("flight", "2026-11-16T18:00", null, "Frankfurt (FRA)"),
      b("train", "2026-12-20T08:00", "2026-12-20T12:00", "München Hbf"),
    ]);
    expect(trips.map((t) => [t.title, t.start, t.end, t.bookings.length])).toEqual([
      ["Wien", "2026-11-14", "2026-11-16", 3],
      ["München", "2026-12-20", "2026-12-20", 1],
    ]);
  });
});

describe("Reise-Zeitleiste (W12.2): Speicher und Kalender", async () => {
  const { MailWriter, openDatabase, TravelStore } = await import("../src/sqlite/index.js");
  const { bookingCalendarEvent, toICalendar } = await import("../src/index.js");
  it("liest Mails, führt Bestätigung und Erinnerung zusammen, Stornierung, kommende/vergangene Reisen", () => {
    const db = openDatabase(":memory:");
    const writer = new MailWriter(db);
    writer.insertAccount({
      id: "acc", email: "anna@example.test", displayName: "Anna", provider: "imap", username: "anna@example.test",
      imapHost: "imap.example.test", imapPort: 993, imapSecurity: "tls", smtpHost: "smtp.example.test", smtpPort: 465, smtpSecurity: "tls",
      authType: "password", color: "blue", aiCloudAllowed: false, sortOrder: 0,
    });
    writer.upsertMailbox({ id: "acc/inbox", accountId: "acc", name: "INBOX", role: "inbox" });
    let uid = 0;
    const add = (subject: string, body: string, date: string) => {
      uid += 1;
      writer.insertMessage({
        id: `acc/inbox#1:${uid}`, accountId: "acc", mailboxId: "acc/inbox", uid, messageId: `<r${uid}@example.test>`, threadId: `t${uid}`, threadSubject: subject,
        from: { name: "Bahn", address: "buchung@bahn.example" }, to: [], cc: [], subject, date, snippet: "", bodyText: body, bodyHtml: null, flags: 0, attachments: [],
      });
    };
    const train = "Auftragsnummer: 8KX4TZ\nHinfahrt am 12.11.2026\nHamburg Hbf ab 08:12\nMünchen Hbf an 14:01\nICE 581";
    add("Ihre Fahrkarte", train, "2026-10-01T09:00:00Z");
    add("Erinnerung an Ihre Reise", train, "2026-11-10T09:00:00Z");
    add("Ihre Reservierung im Hotel Isarblick", "Anreise: 12.11.2026\nAbreise: 14.11.2026\nReservierungsnummer: 4410", "2026-10-02T09:00:00Z");
    add("Ihre Fahrkarte", "Auftragsnummer: ZZ12AB\nHinfahrt am 03.09.2026\nKöln Hbf ab 10:00\nBerlin Hbf an 14:20\nICE 10", "2026-08-20T09:00:00Z");
    add("Ihre Fahrkarte", "Auftragsnummer: CC55DD\nHinfahrt am 20.12.2026\nHamburg Hbf ab 07:00\nHannover Hbf an 08:20\nICE 70", "2026-10-03T09:00:00Z");
    add("Stornierung bestätigt", "Ihre Buchung CC55DD wurde storniert. Auftragsnummer: CC55DD", "2026-10-04T09:00:00Z");
    const store = new TravelStore(db);
    const now = new Date("2026-10-11T12:00:00Z");
    expect(store.scan(now)).toBe(6);
    const view = store.list(now);
    expect(view.upcoming.map((t) => [t.title, t.start, t.end, t.bookings.map((b) => b.title)])).toEqual([["München", "2026-11-12", "2026-11-14", ["ICE 581", "Hotel Isarblick"]]]);
    expect(view.past.map((t) => t.title)).toEqual(["Berlin"]);
    const ice = view.upcoming[0]?.bookings[0];
    expect(ice?.mailSubject).toBe("Erinnerung an Ihre Reise");

    if (!ice) throw new Error("keine Buchung");
    const ics = toICalendar(bookingCalendarEvent(ice), now);
    expect(ics).toContain("SUMMARY:Zug ICE 581 (Hamburg Hbf → München Hbf)");
    expect(ics).toContain("DTSTART:20261112T081200");
    expect(ics).toContain("DTEND:20261112T140100");
    expect(ics).toContain("Buchungsnummer: 8KX4TZ");

    store.remove(ice.id);
    expect(store.list(now).upcoming[0]?.bookings.map((b) => b.title)).toEqual(["Hotel Isarblick"]);
  });
});
