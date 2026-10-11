// Reise-Zeitleiste (Spezifikation 7.1): Flug-, Bahn-, Bus-, Hotel-, Mietwagen- und Veranstaltungsbuchungen aus Mails,
// gruppiert zu Reisen. Zuerst strukturierte Daten (schema.org JSON-LD, wie sie viele Anbieter einbetten), dann Muster
// für typische deutsche Bestätigungen. Alles per Code, ohne Netz. Plattformneutral.

import type { CalendarEvent } from "./calendar.js";

export type BookingKind = "flight" | "train" | "bus" | "hotel" | "car" | "event";

export interface TravelBooking {
  /** Stabiler Schlüssel (gleiche Buchung aus Bestätigung und Erinnerung nur einmal) */
  id: string;
  kind: BookingKind;
  /** Kurzer Titel: „LH 2034“, „ICE 581“, „Hotel Seeblick“ */
  title: string;
  /** Ortszeit: YYYY-MM-DDTHH:MM oder nur YYYY-MM-DD */
  start: string;
  end: string | null;
  /** Abfahrt/Abflug bzw. Abholung */
  from: string | null;
  /** Ziel bzw. Rückgabe */
  to: string | null;
  /** Hotel-/Veranstaltungsort bzw. Adresse */
  place: string | null;
  /** Buchungs-/Auftragsnummer */
  reference: string | null;
  source: "schema" | "text";
  canceled: boolean;
}

export interface StoredBooking extends TravelBooking {
  messageId: string | null;
  mailSubject: string;
}

export interface Trip {
  id: string;
  /** Ziel der Reise (erstes Ziel bzw. Hotelort) */
  title: string;
  start: string;
  end: string;
  bookings: StoredBooking[];
}

export interface TravelView {
  /** Laufende und kommende Reisen, früheste zuerst */
  upcoming: Trip[];
  /** Vergangene Reisen (letzte 90 Tage), neueste zuerst */
  past: Trip[];
}

export interface TravelApi {
  list(): Promise<TravelView>;
  /** Falsch erkannt – nicht mehr anzeigen */
  remove(bookingId: string): Promise<void>;
  /** Kalendereintrag (ICS) für eine Buchung öffnen – der Nutzer übernimmt ihn selbst */
  addToCalendar(bookingId: string): Promise<void>;
}

export const travelApiMethods = ["list", "remove", "addToCalendar"] as const satisfies readonly (keyof TravelApi)[];

/** Kalendereintrag für eine Buchung (Hotel: Check-in; ohne Uhrzeit ganztägig) */
export function bookingCalendarEvent(b: TravelBooking): CalendarEvent {
  const [date = b.start, time = null] = b.start.split("T") as [string, string | undefined];
  const minutes = b.end && b.end.includes("T") && time ? Math.max(15, Math.round((Date.parse(`${b.end}:00Z`) - Date.parse(`${b.start}:00Z`)) / 60_000)) : 60;
  const route = b.from && b.to ? `${b.from} → ${b.to}` : b.place ?? "";
  const kindLabel: Record<BookingKind, string> = { flight: "Flug", train: "Zug", bus: "Bus", hotel: "Check-in", car: "Mietwagen", event: "" };
  const title = [kindLabel[b.kind], b.title, b.kind === "hotel" || b.kind === "event" ? "" : route ? `(${route})` : ""].filter(Boolean).join(" ");
  return {
    uid: `travel-${b.id.replace(/[^A-Za-z0-9-]/g, "")}@stinkymail`,
    title,
    date,
    time: time ?? null,
    durationMinutes: b.kind === "hotel" ? 30 : minutes,
    description: [route, b.reference ? `Buchungsnummer: ${b.reference}` : ""].filter(Boolean).join("\n"),
    alarmMinutesBefore: b.kind === "flight" ? 180 : b.kind === "train" || b.kind === "bus" ? 60 : 120,
  };
}

// --- schema.org ---

type Json = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);
const obj = (v: unknown): Json | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null);
const nameOf = (v: unknown): string | null => str(v) ?? str(obj(v)?.name) ?? null;

/** „2026-11-14T07:25:00+01:00“ → „2026-11-14T07:25“ (Ortszeit, wie angegeben); nur Datum bleibt Datum */
function localTime(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/.exec(s);
  return m ? (m[2] ? `${m[1]}T${m[2]}` : (m[1] ?? null)) : null;
}

