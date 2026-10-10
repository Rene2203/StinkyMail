import { describe, expect, it } from "vitest";
import { isSnoozed, isWoken, listTime, snoozeOptions } from "../src/index.js";

describe("Schlummern (W11.3)", () => {
  it("Zeitvorschläge je nach Tageszeit und Wochentag", () => {
    // Dienstag 10 Uhr
    const tuesday = snoozeOptions(new Date(2026, 9, 6, 10, 15));
    expect(tuesday.map((o) => o.preset)).toEqual(["laterToday", "tonight", "tomorrow", "weekend", "nextWeek"]);
    expect(tuesday.map((o) => [o.at.getDate(), o.at.getHours()])).toEqual([[6, 13], [6, 19], [7, 8], [10, 9], [12, 8]]);
    // Dienstag 18:30: nicht mehr „später heute“, nicht mehr „heute Abend“ (weniger als eine Stunde)
    expect(snoozeOptions(new Date(2026, 9, 6, 18, 30)).map((o) => o.preset)).toEqual(["tomorrow", "weekend", "nextWeek"]);
    // Samstag: kein „Wochenende“; Sonntag: „nächste Woche“ = morgen 8 Uhr, fällt mit „morgen früh“ zusammen
    expect(snoozeOptions(new Date(2026, 9, 10, 9)).map((o) => o.preset)).toEqual(["laterToday", "tonight", "tomorrow", "nextWeek"]);
    expect(snoozeOptions(new Date(2026, 9, 11, 21)).map((o) => o.preset)).toEqual(["tomorrow"]);
  });

  it("schlummert, aufgewacht, Sortierzeit", () => {
    const now = new Date("2026-10-10T12:00:00Z");
    const mail = { date: "2026-10-01T08:00:00.000Z" };
    expect(isSnoozed({ snoozedUntil: "2026-10-11T08:00:00.000Z" }, now)).toBe(true);
    expect(isSnoozed({ snoozedUntil: null }, now)).toBe(false);
    expect(isWoken({ ...mail, snoozedUntil: "2026-10-10T08:00:00.000Z" }, now)).toBe(true);
    expect(listTime({ ...mail, snoozedUntil: "2026-10-10T08:00:00.000Z" }, now)).toBe("2026-10-10T08:00:00.000Z");
    expect(listTime({ ...mail, snoozedUntil: null }, now)).toBe(mail.date);
  });
});
