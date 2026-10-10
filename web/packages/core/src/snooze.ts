// Schlummern (Spezifikation 7.3): Mail verschwindet bis zu einem Zeitpunkt aus dem Posteingang und kommt dann oben
// wieder. Nur lokal (der Mailserver kennt das nicht). Zeitvorschläge per Code, Ortszeit. Plattformneutral.

import type { Message } from "./models.js";

export type SnoozePreset = "laterToday" | "tonight" | "tomorrow" | "weekend" | "nextWeek";

/** Vorschläge ab `now` (Ortszeit) – nur die, die in der Zukunft liegen und sich unterscheiden */
export function snoozeOptions(now: Date = new Date()): { preset: SnoozePreset; at: Date }[] {
  const at = (days: number, hour: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(hour, 0, 0, 0);
    return d;
  };
  const day = now.getDay(); // 0 = So
  const options: { preset: SnoozePreset; at: Date }[] = [];
  // In drei Stunden, auf volle Stunde – nur bis 18 Uhr sinnvoll
  const later = new Date(now);
  later.setHours(later.getHours() + 3, 0, 0, 0);
  if (later.getDate() === now.getDate() && later.getHours() <= 18) options.push({ preset: "laterToday", at: later });
  const tonight = at(0, 19);
  if (tonight.getTime() - now.getTime() > 60 * 60_000) options.push({ preset: "tonight", at: tonight });
  options.push({ preset: "tomorrow", at: at(1, 8) });
  // Samstag 9 Uhr (am Wochenende selbst nicht anbieten)
  if (day >= 1 && day <= 4) options.push({ preset: "weekend", at: at(6 - day, 9) });
  // Nächster Montag 8 Uhr
  options.push({ preset: "nextWeek", at: at(((8 - day) % 7) || 7, 8) });
  return options.filter((o, i, all) => all.findIndex((x) => x.at.getTime() === o.at.getTime()) === i);
}

/** Schlummert die Mail gerade (Zeitpunkt in der Zukunft)? */
export function isSnoozed(message: Pick<Message, "snoozedUntil">, now: Date = new Date()): boolean {
  return Boolean(message.snoozedUntil && message.snoozedUntil > now.toISOString());
}

/** Wieder aufgewacht und noch nicht geöffnet („Wieder da“) */
export function isWoken(message: Pick<Message, "snoozedUntil" | "date">, now: Date = new Date()): boolean {
  return Boolean(message.snoozedUntil && message.snoozedUntil <= now.toISOString() && message.snoozedUntil > message.date);
}

/** Sortierzeit in Listen: aufgewachte Mails stehen zum Weckzeitpunkt oben */
export function listTime(message: Pick<Message, "snoozedUntil" | "date">, now: Date = new Date()): string {
  return isWoken(message, now) && message.snoozedUntil ? message.snoozedUntil : message.date;
}