function placeOf(v: unknown): string | null {
  const o = obj(v);
  if (!o) return str(v);
  const code = str(o.iataCode);
  const name = str(o.name);
  const address = obj(o.address);
  const city = str(address?.addressLocality) ?? (typeof o.address === "string" ? o.address : null);
  if (name && code) return `${name} (${code})`;
  return name ?? code ?? city;
}

function addressOf(v: unknown): string | null {
  const o = obj(v);
  const a = obj(o?.address);
  if (!a) return str(o?.address);
  return [str(a.streetAddress), [str(a.postalCode), str(a.addressLocality)].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null;
}

function bookingFromSchema(o: Json): Omit<TravelBooking, "id"> | null {
  const type = String(o["@type"] ?? "");
  const r = obj(o.reservationFor) ?? {};
  const reference = str(o.reservationNumber) ?? str(o.reservationId);
  const canceled = /Cancel/i.test(String(obj(o.reservationStatus)?.["@id"] ?? o.reservationStatus ?? ""));
  const base = { reference, source: "schema" as const, canceled };
  switch (type) {
    case "FlightReservation": {
      const airline = obj(r.airline);
      const code = str(airline?.iataCode) ?? "";
      const number = str(r.flightNumber) ?? "";
      const start = localTime(r.departureTime);
      if (!start) return null;
      return { ...base, kind: "flight", title: `${code} ${number.replace(code, "")}`.trim() || "Flug", start, end: localTime(r.arrivalTime), from: placeOf(r.departureAirport), to: placeOf(r.arrivalAirport), place: null };
    }
    case "TrainReservation":
    case "BusReservation": {
      const start = localTime(r.departureTime);
      if (!start) return null;
      const number = str(r.trainNumber) ?? str(r.busNumber) ?? "";
      const company = nameOf(r.trainCompany) ?? nameOf(r.busCompany) ?? "";
      return {
        ...base, kind: type === "TrainReservation" ? "train" : "bus", title: [str(r.trainName), number].filter(Boolean).join(" ") || company || (type === "TrainReservation" ? "Zug" : "Bus"),
        start, end: localTime(r.arrivalTime), from: placeOf(r.departureStation ?? r.departureBusStop), to: placeOf(r.arrivalStation ?? r.arrivalBusStop), place: null,
      };
    }
    case "LodgingReservation": {
      const start = localTime(o.checkinTime ?? o.checkinDate);
      if (!start) return null;
      return { ...base, kind: "hotel", title: nameOf(r) ?? "Unterkunft", start, end: localTime(o.checkoutTime ?? o.checkoutDate), from: null, to: null, place: addressOf(r) };
    }
    case "RentalCarReservation": {
      const start = localTime(o.pickupTime);
      if (!start) return null;
      const car = obj(r);
      return { ...base, kind: "car", title: [nameOf(car?.rentalCompany) ?? nameOf(o.provider), nameOf(car)].filter(Boolean).join(" · ") || "Mietwagen", start, end: localTime(o.dropoffTime), from: placeOf(o.pickupLocation), to: placeOf(o.dropoffLocation), place: null };
    }
    case "EventReservation": {
      const start = localTime(r.startDate);
      if (!start) return null;
      return { ...base, kind: "event", title: nameOf(r) ?? "Veranstaltung", start, end: localTime(r.endDate), from: null, to: null, place: placeOf(r.location) };
    }
    default:
      return null;
  }
}

function schemaBookings(html: string): Omit<TravelBooking, "id">[] {
  const result: Omit<TravelBooking, "id">[] = [];
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse((match[1] ?? "").trim());
    } catch {
      continue;
    }
    const visit = (node: unknown) => {
      if (Array.isArray(node)) return node.forEach(visit);
      const o = obj(node);
      if (!o) return;
      if (Array.isArray(o["@graph"])) visit(o["@graph"]);
      if (/Reservation$/.test(String(o["@type"] ?? ""))) {
        const b = bookingFromSchema(o);
        if (b) result.push(b);
      }
    };
    visit(data);
  }
  return result;
}

// --- Text (deutsche Bestätigungen) ---

const dateRe = /(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})?/;
const timeRe = /(\d{1,2})[:.](\d{2})\s*(?:uhr)?/i;

