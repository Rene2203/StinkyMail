// Nachhak-Wächter (Spezifikation 7.3): eigene Mails, auf die nach ein paar Tagen keine Antwort kam – „nachhaken?“.
// Alles per Code: Frage oder Bitte im eigenen Text, keine spätere Mail der Gegenseite im Verlauf (oder von ihr überhaupt).
// Nachhak-Text als Vorlage ohne KI; abgeschickt wird nur, was der Nutzer abschickt. Plattformneutral.

import type { EmailAddress, Message } from "./models.js";
import { ownText } from "./style.js";

/** Nach so vielen Tagen ohne Antwort meldet sich der Wächter; älter als `maxDays` wird nicht mehr vorgeschlagen */
export const followUpDays = 3;
export const followUpMaxDays = 30;

const noReplyNeeded = /\b(keine (antwort|rückmeldung) (nötig|notwendig|erforderlich)|nur zur (info|kenntnis)|zur kenntnisnahme|fyi|no (reply|response) (needed|necessary))\b/i;
const requests = [
  /\?/,
  /\b(bitte|bräuchte|benötige|könntest|könnten sie|kannst du|können sie|würdest du|würden sie|gib mir bescheid|geben sie mir bescheid|sag mir bescheid|melde dich|melden sie sich|rückmeldung|rückruf|ich freue mich auf (deine|ihre) antwort|bis wann)\b/i,
  /\b(please|could you|can you|would you|let me know|get back to me|looking forward to your reply)\b/i,
];

/** Erwartet der eigene Text eine Antwort (Frage, Bitte)? Zitat und Signatur zählen nicht. */
export function expectsReply(body: string): boolean {
  const text = ownText(body);
  if (!text || noReplyNeeded.test(text)) return false;
  return requests.some((re) => re.test(text));
}

/** Empfänger, die nie antworten (Systemadressen) */
export function isNoReplyAddress(address: string): boolean {
  return /^(no-?reply|do-?not-?reply|donotreply|noreply|mailer-daemon|postmaster|bounce|notifications?)([+.@-]|$)/i.test(address);
}

/** Wartet diese gesendete Mail auf eine Antwort? `thread`: alle Mails des Verlaufs; `laterFrom`: spätere Mails der Empfänger (auch außerhalb des Verlaufs) */
export function awaitsReply(
  sent: Pick<Message, "date" | "to" | "cc" | "bodyText" | "snippet">,
  thread: Pick<Message, "date" | "from">[],
  ownAddresses: string[],
  now: Date = new Date(),
  laterFromRecipients = false,
): boolean {
  const own = new Set(ownAddresses.map((a) => a.toLowerCase()));
  const age = (now.getTime() - Date.parse(sent.date)) / 86_400_000;
  if (!(age >= followUpDays && age <= followUpMaxDays)) return false;
  const recipients = sent.to.map((r) => r.address.toLowerCase()).filter((a) => !own.has(a) && !isNoReplyAddress(a));
  if (recipients.length === 0) return false;
  if (!expectsReply(sent.bodyText ?? sent.snippet)) return false;
  if (laterFromRecipients) return false;
  return !thread.some((m) => m.date > sent.date && !own.has(m.from.address.toLowerCase()));
}

/** Nachhak-Vorlage: „du“ oder „Sie“ wie in der eigenen Mail */
export function followUpReplyText(sent: Pick<Message, "date" | "subject" | "bodyText" | "snippet">, to: EmailAddress, locale: "de" | "en" = "de"): string {
  const first = (to.name ?? "").trim().split(/\s+/)[0] ?? "";
  const date = new Date(sent.date).toLocaleDateString(locale === "de" ? "de-DE" : "en-GB", { day: "numeric", month: "long" });
  if (locale === "en") return `Hi${first ? ` ${first}` : ""},\n\njust following up on my email from ${date}. Did you have a chance to look at it?\n\nBest regards`;
  const formal = /\b(Sie|Ihnen|Ihr|Ihre|Ihren)\b/.test(ownText(sent.bodyText ?? sent.snippet));
  return formal
    ? `Guten Tag,\n\nich wollte kurz an meine Mail vom ${date} erinnern. Haben Sie schon Gelegenheit gehabt, sie anzusehen?\n\nVielen Dank und freundliche Grüße`
    : `Hallo${first ? ` ${first}` : ""},\n\nkurze Nachfrage zu meiner Mail vom ${date} – hast du sie gesehen?\n\nDanke und viele Grüße`;
}
