// Tracker-Report (Spezifikation 7.2): welche Zählpixel und Klickzähler in einer Mail stecken und von welchem Dienst.
// Blockiert werden externe Bilder ohnehin (bis der Nutzer sie lädt); hier geht es ums Sichtbarmachen. Reiner Code
// über das HTML (Muster, kein DOM), plattformneutral – läuft beim Abgleich und in der Oberfläche gleich.

import { stripTracking } from "./links.js";

export interface TrackerReport {
  /** Erkannte Zählpixel (je Dienst einmal) */
  pixels: { service: string; host: string }[];
  /** Links über einen Klickzähler oder mit Kampagnen-Parametern */
  trackedLinks: number;
  /** Alle beteiligten Dienste (Pixel und Klickzähler), sortiert */
  services: string[];
}

/** Bekannte Versand- und Tracking-Dienste: Domain-Endung → Name */
const trackerHosts: [string, string][] = [
  ["list-manage.com", "Mailchimp"], ["mailchimp.com", "Mailchimp"], ["mcsv.net", "Mailchimp"],
  ["sendgrid.net", "SendGrid"], ["hubspotemail.net", "HubSpot"], ["hubspotlinks.com", "HubSpot"], ["hs-analytics.net", "HubSpot"],
  ["hubspot.com", "HubSpot"], ["mjt.lu", "Mailjet"], ["mailjet.com", "Mailjet"], ["sendibt3.com", "Brevo"], ["sendibt2.com", "Brevo"],
  ["sendibm.com", "Brevo"], ["sendinblue.com", "Brevo"], ["brevo.com", "Brevo"], ["cleverreach.com", "CleverReach"], ["crsend.com", "CleverReach"],
  ["rapidmail.de", "rapidmail"], ["rmlnk.de", "rapidmail"], ["newsletter2go.com", "Newsletter2Go"], ["exacttarget.com", "Salesforce Marketing Cloud"],
  ["exct.net", "Salesforce Marketing Cloud"], ["sfmc-content.com", "Salesforce Marketing Cloud"], ["mailgun.org", "Mailgun"], ["mailgun.net", "Mailgun"],
  ["awstrack.me", "Amazon SES"], ["klaviyo.com", "Klaviyo"], ["klclick.com", "Klaviyo"], ["klclick1.com", "Klaviyo"], ["createsend.com", "Campaign Monitor"],
  ["cmail19.com", "Campaign Monitor"], ["cmail20.com", "Campaign Monitor"], ["rs6.net", "Constant Contact"], ["constantcontact.com", "Constant Contact"],
  ["mailerlite.com", "MailerLite"], ["mlsend.com", "MailerLite"], ["mlsend2.com", "MailerLite"], ["emarsys.net", "Emarsys"], ["episerver.net", "Optimizely"],
  ["inxmail.com", "Inxmail"], ["inxserver.com", "Inxmail"], ["inxserver.de", "Inxmail"], ["mailingwork.de", "Mailingwork"], ["epost-mail.de", "Episerver"],
  ["google-analytics.com", "Google Analytics"], ["doubleclick.net", "Google"], ["mailtrack.io", "Mailtrack"], ["mltrk.io", "Mailtrack"],
  ["yesware.com", "Yesware"], ["mixmax.com", "Mixmax"], ["superhuman.com", "Superhuman"], ["streak.com", "Streak"], ["bananatag.com", "Bananatag"],
  ["getnotify.com", "GetNotify"], ["mailbutler.io", "Mailbutler"], ["salesloft.com", "Salesloft"], ["outreach.io", "Outreach"],
  ["linkedin.com/emimp", "LinkedIn"], ["facebook.com/tr", "Meta"], ["substack.com/o/", "Substack"], ["customer.io", "Customer.io"],
  ["customeriomail.com", "Customer.io"], ["sparkpostmail.com", "SparkPost"], ["mandrillapp.com", "Mandrill"], ["postmarkapp.com", "Postmark"],
  ["pstmrk.it", "Postmark"], ["eloqua.com", "Oracle Eloqua"], ["en25.com", "Oracle Eloqua"], ["marketo.com", "Marketo"], ["mktoweb.com", "Marketo"],
  ["acemlna.com", "ActiveCampaign"], ["activehosted.com", "ActiveCampaign"], ["getresponse.com", "GetResponse"], ["gr-cdn.com", "GetResponse"],
  ["convertkit-mail.com", "Kit"], ["ck.page", "Kit"], ["beehiiv.com", "beehiiv"], ["mailpoet.com", "MailPoet"], ["sendpulse.com", "SendPulse"],
];

