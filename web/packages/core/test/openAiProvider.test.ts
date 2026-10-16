import { describe, expect, it } from "vitest";
import { AITimeoutError, OpenAICompatibleProvider, toResponseSchema } from "../src/index.js";

describe("OpenAI-kompatibler Server (eigener Server)", () => {
  it("schickt Nachrichten, Bild und erzwungenes JSON-Schema; liest Antwort und Tokens", async () => {
    let sent: { url: string; body: Record<string, unknown>; headers: Record<string, string> } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      sent = { url, body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> };
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"kategorie":"work"}' } }], usage: { completion_tokens: 7 } }), { status: 200 });
    }) as unknown as typeof fetch;
    const provider = new OpenAICompatibleProvider({ id: "heim", displayName: "Heimserver", baseUrl: "http://192.0.2.10:8080/", apiKey: "geheim", fetchImpl, extraBody: { chat_template_kwargs: { enable_thinking: false } } });
    const response = await provider.generate({
      task: "categorize",
      messages: [{ role: "system", content: "Ordne ein." }, { role: "user", content: "Hallo", images: [{ mimeType: "image/png", base64: "AAAA" }] }],
      jsonSchema: { type: "object", properties: { kategorie: { type: "string", enum: ["work", "personal"] } } },
      maxTokens: 50,
    });
    expect(response).toMatchObject({ text: '{"kategorie":"work"}', providerId: "heim", privacyClass: "ownServer", tokensOut: 7 });
    expect(sent!.url).toBe("http://192.0.2.10:8080/v1/chat/completions");
    expect(sent!.headers.authorization).toBe("Bearer geheim");
    expect(sent!.body).toMatchObject({ max_tokens: 50, temperature: 0, chat_template_kwargs: { enable_thinking: false } });
    expect((sent!.body.messages as unknown[])[1]).toEqual({ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }, { type: "text", text: "Hallo" }] });
    expect(sent!.body.response_format).toEqual({ type: "json_schema", json_schema: { name: "antwort", strict: true, schema: { type: "object", properties: { kategorie: { type: "string", enum: ["work", "personal"] } }, required: ["kategorie"], additionalProperties: false } } });
  });

  it("Fehler und Zeitüberschreitung verständlich", async () => {
    const failing = new OpenAICompatibleProvider({ id: "x", displayName: "Heimserver", baseUrl: "http://192.0.2.10", fetchImpl: (async () => new Response("model not loaded", { status: 503 })) as unknown as typeof fetch });
    await expect(failing.generate({ task: "summarize", messages: [{ role: "user", content: "x" }], maxTokens: 5 })).rejects.toThrow("Heimserver: Fehler 503 – model not loaded");
    const slow = new OpenAICompatibleProvider({
      id: "y", displayName: "Heimserver", baseUrl: "http://192.0.2.10", timeoutMs: 20,
      fetchImpl: ((_u: string, init: RequestInit) => new Promise((_r, reject) => init.signal?.addEventListener("abort", () => reject(new Error("abgebrochen"))))) as unknown as typeof fetch,
    });
    await expect(slow.generate({ task: "summarize", messages: [{ role: "user", content: "x" }], maxTokens: 5 })).rejects.toBeInstanceOf(AITimeoutError);
    expect(toResponseSchema({ type: "array", items: { type: "number" }, maxItems: 3 })).toEqual({ type: "array", items: { type: "number" }, maxItems: 3 });
  });
});
