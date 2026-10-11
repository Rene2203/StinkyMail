// Paket-Übersicht (Spezifikation 7.1): Sendungsnummern aus Versandmails – zuerst schema.org (`ParcelDelivery`), dann
// Links zur Sendungsverfolgung, dann Muster je Paketdienst mit Stichwort davor. Status per Code aus dem Text.
// Ohne KI und ohne Netz: der Status kommt nur aus den Mails (Live-Abfrage beim Paketdienst wäre ein späteres Opt-in,
// weil dafür die Sendungsnummer das Gerät verlässt). Plattformneutral.

export type Carrier = "dhl" | "deutschePost" | "hermes" | "dpd" | "gls" | "ups" | "fedex" | "amazon" | "gofo" | "other";
export type ParcelStatus = "announced" | "inTransit" | "outForDelivery" | "pickup" | "delivered" | "problem";

export interface ParcelFinding {
  trackingNumber: string;
  carrier: Carrier;
  status: ParcelStatus;
  /** Voraussichtliche Zustellung (YYYY-MM-DD), wenn im Text genannt */
  expected: string | null;
  /** Link zur Sendungsverfolgung aus der Mail (nur https) */
  trackingUrl: string | null;
  /** Woher: strukturierte Daten, Link oder Text */
  source: "schema" | "link" | "text";
}

export interface StoredParcel {
  trackingNumber: string;
  carrier: Carrier;
  status: ParcelStatus;
  expected: string | null;
  /** Shop bzw. Absender der ersten Mail (z. B. „Gartenland Versand“) */
  shop: string;
  subject: string;
  firstSeen: string;
  updatedAt: string;
  /** Neueste Mail zu dieser Sendung */
  messageId: string | null;
  trackingUrl: string;
  /** Von Hand oder durch Zustellung erledigt */
  done: boolean;
}

export interface ParcelsView {
  open: StoredParcel[];
  /** Zugestellt/erledigt in den letzten 14 Tagen */
  done: StoredParcel[];
}

export interface ParcelsApi {
  list(): Promise<ParcelsView>;
  setDone(trackingNumber: string, done: boolean): Promise<void>;
  /** Sendung entfernen (falsch erkannt) – kommt beim nächsten Suchlauf nicht wieder */
  remove(trackingNumber: string): Promise<void>;
}

export const parcelsApiMethods = ["list", "setDone", "remove"] as const satisfies readonly (keyof ParcelsApi)[];

export const carrierNames: Record<Carrier, string> = {
  dhl: "DHL", deutschePost: "Deutsche Post", hermes: "Hermes", dpd: "DPD", gls: "GLS", ups: "UPS", fedex: "FedEx", amazon: "Amazon", gofo: "GOFO", other: "",
};

/** Öffentliche Sendungsverfolgung je Dienst (die Nummer geht erst beim Klick an den Paketdienst) */
export function trackingUrlFor(carrier: Carrier, number: string): string | null {
  const n = encodeURIComponent(number);
  switch (carrier) {
    case "dhl":
    case "deutschePost":
      return `https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=${n}`;
    case "hermes":
      return `https://www.myhermes.de/empfangen/sendungsverfolgung/sendungsinformation#${n}`;
    case "dpd":
      return `https://tracking.dpd.de/status/de_DE/parcel/${n}`;
    case "gls":
      return `https://gls-group.com/DE/de/paketverfolgung?match=${n}`;
    case "ups":
      return `https://www.ups.com/track?loc=de_DE&tracknum=${n}`;
    case "fedex":
      return `https://www.fedex.com/fedextrack/?trknbr=${n}`;
    default:
      return null;
  }
}

