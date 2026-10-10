// Link-Prüfer (Spezifikation 7.6): zeigt vor dem Öffnen, wohin ein Link wirklich führt, und warnt bei Tricks –
// abweichender Linktext, Doppelgänger-Domains („paypa1.com“, kyrillisches „а“), Punycode, IP-Adressen, „marke.de@böse.example“.
// Reiner Code, ohne KI und ohne Netz (Kurzlinks werden nicht aufgelöst). Plattformneutral.

export type LinkWarning =
  | { code: "mismatch"; shown: string; brand?: boolean }
  | { code: "lookalike"; brand: string }
  | { code: "punycode"; unicode: string }
  | { code: "mixedScript"; unicode: string }
  | { code: "ip" }
  | { code: "userinfo"; fake: string }
  | { code: "shortener" }
  | { code: "insecure" };

export interface LinkCheck {
  /** Adresse, die geöffnet würde (ohne Tracking-Parameter, siehe `stripTracking`) */
  url: string;
  /** Host, wie er im Browser steht (Punycode in Unicode zurückübersetzt) */
  host: string;
  /** Registrierbare Domain („shop.example“, „bbc.co.uk“) */
  domain: string;
  level: "ok" | "caution" | "danger";
  warnings: LinkWarning[];
  /** Entfernte Tracking-Parameter (Anzahl) */
  removedParams: number;
}

/** Endungen mit zwei Ebenen (Auswahl der häufigen) – genügt für den Vergleich „gleiche Domain?“ */
const twoLevelSuffixes = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "com.au", "net.au", "org.au", "co.at", "or.at", "gv.at", "ac.at",
  "co.nz", "co.jp", "ne.jp", "com.br", "com.tr", "co.za", "com.cn", "com.mx", "co.in", "com.pl", "com.es", "co.il",
]);

/** Echte Marken (registrierbarer Name ohne Endung), die gern nachgeahmt werden */
const brandNames: Record<string, string> = {
  paypal: "PayPal", amazon: "Amazon", sparkasse: "Sparkasse", volksbank: "Volksbank", commerzbank: "Commerzbank",
  deutschebank: "Deutsche Bank", postbank: "Postbank", comdirect: "comdirect", consorsbank: "Consorsbank", dkb: "DKB",
  ing: "ING", n26: "N26", dhl: "DHL", deutschepost: "Deutsche Post", hermes: "Hermes", dpd: "DPD", ups: "UPS",
  fedex: "FedEx", microsoft: "Microsoft", outlook: "Outlook", office: "Microsoft Office", live: "Microsoft",
  apple: "Apple", icloud: "iCloud", google: "Google", gmail: "Gmail", youtube: "YouTube", telekom: "Telekom",
  vodafone: "Vodafone", netflix: "Netflix", spotify: "Spotify", ebay: "eBay", kleinanzeigen: "Kleinanzeigen",
  zalando: "Zalando", otto: "Otto", check24: "Check24", elster: "ELSTER", facebook: "Facebook", instagram: "Instagram",
  whatsapp: "WhatsApp", linkedin: "LinkedIn", dropbox: "Dropbox", docusign: "DocuSign", adobe: "Adobe",
  booking: "Booking.com", airbnb: "Airbnb", lufthansa: "Lufthansa", bahn: "Deutsche Bahn", visa: "Visa",
  mastercard: "Mastercard", klarna: "Klarna", gmx: "GMX", web: "WEB.DE", tonline: "t-online",
};

/** Allgemeine Wörter unter den Marken: hier nur exakte Nachahmung zählen, keine Tippfehler („offices“, „webs“) */
const genericBrandWords = new Set(["office", "live", "web", "booking", "bahn", "visa", "hermes", "otto", "adobe", "outlook"]);

const shorteners = new Set([
  "bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "cutt.ly", "rebrand.ly", "shorturl.at", "buff.ly",
  "s.id", "t.ly", "rb.gy", "tiny.cc", "lnkd.in", "bl.ink", "short.io",
]);

/** Häufige Tracking-Parameter (Kampagnen, Klick-IDs). Nur die bekannten – unbekannte Parameter bleiben, sonst brechen Links. */
const trackingParam = /^(utm_[a-z_]+|gclid|gclsrc|dclid|gbraid|wbraid|fbclid|msclkid|mc_cid|mc_eid|_hsenc|_hsmi|__hs[a-z_]*|hsCtaTracking|mkt_tok|yclid|igshid|oly_anon_id|oly_enc_id|vero_id|vero_conv|wickedid|_openstat|trk|trkCampaign|sc_campaign|sc_channel|ef_id|s_kwcid|ito|cmpid|wt_mc|wt_zmc|ncid|rb_clickid|_ga|_gl|ml_subscriber|ml_subscriber_hash|ck_subscriber_id|_kx|epik|srsltid)$/i;

