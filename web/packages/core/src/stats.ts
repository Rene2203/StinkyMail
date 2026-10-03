// Postfach-Statistik & Mail-Diät (W10.1, Spezifikation 7.1): Zahlen über das eigene Postfach und konkrete Vorschläge
// („Diese Newsletter öffnest du nie – abbestellen?“). Reine Statistik aus Mails und dem lokalen Verhaltens-Protokoll,
// keine KI. Vorschläge ändern nichts von selbst – jeder braucht einen Klick. Plattformneutral.

export type StatsPeriod = 30 | 90 | 365;

export interface SenderStat {
  address: string;
  name: string | null;
  received: number;
  /** davon gelesen (Gelesen-Markierung, auch auf anderen Geräten) */
  read: number;
  /** davon beantwortet */
  replied: number;
}

export interface MailboxStats {
  period: StatsPeriod;
  /** Zeitraum (ISO) */
  since: string;
  received: number;
  sent: number;
  /** Anteil ungelesen an den erhaltenen Mails (0–1) */
  unreadShare: number;
  /** Mails pro Woche, älteste zuerst (Wochenbeginn Montag, YYYY-MM-DD) */
  weeks: { week: string; received: number; sent: number }[];
  /** Häufigste Absender */
  topSenders: SenderStat[];
  /** Einordnung der erhaltenen Mails */
  categories: { category: string; count: number }[];
  /** Mein Antwortverhalten: Median in Stunden, Anteil am selben Tag beantwortet; null bei zu wenig Daten */
  myReply: { medianHours: number; sameDayShare: number; count: number } | null;
  /** An welchem Wochentag (1 = Mo … 7 = So) und zu welcher Stunde (Ortszeit) die meisten Mails kommen */
  busiestWeekday: number | null;
  busiestHour: number | null;
  /** Vorschläge der Mail-Diät */
  suggestions: DietSuggestion[];
}

export type DietKind = "unsubscribe" | "autoArchive";

export interface DietSuggestion {
  /** Stabiler Schlüssel (zum Ausblenden): „unsubscribe:news@shop.example“ */
  key: string;
  kind: DietKind;
  address: string;
  name: string | null;
  received: number;
  read: number;
  /** Ungelesen gelöscht (aus dem Verhaltens-Protokoll) */
  trashedUnread: number;
  /** Neueste Mail des Absenders (für „Abbestellen“) */
  messageId: string;
}

/** Ab wie vielen Mails im Zeitraum ein Absender für Vorschläge zählt und wie wenig gelesen „nie“ heißt */
export const dietThresholds = { minMails: 3, maxReadShareUnsubscribe: 0.1, minMailsArchive: 5, maxReadShareArchive: 0.2 } as const;

/** Median (Stunden, eine Nachkommastelle) oder null */
export function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  return Math.round(value * 10) / 10;
}

/** Montag der Woche (Ortszeit) als YYYY-MM-DD */
export function weekStart(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export interface StatsApi {
  overview(period: StatsPeriod): Promise<MailboxStats>;
  /** Vorschlag ausblenden („nicht mehr vorschlagen“) */
  dismiss(key: string): Promise<void>;
  /** Ausgeblendete Vorschläge wieder zeigen */
  resetDismissed(): Promise<void>;
}

export const statsApiMethods = ["overview", "dismiss", "resetDismissed"] as const satisfies readonly (keyof StatsApi)[];
