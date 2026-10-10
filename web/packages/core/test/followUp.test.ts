import { describe, expect, it } from "vitest";
import { awaitsReply, expectsReply, followUpReplyText, isNoReplyAddress } from "../src/index.js";

// Testdaten erfunden.
const own = ["anna@example.test"];
const now = new Date("2026-10-10T12:00:00Z");
const sent = (body: string, daysAgo = 4, to = "lukas@kreativwerk.example") => ({
  date: new Date(now.getTime() - daysAgo * 86_400_000).toISOString(),
  to: [{ name: "Lukas Brandt", address: to }],
  cc: [],
  bodyText: body,
  snippet: body,
});

describe("Nachhak-Wächter (W11.5)", () => {
  it("erwartet eine Antwort bei Frage oder Bitte im eigenen Text – nicht im Zitat, nicht bei „nur zur Info“", () => {
    expect(expectsReply("Hallo Lukas,\nwann passt dir der Termin?\nAnna")).toBe(true);
    expect(expectsReply("Hallo,\nbitte schick mir die Rechnung.\nAnna")).toBe(true);
    expect(expectsReply("Gib mir Bescheid, ob das klappt.")).toBe(true);
    expect(expectsReply("Danke dir, schönes Wochenende!\nAnna")).toBe(false);
    expect(expectsReply("Anbei das Protokoll, nur zur Info.\nKommt ihr klar?")).toBe(false);
    expect(expectsReply("Danke!\n\nAm 3. Oktober schrieb Lukas:\n> Wann passt es dir?")).toBe(false);
    expect(expectsReply("Danke!\n> Wann passt es dir?")).toBe(false);
  });

  it("wartet nach 3 Tagen ohne Antwort, nicht bei Antwort, Systemadressen oder zu alten Mails", () => {
    const question = sent("Hallo Lukas,\nhast du das Angebot schon gesehen?\nAnna");
    expect(awaitsReply(question, [], own, now)).toBe(true);
    expect(awaitsReply(sent("Kannst du mir helfen?", 2), [], own, now)).toBe(false);
    expect(awaitsReply(sent("Kannst du mir helfen?", 40), [], own, now)).toBe(false);
    expect(awaitsReply(sent("Kannst du mir helfen?", 4, "noreply@shop.example"), [], own, now)).toBe(false);
    expect(awaitsReply(sent("Kannst du mir helfen?", 4, "anna@example.test"), [], own, now)).toBe(false);
    const reply = { date: new Date(now.getTime() - 86_400_000).toISOString(), from: { name: null, address: "lukas@kreativwerk.example" } };
    expect(awaitsReply(question, [reply], own, now)).toBe(false);
    // Eigene spätere Mail im Verlauf ist keine Antwort
    expect(awaitsReply(question, [{ ...reply, from: { name: null, address: "anna@example.test" } }], own, now)).toBe(true);
    expect(awaitsReply(question, [], own, now, true)).toBe(false);
    expect(isNoReplyAddress("no-reply@bank.example")).toBe(true);
    expect(isNoReplyAddress("noreply+123@x.example")).toBe(true);
    expect(isNoReplyAddress("lukas@kreativwerk.example")).toBe(false);
  });

  it("Nachhak-Text: „du“ oder „Sie“ wie in der eigenen Mail", () => {
    const du = followUpReplyText({ date: "2026-10-06T10:00:00Z", subject: "Angebot", bodyText: "Hallo Lukas, hast du Zeit?", snippet: "" }, { name: "Lukas Brandt", address: "l@x.example" });
    expect(du).toMatch(/^Hallo Lukas,/);
    expect(du).toContain("6. Oktober");
    expect(du).toContain("hast du sie gesehen?");
    const sie = followUpReplyText({ date: "2026-10-06T10:00:00Z", subject: "Angebot", bodyText: "Können Sie mir das Angebot schicken?", snippet: "" }, { name: "Petra Schulz", address: "p@x.example" });
    expect(sie).toMatch(/^Guten Tag,/);
    expect(sie).toContain("Haben Sie");
  });
});