/** Dienste, deren Bilder immer Zählpixel sind (keine Inhalte) */
const pixelOnly = new Set(["Google Analytics", "Google", "Meta", "LinkedIn", "Mailtrack", "Yesware", "Mixmax", "Superhuman", "Streak", "Bananatag", "GetNotify", "Mailbutler", "Salesloft", "Outreach", "Substack"]);

function serviceFor(url: string): { service: string; host: string } | null {
  const lower = url.toLowerCase();
  let host: string;
  try {
    host = new URL(lower.startsWith("//") ? `https:${lower}` : lower).hostname;
  } catch {
    return null;
  }
  for (const [pattern, service] of trackerHosts) {
    const [domain = "", path] = pattern.split(/(?=\/)/);
    const hostMatches = host === domain || host.endsWith(`.${domain}`);
    if (hostMatches && (!path || lower.includes(path))) return { service, host };
  }
  return null;
}

const decode = (v: string) => v.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  if (!match) return null;
  return decode(match[2] ?? match[3] ?? match[4] ?? "");
}

/** Winziges oder unsichtbares Bild → typisches Zählpixel */
function looksLikePixel(tag: string, src: string): boolean {
  const size = (v: string | null) => (v === null ? null : Number.parseInt(v, 10));
  const w = size(attribute(tag, "width"));
  const h = size(attribute(tag, "height"));
  if ((w !== null && w <= 3) || (h !== null && h <= 3)) return true;
  const style = (attribute(tag, "style") ?? "").toLowerCase();
  if (/(^|;)\s*(display\s*:\s*none|visibility\s*:\s*hidden|(width|height)\s*:\s*[0-3]px)/.test(style)) return true;
  return /\/(open|track(ing)?|pixel|beacon|wf\/open|e\/o|o\.gif|t\.gif|1x1)[./?]/i.test(src);
}

/** Ist dieses `<img …>` ein Zählpixel? Dann Dienst (bzw. Host bei Unbekannten) und Host, sonst null. */
export function trackingImage(tag: string): { service: string; host: string } | null {
  const src = attribute(tag, "src");
  if (!src || !/^(https?:)?\/\//i.test(src)) return null;
  const known = serviceFor(src);
  const pixelLike = looksLikePixel(tag, src);
  if (!known && !pixelLike) return null;
  // Große Bilder von einem Versanddienst sind meist Inhalt (Logos, Produktfotos), keine Pixel
  if (known && !pixelOnly.has(known.service) && !pixelLike && !/\/(open|track|o\/|wf\/open)/i.test(src)) return null;
  let host: string;
  try {
    host = new URL(src.startsWith("//") ? `https:${src}` : src).hostname.toLowerCase();
  } catch {
    return null;
  }
  return { service: known?.service ?? host, host };
}

/** Tracker in einer HTML-Mail finden */
export function trackerReport(html: string | null | undefined): TrackerReport {
  const pixels = new Map<string, { service: string; host: string }>();
  const services = new Set<string>();
  if (!html) return { pixels: [], trackedLinks: 0, services: [] };

  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const pixel = trackingImage(match[0]);
    if (!pixel) continue;
    if (!pixels.has(pixel.service)) pixels.set(pixel.service, pixel);
    services.add(pixel.service);
  }

  let trackedLinks = 0;
  for (const match of html.matchAll(/<a\b[^>]*>/gi)) {
    const href = attribute(match[0], "href");
    if (!href || !/^https?:\/\//i.test(href)) continue;
    const known = serviceFor(href);
    if (known) services.add(known.service);
    if (known || stripTracking(href).removed > 0) trackedLinks += 1;
  }

  return { pixels: [...pixels.values()], trackedLinks, services: [...services].sort((a, b) => a.localeCompare(b)) };
}