/** Links zur Sendungsverfolgung: Dienst und Nummer aus der Adresse */
const trackingLinks: { carrier: Carrier; host: RegExp; param: RegExp }[] = [
  { carrier: "dhl", host: /(^|\.)dhl\.(de|com)$/, param: /[?&#](?:piececode|idc|tracking-id|trackingnumber|AWB)=([A-Z0-9]{8,35})/i },
  { carrier: "hermes", host: /(^|\.)(myhermes\.de|hermesworld\.com|hermes-europe\.co\.uk)$/, param: /(?:[?&#](?:TrackID|trackingNumber|shipmentId)=|sendungsinformation#)([A-Z0-9]{10,20})/i },
  { carrier: "dpd", host: /(^|\.)dpd\.(de|com)$/, param: /(?:parcel\/|[?&]parcelNumber=|[?&]query=)([0-9]{14})/i },
  { carrier: "gls", host: /(^|\.)(gls-group\.(eu|com)|gls-pakete\.de)$/, param: /[?&](?:match|parcelNo|txtAction)=([A-Z0-9]{8,14})/i },
  { carrier: "ups", host: /(^|\.)ups\.com$/, param: /[?&](?:tracknum|trackNums|InquiryNumber1)=(1Z[0-9A-Z]{16})/i },
  { carrier: "fedex", host: /(^|\.)fedex\.com$/, param: /[?&](?:trknbr|tracknumbers)=([0-9]{12,15})/i },
];

/** Muster je Dienst – nur mit Stichwort davor („Sendungsnummer: …“), sonst wären Bestell- und Kundennummern Treffer */
const numberPatterns: { carrier: Carrier; re: RegExp }[] = [
  { carrier: "ups", re: /\b(1Z[0-9A-Z]{16})\b/ },
  { carrier: "amazon", re: /\b(TBA\d{12})\b/ },
  { carrier: "deutschePost", re: /\b([A-Z]{2}\d{9}DE)\b/ },
  { carrier: "dhl", re: /\b(JJD\d{18,20})\b/ },
  { carrier: "dhl", re: /\b(00\d{18})\b/ },
  { carrier: "hermes", re: /\b(H\d{19})\b/ },
];
const keyword = /(sendungs(?:nummer|-?nr\.?|verfolgungsnummer)|tracking(?:[- ]?(?:nummer|number|id|code))?|paketnummer|paket-?nr\.?|sendungs-?id|trackingcode|track(?:ing)? id|parcel number|identcode|paketschein)\s*[:#]?\s*/i;

function carrierFromText(text: string, from: string): Carrier {
  const hay = `${from} ${text}`.toLowerCase();
  if (/\bdhl\b|deutsche post|packstation|postfiliale/.test(hay)) return "dhl";
  if (/\bhermes\b/.test(hay)) return "hermes";
  if (/\bdpd\b/.test(hay)) return "dpd";
  if (/\bgls\b/.test(hay)) return "gls";
  if (/\bups\b/.test(hay)) return "ups";
  if (/\bfedex\b/.test(hay)) return "fedex";
  if (/amazon|tba\d{12}/.test(hay)) return "amazon";
  return "other";
}

/** Ziffernfolgen nach Stichwort, z. B. „Sendungsnummer: 0034 0434 1234 5678 90“ (Leerzeichen erlaubt) */
function numbersAfterKeyword(text: string): string[] {
  const result: string[] = [];
  const re = new RegExp(keyword.source + "([A-Z0-9][A-Z0-9 ]{7,40}[A-Z0-9])", "gi");
  for (const match of text.matchAll(re)) {
    const raw = (match[2] ?? "").replace(/ (?=[A-Z0-9])/g, "");
    // Nur Nummern-ähnliches: mindestens 8 Ziffern, kein reines Wort
    const candidate = raw.match(/^[A-Z0-9]{8,35}/i)?.[0]?.toUpperCase() ?? "";
    if ((candidate.match(/\d/g) ?? []).length >= 8) result.push(candidate);
  }
  return result;
}

export function parcelStatus(text: string): ParcelStatus {
  const t = text.toLowerCase();
  if (/(wurde|ist) (erfolgreich )?zugestellt|zustellung erfolgt|hat sie erreicht|has been delivered|was delivered|\bdelivered\b|abgeholt/.test(t)) return "delivered";
  if (/(zustellung (nicht möglich|fehlgeschlagen)|konnte nicht zugestellt|rücksendung an den absender|delivery (failed|attempted)|zollgebühr|beschädigt)/.test(t)) return "problem";
  if (/(abholbereit|zur abholung bereit|liegt .{0,40}(packstation|filiale|paketshop|parcelshop)|ready for pickup|abholen)/.test(t)) return "pickup";
  if (/(heute (zugestellt|bei dir|bei ihnen)|in zustellung|ist auf dem weg zu (dir|ihnen)|out for delivery|kommt heute)/.test(t)) return "outForDelivery";
  if (/(versandt|verschickt|unterwegs|übergeben|auf dem weg|shipped|in transit|wurde an .{0,30}übergeben)/.test(t)) return "inTransit";
  return "announced";
}

const months: Record<string, number> = { januar: 1, februar: 2, märz: 3, maerz: 3, april: 4, mai: 5, juni: 6, juli: 7, august: 8, september: 9, oktober: 10, november: 11, dezember: 12 };

/** „voraussichtlich am 14.10.“ / „Zustellung: Dienstag, 14. Oktober“ → YYYY-MM-DD (Jahr aus dem Mail-Datum) */
export function expectedDate(text: string, mailDate: string): string | null {
  const base = new Date(mailDate);
  const year = base.getFullYear();
  const pick = (day: number, month: number, explicitYear?: number) => {
    let y = explicitYear ?? year;
    // Termin vor dem Mail-Datum ohne Jahr → nächstes Jahr (Dezember-Mail, Januar-Zustellung)
    if (!explicitYear && new Date(y, month - 1, day) < new Date(base.getFullYear(), base.getMonth(), base.getDate() - 1)) y += 1;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  };
  // Relativ: „voraussichtlich morgen“, „heute“, „übermorgen“
  const relative = /(voraussichtlich|zustellung|lieferung|kommt|wird)[^.\n]{0,30}?\b(heute|übermorgen|morgen)\b/i.exec(text);
  if (relative) {
    const d = new Date(base);
    d.setDate(d.getDate() + (relative[2]?.toLowerCase() === "heute" ? 0 : relative[2]?.toLowerCase() === "morgen" ? 1 : 2));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  const context = /(voraussichtlich|zustellung|lieferung|liefertermin|ankunft|erwartet|zugestellt am|kommt am|estimated delivery|arriving)[^.\n]{0,40}?/i;
  const numeric = new RegExp(context.source + "(\\d{1,2})\\.(\\d{1,2})\\.(\\d{4}|\\d{2})?", "i").exec(text);
  if (numeric) {
    const y = numeric[4] ? Number(numeric[4].length === 2 ? `20${numeric[4]}` : numeric[4]) : undefined;
    return pick(Number(numeric[2]), Number(numeric[3]), y);
  }
  // Wochentag: „Zustellung am Montag“ → nächster Montag nach dem Mail-Datum
  const weekdays = ["sonntag", "montag", "dienstag", "mittwoch", "donnerstag", "freitag", "samstag"];
  const weekday = new RegExp(context.source + "\\b(sonntag|montag|dienstag|mittwoch|donnerstag|freitag|samstag)\\b(?!,?\\s*\\d)", "i").exec(text);
  if (weekday) {
    const target = weekdays.indexOf((weekday[2] ?? "").toLowerCase());
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    d.setDate(d.getDate() + (((target - d.getDay() + 7) % 7) || 7));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  const named = new RegExp(context.source + "(\\d{1,2})\\.\\s*(januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)", "i").exec(text);
  if (named) return pick(Number(named[2]), months[(named[3] ?? "").toLowerCase()] ?? 0);
  return null;
}

/** Strukturierte Daten (JSON-LD) aus dem HTML */
function schemaParcels(html: string): { trackingNumber: string; carrier: string | null; url: string | null; status: string | null; expected: string | null }[] {
  const result: { trackingNumber: string; carrier: string | null; url: string | null; status: string | null; expected: string | null }[] = [];
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse((match[1] ?? "").trim());
    } catch {
      continue;
    }
    const visit = (node: unknown) => {
      if (Array.isArray(node)) return node.forEach(visit);
      if (!node || typeof node !== "object") return;
      const o = node as Record<string, unknown>;
      if (o["@type"] === "ParcelDelivery" && typeof o.trackingNumber === "string") {
        const provider = o.provider ?? o.carrier;
        const name = typeof provider === "string" ? provider : provider && typeof provider === "object" ? String((provider as Record<string, unknown>).name ?? "") : null;
        const status = o.deliveryStatus && typeof o.deliveryStatus === "object" ? String((o.deliveryStatus as Record<string, unknown>)["@type"] ?? "") : typeof o.deliveryStatus === "string" ? o.deliveryStatus : null;
        const until = typeof o.expectedArrivalUntil === "string" ? o.expectedArrivalUntil : typeof o.expectedArrivalFrom === "string" ? o.expectedArrivalFrom : null;
        result.push({ trackingNumber: o.trackingNumber, carrier: name, url: typeof o.trackingUrl === "string" ? o.trackingUrl : null, status, expected: until ? until.slice(0, 10) : null });
      }
      for (const value of Object.values(o)) if (value && typeof value === "object") visit(value);
    };
    visit(data);
  }
  return result;
}

const statusFromSchema = (s: string | null): ParcelStatus | null => {
  if (!s) return null;
  if (/Delivered/i.test(s)) return "delivered";
  if (/OutForDelivery/i.test(s)) return "outForDelivery";
  if (/InTransit|Shipped/i.test(s)) return "inTransit";
  if (/Pickup/i.test(s)) return "pickup";
  if (/Problem|Failed/i.test(s)) return "problem";
  return null;
};

function carrierFromName(name: string | null, fallback: Carrier): Carrier {
  if (!name) return fallback;
  const c = carrierFromText(name, "");
  return c === "other" ? fallback : c;
}

/** Sendungen in einer Mail finden */
export function findParcels(mail: { from: { address: string; name: string | null }; subject: string; bodyText: string | null; bodyHtml: string | null; date: string }): ParcelFinding[] {
  const html = mail.bodyHtml ?? "";
  const text = `${mail.subject}\n${mail.bodyText ?? html.replace(/<[^>]+>/g, " ")}`;
  const from = `${mail.from.name ?? ""} ${mail.from.address}`;
  const carrierGuess = carrierFromText(text, from);
  const status = parcelStatus(text);
  const expected = expectedDate(text, mail.date);
  const found = new Map<string, ParcelFinding>();
  const add = (f: ParcelFinding) => {
    const key = f.trackingNumber.toUpperCase();
    if (!found.has(key)) found.set(key, { ...f, trackingNumber: key });
  };

  for (const s of schemaParcels(html)) {
    const carrier = carrierFromName(s.carrier, carrierGuess);
    const url = s.url && s.url.startsWith("https://") ? s.url : null;
    add({ trackingNumber: s.trackingNumber, carrier, status: statusFromSchema(s.status) ?? status, expected: s.expected ?? expected, trackingUrl: url, source: "schema" });
  }

  const hrefs = [...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => (m[1] ?? "").replace(/&amp;/g, "&"));
  const textUrls = [...(mail.bodyText ?? "").matchAll(/https:\/\/[^\s<>"']+/gi)].map((m) => m[0]);
  for (const href of [...hrefs, ...textUrls]) {
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      continue;
    }
    if (url.protocol !== "https:") continue;
    const link = trackingLinks.find((l) => l.host.test(url.hostname.toLowerCase()));
    const number = link?.param.exec(href)?.[1];
    if (link && number) add({ trackingNumber: number, carrier: link.carrier, status, expected, trackingUrl: href, source: "link" });
  }

  for (const { carrier, re } of numberPatterns) {
    const number = re.exec(text)?.[1];
    if (number && keyword.test(text)) add({ trackingNumber: number, carrier, status, expected, trackingUrl: null, source: "text" });
  }
  for (const number of numbersAfterKeyword(text)) add({ trackingNumber: number, carrier: carrierGuess, status, expected, trackingUrl: null, source: "text" });

  return [...found.values()];
}