/** Entfernt bekannte Tracking-Parameter aus einer Adresse. Ungültige Adressen bleiben unverändert. */
export function stripTracking(url: string): { url: string; removed: number } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { url, removed: 0 };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { url, removed: 0 };
  const names = [...parsed.searchParams.keys()];
  const remove = [...new Set(names.filter((n) => trackingParam.test(n)))];
  if (remove.length === 0) return { url, removed: 0 };
  for (const name of remove) parsed.searchParams.delete(name);
  // `searchParams` schreibt „?“ auch ohne Parameter nicht mehr – sauber
  return { url: parsed.toString(), removed: names.filter((n) => trackingParam.test(n)).length };
}

/** Registrierbare Domain eines Hosts */
export function registrableDomain(host: string): string {
  const parts = host.toLowerCase().replace(/\.$/, "").split(".");
  if (parts.length <= 2) return parts.join(".");
  const lastTwo = parts.slice(-2).join(".");
  return twoLevelSuffixes.has(lastTwo) ? parts.slice(-3).join(".") : lastTwo;
}

/** Punycode (RFC 3492) eines Labels dekodieren; bei Fehlern null */
function decodePunycodeLabel(input: string): string | null {
  const base = 36, tMin = 1, tMax = 26, skew = 38, damp = 700;
  let n = 128, i = 0, bias = 72;
  const output: number[] = [];
  const delimiter = input.lastIndexOf("-");
  for (let j = 0; j < Math.max(0, delimiter); j++) {
    const code = input.charCodeAt(j);
    if (code >= 0x80) return null;
    output.push(code);
  }
  const digit = (c: number) => (c - 48 < 10 ? c - 22 : c - 65 < 26 ? c - 65 : c - 97 < 26 ? c - 97 : base);
  for (let index = delimiter > 0 ? delimiter + 1 : 0; index < input.length; ) {
    const oldi = i;
    for (let w = 1, k = base; ; k += base) {
      if (index >= input.length) return null;
      const d = digit(input.charCodeAt(index++));
      if (d >= base) return null;
      i += d * w;
      const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
      if (d < t) break;
      w *= base - t;
      if (w > 0x7fffffff) return null;
    }
    const length = output.length + 1;
    let delta = i - oldi;
    delta = oldi === 0 ? Math.floor(delta / damp) : delta >> 1;
    delta += Math.floor(delta / length);
    let k = 0;
    while (delta > ((base - tMin) * tMax) >> 1) {
      delta = Math.floor(delta / (base - tMin));
      k += base;
    }
    bias = k + Math.floor(((base - tMin + 1) * delta) / (delta + skew));
    n += Math.floor(i / length);
    if (n > 0x10ffff) return null;
    i %= length;
    output.splice(i, 0, n);
    i++;
  }
  return String.fromCodePoint(...output);
}

/** Host mit „xn--“-Labels → Unicode (für die Anzeige) */
export function hostToUnicode(host: string): string {
  return host
    .split(".")
    .map((label) => (label.toLowerCase().startsWith("xn--") ? (decodePunycodeLabel(label.slice(4).toLowerCase()) ?? label) : label))
    .join(".");
}

/** Zum Verwechseln ähnliche Zeichen auf ihr lateinisches Vorbild abbilden („skeleton“, vereinfacht) */
const confusables: Record<string, string> = {
  а: "a", е: "e", о: "o", р: "p", с: "c", у: "y", х: "x", і: "i", ј: "j", ԁ: "d", ӏ: "l", ѕ: "s", һ: "h", ԛ: "q", ԝ: "w", ո: "n", ս: "u",
  ο: "o", α: "a", ν: "v", ρ: "p", ι: "i", κ: "k", τ: "t", ε: "e", υ: "u", ı: "i", ł: "l", "0": "o", "1": "l", "3": "e", "5": "s", "$": "s", "@": "a",
};

function skeleton(label: string): string {
  const mapped = [...label.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "")].map((c) => confusables[c] ?? c).join("");
  return mapped.replace(/-/g, "").replace(/rn/g, "m").replace(/vv/g, "w").replace(/l/g, "i");
}