function isoDate(m: RegExpExecArray | null, mailYear: number): string | null {
  if (!m) return null;
  const year = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : mailYear;
  const month = Number(m[2]);
  const day = Number(m[1]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const hhmm = (m: RegExpExecArray | null): string | null => (m ? `${String(Number(m[1])).padStart(2, "0")}:${m[2]}` : null);
const at = (date: string | null, time: string | null) => (date ? (time ? `${date}T${time}` : date) : null);

function referenceIn(text: string): string | null {
  const m = /(auftragsnummer|buchungsnummer|buchungscode|buchungsreferenz|reservierungsnummer|bestätigungsnummer|booking (?:reference|number)|confirmation (?:number|code)|pnr)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{4,14})\b/i.exec(text);
  return m?.[2]?.toUpperCase() ?? null;
}

/** Flug: „Flug LH 2034 … Frankfurt (FRA) → Wien (VIE) … 14.11.2026 07:25 – 08:55“ */
function flightFromText(text: string, year: number): Omit<TravelBooking, "id">[] {
  if (!/\b(flug|flight|abflug|boarding|check-in für ihren flug)\b/i.test(text)) return [];
  const result: Omit<TravelBooking, "id">[] = [];
  const flights = [...text.matchAll(/\b(?:flug(?:nummer)?|flight)\s*[:#]?\s*([A-Z]{2}|[A-Z]\d|\d[A-Z])\s?(\d{1,4})\b/gi)];
  for (const f of flights) {
    const segment = text.slice(f.index ?? 0, (f.index ?? 0) + 400);
    const route = /([\p{L}][\p{L} ./-]{1,30}?)\s*\(([A-Z]{3})\)[^\n(]{0,40}?(?:→|->|–|-|nach|to)\s*([\p{L}][\p{L} ./-]{1,30}?)\s*\(([A-Z]{3})\)/u.exec(segment) ?? /\b([A-Z]{3})\s*(?:→|->|–|-)\s*([A-Z]{3})\b/.exec(segment);
    const date = isoDate(dateRe.exec(segment), year);
    if (!date) continue;
    const afterDate = segment.slice((dateRe.exec(segment)?.index ?? 0) + 6);
    const times = [...afterDate.matchAll(new RegExp(timeRe.source, "gi"))].slice(0, 2).map((m) => `${String(Number(m[1])).padStart(2, "0")}:${m[2]}`);
    const from = route ? (route.length > 3 && route[4] ? `${(route[1] ?? "").trim()} (${route[2]})` : (route[1] ?? null)) : null;
    const to = route ? (route.length > 3 && route[4] ? `${(route[3] ?? "").trim()} (${route[4]})` : (route[2] ?? null)) : null;
    result.push({
      kind: "flight", title: `${(f[1] ?? "").toUpperCase()} ${f[2]}`, start: at(date, times[0] ?? null) ?? date, end: times[1] ? at(date, times[1]) : null,
      from, to, place: null, reference: referenceIn(text), source: "text", canceled: false,
    });
  }
  return result;
}

/** Bahn/Bus: „Hinfahrt am 12.11.2026 … Hamburg Hbf ab 08:12 … München Hbf an 14:01 … ICE 581“ (auch „ab Hamburg Hbf 08:12“) */
function trainFromText(text: string, year: number): Omit<TravelBooking, "id">[] {
  if (!/\b(fahrkarte|ticket|zugbindung|hinfahrt|rückfahrt|bahn|ice|flixbus|flixtrain|reiseverbindung)\b/i.test(text)) return [];
  const parts = text.split(/(?=\b(?:hinfahrt|rückfahrt|rueckfahrt)\b)/i).filter((p) => /\b(ab|an|abfahrt|ankunft)\b/i.test(p));
  const result: Omit<TravelBooking, "id">[] = [];
  for (const part of parts.length ? parts : [text]) {
    const date = isoDate(dateRe.exec(part), year);
    if (!date) continue;
    const dep = /([\p{L}][\p{L} .()/-]{1,40}?)\s+ab\s+(\d{1,2}[:.]\d{2})/u.exec(part) ?? /\b(?:ab|abfahrt)\s*:?\s+([\p{L}][\p{L} .()/-]{1,40}?),?\s+(\d{1,2}[:.]\d{2})/iu.exec(part);
    const arr = /([\p{L}][\p{L} .()/-]{1,40}?)\s+an\s+(\d{1,2}[:.]\d{2})/u.exec(part) ?? /\b(?:an|ankunft)\s*:?\s+([\p{L}][\p{L} .()/-]{1,40}?),?\s+(\d{1,2}[:.]\d{2})/iu.exec(part);
    if (!dep) continue;
    const train = /\b(ICE|IC|EC|ECE|RE|RB|S|TGV|RJX?|NJ|FLX|IRE)\s?(\d{1,5})\b/.exec(part);
    const bus = /\bflixbus\b/i.test(part) && !train;
    const clean = (s: string | undefined) => (s ?? "").replace(/^(von|nach|bahnhof)\s+/i, "").trim();
    const time = (s: string | undefined) => (s ? s.replace(".", ":").padStart(5, "0") : null);
    result.push({
      kind: bus ? "bus" : "train", title: train ? `${train[1]} ${train[2]}` : bus ? "FlixBus" : "Zug", start: at(date, time(dep[2])) ?? date, end: arr ? at(date, time(arr[2])) : null,
      from: clean(dep[1]), to: arr ? clean(arr[1]) : null, place: null, reference: referenceIn(text), source: "text", canceled: false,
    });
  }
  return result;
}

/** Hotel: „Anreise: 14.11.2026 (ab 15:00) … Abreise: 16.11.2026“; Name aus „Hotel …“ */
function hotelFromText(text: string, subject: string, year: number): Omit<TravelBooking, "id">[] {
  const arrival = /\b(anreise|check-in|ankunft)\s*[:\-]?\s*(?:\p{L}+,?\s*)?(\d{1,2}\.\d{1,2}\.(?:\d{4}|\d{2})?)/iu.exec(text);
  const departure = /\b(abreise|check-out|abfahrt)\s*[:\-]?\s*(?:\p{L}+,?\s*)?(\d{1,2}\.\d{1,2}\.(?:\d{4}|\d{2})?)/iu.exec(text);
  if (!arrival || !departure) return [];
  if (!/\b(hotel|pension|gasthof|hostel|unterkunft|ferienwohnung|apartment|zimmer|übernachtung)\b/i.test(`${subject}\n${text}`)) return [];
  const start = isoDate(dateRe.exec(arrival[2] ?? ""), year);
  const end = isoDate(dateRe.exec(departure[2] ?? ""), year);
  if (!start) return [];
  const checkin = /check-?in[^\n]{0,30}?(?:ab\s*)?(\d{1,2}[:.]\d{2})/i.exec(text) ?? /anreise[^\n]{0,40}?ab\s*(\d{1,2}[:.]\d{2})/i.exec(text);
  const name = /\b((?:Hotel|Pension|Gasthof|Hostel|Landhaus|Ferienwohnung|Apartment)\s[\p{L}][\p{L}\p{N}&' -]{1,40}?)(?=[,.\n!–-]|\s{2}|$| in | am )/u.exec(`${subject}\n${text}`);
  const address = /\b(?:adresse|anschrift)\s*:?\s*([^\n]{5,80})/i.exec(text);
  const time = checkin?.[1] ? checkin[1].replace(".", ":").padStart(5, "0") : null;
  return [{ kind: "hotel", title: name?.[1]?.trim() ?? "Unterkunft", start: at(start, time) ?? start, end, from: null, to: null, place: address?.[1]?.trim() ?? null, reference: referenceIn(text), source: "text", canceled: false }];
}

/** Mietwagen: „Abholung: Flughafen Wien, 14.11.2026, 09:00 … Rückgabe: …, 16.11.2026, 18:00“ */
function carFromText(text: string, year: number): Omit<TravelBooking, "id">[] {
  if (!/\b(mietwagen|autovermietung|car rental|fahrzeug)\b/i.test(text)) return [];
  const pickup = /\b(?:abholung|pick-?up)\s*:?\s*([^\n,]{2,50}),?\s*(?:am\s*)?(\d{1,2}\.\d{1,2}\.(?:\d{4}|\d{2})?)[^\n\d]{0,12}(\d{1,2}[:.]\d{2})?/i.exec(text);
  if (!pickup) return [];
  const dropoff = /\b(?:rückgabe|drop-?off)\s*:?\s*([^\n,]{2,50}),?\s*(?:am\s*)?(\d{1,2}\.\d{1,2}\.(?:\d{4}|\d{2})?)[^\n\d]{0,12}(\d{1,2}[:.]\d{2})?/i.exec(text);
  const start = isoDate(dateRe.exec(pickup[2] ?? ""), year);
  if (!start) return [];
  const end = dropoff ? isoDate(dateRe.exec(dropoff[2] ?? ""), year) : null;
  const company = /\b(Sixt|Europcar|Hertz|Avis|Enterprise|Buchbinder|Budget|Starcar)\b/.exec(text)?.[1];
  const t = (v: string | undefined) => (v ? v.replace(".", ":").padStart(5, "0") : null);
  return [{
    kind: "car", title: company ? `Mietwagen ${company}` : "Mietwagen", start: at(start, t(pickup[3])) ?? start, end: at(end, t(dropoff?.[3])),
    from: pickup[1]?.trim() ?? null, to: dropoff?.[1]?.trim() ?? null, place: null, reference: referenceIn(text), source: "text", canceled: false,
  }];
}

/** Stornierungsmail: Buchungsnummer, deren Buchungen storniert sind (auch wenn die Mail sonst keine Angaben enthält) */
export function cancellationReference(mail: { subject: string; bodyText: string | null; bodyHtml: string | null }): string | null {
  const text = `${mail.subject}\n${mail.bodyText ?? (mail.bodyHtml ?? "").replace(/<[^>]+>/g, " ")}`;
  if (!/\b(storniert|stornierung|annulliert|cancell?ed|cancellation)\b/i.test(text)) return null;
  return referenceIn(text);
}

export function bookingId(b: Omit<TravelBooking, "id">): string {
  const key = [b.kind, b.reference ?? "", b.start, b.title.toLowerCase().replace(/\s+/g, "")].join("|");
  return key;
}

/** Buchungen in einer Mail finden: strukturierte Daten zuerst, sonst Text */
export function findBookings(mail: { subject: string; bodyText: string | null; bodyHtml: string | null; date: string }): TravelBooking[] {
  const html = mail.bodyHtml ?? "";
  const fromSchema = html ? schemaBookings(html) : [];
  const text = `${mail.subject}\n${mail.bodyText ?? html.replace(/<(br|\/p|\/div|\/tr|\/li)[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ")}`;
  const year = new Date(mail.date).getFullYear();
  const canceled = /\b(storniert|stornierung bestätigt|wurde storniert|annulliert|cancell?ed|cancellation confirmed)\b/i.test(text);
  const found = fromSchema.length
    ? fromSchema
    : [...flightFromText(text, year), ...trainFromText(text, year), ...hotelFromText(text, mail.subject, year), ...carFromText(text, year)];
  const seen = new Set<string>();
  return found
    .map((b) => ({ ...b, canceled: b.canceled || canceled }))
    .map((b) => ({ ...b, id: bookingId(b) }))
    .filter((b) => (seen.has(b.id) ? false : (seen.add(b.id), true)));
}

/** Buchungen zu Reisen gruppieren: nahtlos aufeinanderfolgend (höchstens 2 Tage Lücke) = eine Reise */
export function groupTrips(bookings: StoredBooking[]): Trip[] {
  // Ohne Uhrzeit: Hotels gelten ab Nachmittag (Anreise nach dem Zug), sonst ab Tagesbeginn
  const sortKey = (b: StoredBooking) => (b.start.includes("T") ? b.start : `${b.start}T${b.kind === "hotel" ? "15:00" : "00:00"}`);
  const active = bookings.filter((b) => !b.canceled).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  const trips: Trip[] = [];
  const dayOf = (s: string) => s.slice(0, 10);
  const plusDays = (day: string, n: number) => {
    const d = new Date(`${day}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  for (const b of active) {
    const last = trips.at(-1);
    if (last && dayOf(b.start) <= plusDays(last.end, 2)) {
      last.bookings.push(b);
      const end = dayOf(b.end ?? b.start);
      if (end > last.end) last.end = end;
    } else {
      trips.push({ id: b.id, title: "", start: dayOf(b.start), end: dayOf(b.end ?? b.start), bookings: [b] });
    }
  }
  for (const trip of trips) trip.title = tripTitle(trip.bookings);
  return trips;
}

/** Ziel: erstes Ankunftsziel (Flug/Bahn/Bus) ohne Flughafen-Kürzel, sonst Hotel bzw. Veranstaltung */
function tripTitle(bookings: StoredBooking[]): string {
  const transport = bookings.find((b) => (b.kind === "flight" || b.kind === "train" || b.kind === "bus") && b.to);
  if (transport?.to) return transport.to.replace(/\s*\([A-Z]{3}\)$/, "").replace(/\s+(Hbf|Hauptbahnhof|Flughafen|Airport)$/i, "").trim();
  const stay = bookings.find((b) => b.kind === "hotel" || b.kind === "event");
  return stay?.title ?? bookings[0]?.title ?? "Reise";
}
