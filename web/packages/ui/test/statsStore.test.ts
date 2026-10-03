import { describe, expect, it } from "vitest";
import { createMockData, InMemoryMailRepository, type MailboxStats, type RuleInput, type RulesApi, type StatsApi, type StatsPeriod } from "@stinkyma/core";
import { BrowserStore } from "../src/store.js";

// Testdaten erfunden.
function fakeStats() {
  const dismissed = new Set<string>();
  const periods: StatsPeriod[] = [];
  const suggestion = { key: "autoArchive:info@paket.example", kind: "autoArchive" as const, address: "info@paket.example", name: "Paketdienst", received: 6, read: 0, trashedUnread: 2, messageId: "m1" };
  const api: StatsApi = {
    overview: async (period): Promise<MailboxStats> => {
      periods.push(period);
      return {
        period, since: "2026-09-03T00:00:00Z", received: 10, sent: 2, unreadShare: 0.5, weeks: [], topSenders: [], categories: [], myReply: null, busiestWeekday: 1, busiestHour: 9,
        suggestions: dismissed.has(suggestion.key) ? [] : [suggestion],
      };
    },
    dismiss: async (key) => void dismissed.add(key),
    resetDismissed: async () => dismissed.clear(),
  };
  return { api, periods, suggestion };
}

describe("Statistik & Mail-Diät in der Oberfläche", () => {
  it("öffnet, wechselt den Zeitraum, blendet aus und legt eine Archiv-Regel an", async () => {
    const { api, periods, suggestion } = fakeStats();
    const saved: { input: RuleInput; applyToExisting: boolean }[] = [];
    const rules = {
      list: async () => [], folders: async () => [],
      save: async (input: RuleInput, applyToExisting: boolean) => {
        saved.push({ input, applyToExisting });
        return { id: "r1", text: input.text, accountId: null, definition: input.definition, enabled: true, createdAt: "2026-10-03T10:00:00Z" };
      },
    } as unknown as RulesApi;
    const store = new BrowserStore(new InMemoryMailRepository(createMockData()), { stats: api, rules });
    expect(store.canStats).toBe(true);
    await store.openStats();
    expect(store.getState().panel).toBe("stats");
    expect(store.getState().stats?.data?.received).toBe(10);
    await store.setStatsPeriod(365);
    expect(periods).toEqual([30, 365]);
    expect(store.getState().stats?.data?.period).toBe(365);

    await store.dietAutoArchive(suggestion, true);
    expect(saved[0]?.applyToExisting).toBe(true);
    expect(saved[0]?.input.definition).toMatchObject({ from: ["info@paket.example"], move: "archive", markRead: true });
    expect(store.getState().stats?.note).toEqual({ kind: "autoArchive", address: "info@paket.example", moved: true });

    await store.dismissDiet(suggestion.key);
    expect(store.getState().stats?.data?.suggestions).toEqual([]);
    await store.resetDiet();
    expect(store.getState().stats?.data?.suggestions).toHaveLength(1);
    store.closeStats();
    expect(store.getState().panel).toBe("mail");
  });
});
