// Anbieter für Server mit OpenAI-kompatibler Schnittstelle (`/v1/chat/completions`): llama.cpp-Server (auch die
// PrismML-Abspaltung für Bonsai), Ollama, LM Studio, vLLM. Für den eigenen Rechner oder Heimserver (Datenschutzklasse
// „ownServer“, Spezifikation 5.3) – Cloud-Anbieter kämen später mit eigener Freigabe. Plattformneutral (nur fetch).

import { AITimeoutError, type AIProvider, type AIRequest, type AIResponse, type JsonSchema, type PrivacyClass } from "./types.js";


export interface OpenAICompatibleOptions {
  id: string;
  displayName: string;
  /** z. B. http://127.0.0.1:8080 (ohne /v1) */
  baseUrl: string;
  /** Modellname, falls der Server mehrere anbietet (Ollama); llama.cpp ignoriert ihn */
  model?: string;
  /** Nur, wenn der Server einen Schlüssel verlangt – kommt aus dem sicheren Speicher, nie ins Log */
  apiKey?: string;
  privacyClass?: Extract<PrivacyClass, "ownServer" | "cloud">;
  contextWindow?: number;
  acceptsImages?: boolean;
  /** Zusätzliche Felder je Server, z. B. { chat_template_kwargs: { enable_thinking: false } } */
  extraBody?: Record<string, unknown>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** Unser vereinfachtes Schema → JSON-Schema für `response_format` (alle Felder Pflicht, wie bei der lokalen Grammatik) */
export function toResponseSchema(schema: JsonSchema): Record<string, unknown> {
  switch (schema.type) {
    case "object":
      return {
        type: "object",
        properties: Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, toResponseSchema(value)])),
        required: Object.keys(schema.properties),
        additionalProperties: false,
      };
    case "array":
      return { type: "array", items: toResponseSchema(schema.items), ...(schema.maxItems !== undefined ? { maxItems: schema.maxItems } : {}) };
    case "string":
      return schema.enum ? { type: "string", enum: [...schema.enum] } : { type: "string", ...(schema.maxLength !== undefined ? { maxLength: schema.maxLength } : {}) };
    case "number":
      return { type: "number" };
    case "boolean":
      return { type: "boolean" };
  }
}

export class OpenAICompatibleProvider implements AIProvider {
  readonly id: string;
  readonly displayName: string;
  readonly privacyClass: Extract<PrivacyClass, "ownServer" | "cloud">;
  readonly contextWindow: number;
  readonly acceptsImages: boolean;
  readonly #options: OpenAICompatibleOptions;

  constructor(options: OpenAICompatibleOptions) {
    this.#options = options;
    this.id = options.id;
    this.displayName = options.displayName;
    this.privacyClass = options.privacyClass ?? "ownServer";
    this.contextWindow = options.contextWindow ?? 16_384;
    this.acceptsImages = options.acceptsImages ?? false;
  }

  async generate(request: AIRequest, signal?: AbortSignal): Promise<AIResponse> {
    const o = this.#options;
    const started = performance.now();
    const messages = request.messages.map((m) =>
      m.images?.length
        ? { role: m.role, content: [...m.images.map((img) => ({ type: "image_url", image_url: { url: `data:${img.mimeType};base64,${img.base64}` } })), { type: "text", text: m.content }] }
        : { role: m.role, content: m.content },
    );
    const body: Record<string, unknown> = {
      ...(o.model ? { model: o.model } : {}),
      messages,
      max_tokens: request.maxTokens,
      temperature: request.temperature ?? 0,
      stream: false,
      ...(request.jsonSchema ? { response_format: { type: "json_schema", json_schema: { name: "antwort", strict: true, schema: toResponseSchema(request.jsonSchema) } } } : {}),
      ...o.extraBody,
    };
    const timeout = AbortSignal.timeout(o.timeoutMs ?? 300_000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await (o.fetchImpl ?? fetch)(`${o.baseUrl.replace(/\/+$/, "")}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(o.apiKey ? { authorization: `Bearer ${o.apiKey}` } : {}) },
        body: JSON.stringify(body),
        signal: combined,
      });
    } catch (error) {
      if (timeout.aborted && !signal?.aborted) throw new AITimeoutError(`${o.displayName} hat nicht rechtzeitig geantwortet.`);
      throw new Error(`${o.displayName} ist nicht erreichbar (${error instanceof Error ? error.message : String(error)}).`);
    }
    if (!response.ok) {
      // Fehlertext des Servers nur gekürzt – er kann Teile der Anfrage (Mail-Inhalt) wiederholen
      const detail = (await response.text().catch(() => "")).slice(0, 200);
      throw new Error(`${o.displayName}: Fehler ${response.status}${detail ? ` – ${detail}` : ""}`);
    }
    const json = (await response.json()) as { choices?: { message?: { content?: string | null } }[]; usage?: { completion_tokens?: number } };
    const text = json.choices?.[0]?.message?.content ?? "";
    return {
      text,
      providerId: this.id,
      privacyClass: this.privacyClass,
      durationMs: Math.round(performance.now() - started),
      ...(json.usage?.completion_tokens !== undefined ? { tokensOut: json.usage.completion_tokens } : {}),
    };
  }
}
