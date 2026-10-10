import { describe, expect, it } from "vitest";
import { createMockData, InMemoryMailRepository } from "@stinkyma/core";
import { BrowserStore } from "../src/store.js";

const labels = { wrote: () => "", forwardHeader: () => "" };

describe("Link-Prüfer in der Oberfläche (W11.1)", () => {
  it("öffnet Unauffälliges sofort (ohne Tracking), fragt bei Auffälligem nach, mailto öffnet den Editor", async () => {
    const store = new BrowserStore(new InMemoryMailRepository(createMockData()));
    await store.start();
    expect(store.openLink("https://shop.example/a?utm_source=nl&id=2", "Zum Angebot", labels)).toBe("https://shop.example/a?id=2");
    expect(store.getState().linkCheck).toBeNull();

    expect(store.openLink("https://paypa1.example/login", "Jetzt anmelden", labels)).toBeNull();
    expect(store.getState().linkCheck?.check).toMatchObject({ level: "danger", host: "paypa1.example" });
    store.closeLinkCheck();
    expect(store.getState().linkCheck).toBeNull();

    expect(store.openLink("mailto:verein@club.example?subject=Anmeldung", "Schreib uns", labels)).toBeNull();
    expect(store.getState().compose).toMatchObject({ mode: "new", to: [{ name: null, address: "verein@club.example" }], subject: "Anmeldung" });
  });
});
