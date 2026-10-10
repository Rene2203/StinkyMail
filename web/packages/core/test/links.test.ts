import { describe, expect, it } from "vitest";
import { checkLink, hostToUnicode, linksInText, lookalikeBrand, registrableDomain, stripTracking } from "../src/index.js";

// Testdaten erfunden; Marken-Domains nur als Vergleichsgröße.
describe("Link-Prüfer (W11.1)", () => {
  it("registrierbare Domain und Punycode", () => {
    expect(registrableDomain("news.shop.example")).toBe("shop.example");
    expect(registrableDomain("www.bbc.co.uk")).toBe("bbc.co.uk");
    expect(hostToUnicode("xn--mller-kva.example")).toBe("müller.example");
    expect(hostToUnicode("xn--pple-43d.com")).toBe("аpple.com");
  });

  it("erkennt Doppelgänger bekannter Marken, nicht aber die echten Domains", () => {
    expect(lookalikeBrand("paypa1.com")).toBe("PayPal");
    expect(lookalikeBrand("www.arnazon.de")).toBe("Amazon");
    expect(lookalikeBrand("sparkase.de")).toBe("Sparkasse");
    expect(lookalikeBrand("xn--pple-43d.com")).toBe("Apple");
    expect(lookalikeBrand("paypal.com")).toBeNull();
    expect(lookalikeBrand("amazon.co.uk")).toBeNull();
    expect(lookalikeBrand("deutsche-bank.de")).toBeNull();
    expect(lookalikeBrand("sparkasse-koelnbonn.de")).toBeNull();
    expect(lookalikeBrand("offices.example")).toBeNull();
    expect(lookalikeBrand("shop.example")).toBeNull();
  });

  it("bewertet Links: harmlos, Vorsicht, Gefahr", () => {
    expect(checkLink("https://shop.example/angebote", "Zu den Angeboten")).toMatchObject({ level: "ok", host: "shop.example", warnings: [] });
    // Klickzähler eines Newsletters: anderer Host als der Text – Vorsicht, aber kein Alarm
    const counter = checkLink("https://click.mailer.example/r/123", "www.shop.example");
    expect(counter?.level).toBe("caution");
    expect(counter?.warnings).toEqual([{ code: "mismatch", shown: "www.shop.example" }]);
    // Text zeigt eine Bank, Ziel ist woanders
    expect(checkLink("https://login-hilfe.example/sparkasse", "www.sparkasse.de")?.level).toBe("danger");
    expect(checkLink("https://www.paypal.com/de", "www.paypal.de")?.level).toBe("ok");
    expect(checkLink("https://paypa1.com/login")?.warnings).toContainEqual({ code: "lookalike", brand: "PayPal" });
    expect(checkLink("https://www.paypal.com@betrug.example/login")).toMatchObject({ level: "danger", host: "betrug.example" });
    expect(checkLink("http://192.0.2.7/konto")?.warnings.map((w) => w.code)).toEqual(["ip", "insecure"]);
    expect(checkLink("https://bit.ly/abc")?.warnings).toEqual([{ code: "shortener" }]);
    expect(checkLink("https://xn--mller-kva.example/")).toMatchObject({ level: "caution", host: "müller.example", warnings: [{ code: "punycode", unicode: "müller.example" }] });
    expect(checkLink("https://xn--pple-43d.com/")?.level).toBe("danger");
    expect(checkLink("mailto:a@b.example")).toBeNull();
    expect(checkLink("kein link")).toBeNull();
  });

  it("entfernt Tracking-Parameter, lässt andere stehen", () => {
    expect(stripTracking("https://shop.example/p?id=7&utm_source=nl&utm_medium=mail&fbclid=x")).toEqual({ url: "https://shop.example/p?id=7", removed: 3 });
    expect(stripTracking("https://shop.example/p?utm_campaign=herbst")).toEqual({ url: "https://shop.example/p", removed: 1 });
    expect(stripTracking("https://shop.example/p?q=utm_source")).toEqual({ url: "https://shop.example/p?q=utm_source", removed: 0 });
    expect(checkLink("https://shop.example/?gclid=1&seite=2")).toMatchObject({ url: "https://shop.example/?seite=2", removedParams: 1 });
  });

  it("findet Adressen in reinem Text, ohne Satzzeichen am Ende", () => {
    expect(linksInText("Siehe https://shop.example/a?b=1. Oder www.verein.example, danke (https://x.example/y)").map((l) => l.url)).toEqual([
      "https://shop.example/a?b=1", "https://www.verein.example", "https://x.example/y",
    ]);
  });
});