function distanceAtMostOne(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      // Vertauschte Nachbarn („paypla“) zählen als ein Fehler
      if (a[i + 1] === b[j] && a[j + 1] === b[i]) {
        i += 2;
        j += 2;
        continue;
      }
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** Ahmt die Domain eine bekannte Marke nach? Liefert den Markennamen oder null. */
export function lookalikeBrand(domain: string): string | null {
  const unicode = hostToUnicode(domain);
  const label = (registrableDomain(unicode).split(".")[0] ?? "").toLowerCase();
  if (!label) return null;
  const plain = label.replace(/-/g, "");
  // Die echte Marke (auch mit anderer Endung oder Bindestrich: deutsche-bank.de) ist keine Nachahmung
  if (brandNames[plain] && /^[a-z0-9-]+$/.test(label)) return null;
  const sk = skeleton(label);
  for (const [name, brand] of Object.entries(brandNames)) {
    const brandSkeleton = skeleton(name);
    if (sk === brandSkeleton) return brand;
    // Ein Tippfehler daneben – nur bei längeren Namen, sonst trifft es zu viele echte Domains
    if (name.length >= 6 && !genericBrandWords.has(name) && distanceAtMostOne(sk, brandSkeleton)) return brand;
  }
  return null;
}

/** Sichtbarer Linktext, der wie eine Adresse aussieht („www.sparkasse.de“, „https://…“) → deren Host */
export function shownHost(text: string): string | null {
  const match = /^(?:https?:\/\/)?((?:[\p{L}\p{N}-]+\.)+\p{L}{2,})(?:[/:?#].*)?$/iu.exec(text.trim());
  return match?.[1]?.toLowerCase() ?? null;
}

/**
 * Prüft einen Link vor dem Öffnen. `text`: sichtbarer Linktext (leer bei reinen Adressen im Text).
 * null, wenn es kein Web-Link ist (mailto & Co. behandelt die Oberfläche selbst).
 */
export function checkLink(href: string, text = ""): LinkCheck | null {
  let parsed: URL;
  try {
    parsed = new URL(href.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const warnings: LinkWarning[] = [];
  let danger = false;
  const asciiHost = parsed.hostname.toLowerCase();
  const host = hostToUnicode(asciiHost);
  const domain = registrableDomain(host);

  if (parsed.username || parsed.password) {
    // https://www.paypal.com@böse.example – vor dem @ steht nur Tarnung
    warnings.push({ code: "userinfo", fake: decodeURIComponent(parsed.username) });
    danger = true;
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(asciiHost) || asciiHost.startsWith("[")) {
    warnings.push({ code: "ip" });
    danger = true;
  }
  const brand = lookalikeBrand(asciiHost);
  if (brand) {
    warnings.push({ code: "lookalike", brand });
    danger = true;
  }
  if (asciiHost.split(".").some((l) => l.startsWith("xn--"))) {
    // Lateinisch gemischt mit Kyrillisch/Griechisch in einem Label: so sieht „аpple“ aus wie „apple“
    if (host.split(".").some((l) => /\p{Script=Latin}/u.test(l) && /[\p{Script=Cyrillic}\p{Script=Greek}]/u.test(l))) {
      warnings.push({ code: "mixedScript", unicode: host });
      danger = true;
    } else if (!brand) warnings.push({ code: "punycode", unicode: host });
  }
  const shown = shownHost(text);
  if (shown && registrableDomain(hostToUnicode(shown)) !== domain) {
    const label = (d: string) => registrableDomain(hostToUnicode(d)).split(".")[0]?.replace(/-/g, "") ?? "";
    const shownLabel = label(shown);
    const sameBrand = Boolean(brandNames[shownLabel]) && shownLabel === label(asciiHost) && !brand;
    // Gleiche Marke, andere Endung (paypal.de → paypal.com) ist normal
    if (!sameBrand) {
      // Zeigt der Text eine bekannte Marke, führt aber woandershin: klassischer Betrug. Sonst oft nur ein Klickzähler.
      const isBrand = Boolean(brandNames[shownLabel]);
      warnings.push(isBrand ? { code: "mismatch", shown, brand: true } : { code: "mismatch", shown });
      if (isBrand) danger = true;
    }
  }
  if (shorteners.has(asciiHost.replace(/^www\./, ""))) warnings.push({ code: "shortener" });
  if (parsed.protocol === "http:") warnings.push({ code: "insecure" });

  const stripped = stripTracking(parsed.toString());
  return {
    url: stripped.url,
    host,
    domain,
    level: danger ? "danger" : warnings.length ? "caution" : "ok",
    warnings,
    removedParams: stripped.removed,
  };
}

/** Web-Adressen in reinem Text finden (für Mails ohne HTML) */
export function linksInText(text: string): { start: number; end: number; url: string }[] {
  const result: { start: number; end: number; url: string }[] = [];
  for (const match of text.matchAll(/\b(?:https?:\/\/|www\.)[^\s<>"'„“]+/gi)) {
    let raw = match[0];
    // Satzzeichen am Ende gehören nicht zur Adresse
    while (/[.,;:!?)\]}]$/.test(raw) && !(raw.endsWith(")") && raw.includes("("))) raw = raw.slice(0, -1);
    const start = match.index ?? 0;
    result.push({ start, end: start + raw.length, url: raw.toLowerCase().startsWith("www.") ? `https://${raw}` : raw });
  }
  return result;
}

/** mailto:-Link → Empfänger und Betreff (Text aus dem Link wird nicht übernommen – könnte untergeschoben sein) */
export function parseMailto(href: string): { to: string[]; subject: string } | null {
  if (!/^mailto:/i.test(href.trim())) return null;
  const rest = href.trim().slice(7);
  const [addressPart = "", query = ""] = rest.split("?");
  const decode = (v: string) => {
    try {
      return decodeURIComponent(v.replace(/\+/g, " "));
    } catch {
      return v;
    }
  };
  const to = decode(addressPart).split(",").map((a) => a.trim()).filter((a) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a));
  const params = new URLSearchParams(query);
  const extra = (params.get("to") ?? "").split(",").map((a) => a.trim()).filter((a) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a));
  return { to: [...to, ...extra].slice(0, 10), subject: (params.get("subject") ?? "").slice(0, 200) };
}
