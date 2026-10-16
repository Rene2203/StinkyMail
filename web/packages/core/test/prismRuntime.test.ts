import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMockData, modelCatalog, type AIRequest, type CatalogModel } from "../src/index.js";
import { AIService, ModelStore, prismRuntime, prismRuntimeVersion, prismVariant, RuntimeStore, type ManagedProvider, type RuntimeDefinition } from "../src/llm/index.js";
import { AIResultStore, openDatabase, seedIfEmpty, SqliteMailRepository } from "../src/sqlite/index.js";

// Bonsai über die PrismML-Laufzeit: Laufzeit wird mit dem Modell geladen, das Modell läuft über llama-server.
// Testdaten erfunden; Downloads gegen einen lokalen Testserver.

let server: Server;
let base = "";
const archives = new Map<string, Buffer>();

function tarOf(files: Record<string, string>): Buffer {
  const source = mkdtempSync(join(tmpdir(), "stinkyma-prism-src-"));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(source, name)), { recursive: true });
    writeFileSync(join(source, name), content);
  }
  execFileSync("tar", ["-czf", join(source, "a.tar.gz"), "-C", source, ...Object.keys(files)]);
  const data = readFileSync(join(source, "a.tar.gz"));
  rmSync(source, { recursive: true, force: true });
  return data;
}

const asset = (name: string) => {
  const data = archives.get(name) ?? Buffer.alloc(0);
  return { url: `${base}/${name}`, sizeBytes: data.length, sha256: createHash("sha256").update(data).digest("hex"), archive: "tar.gz" as const };
};

beforeAll(async () => {
  // Wie bei PrismML unter Windows: Programm in einem Archiv, Bibliotheken in einem zweiten
  archives.set("main.tar.gz", tarOf({ "llama-server": "#!/bin/sh\n", "llama-server.exe": "MZ" }));
  archives.set("libs.tar.gz", tarOf({ "libcuda-test.so": "lib" }));
  server = createServer((req, res) => {
    const data = archives.get((req.url ?? "").slice(1));
    if (data) res.writeHead(200, { "Content-Length": data.length }).end(data);
    else res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
});

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "stinkyma-prism-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("PrismML-Laufzeit", () => {
  it("kennt feste Ausgaben: Windows mit CUDA (Programm + CUDA-Bibliotheken), Windows/Linux ohne Grafikkarte", () => {
    const cuda = prismRuntime("win32-x64", "cuda");
    expect(cuda?.assets.map((a) => a.url.split("/").at(-1))).toEqual([`llama-${prismRuntimeVersion}-bin-win-cuda-12.4-x64.zip`, "cudart-llama-bin-win-cuda-12.4-x64.zip"]);
    expect(cuda?.key).toBe(`${prismRuntimeVersion}-cuda`);
    expect(prismRuntime("win32-x64", "cpu")?.assets).toHaveLength(1);
    expect(prismRuntime("linux-x64", "cpu")?.assets[0]?.archive).toBe("tar.gz");
    expect(prismRuntime("darwin-arm64", "cpu")).toBeNull();
    for (const a of [...(cuda?.assets ?? []), ...(prismRuntime("win32-x64", "cpu")?.assets ?? [])]) expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    // Ohne Windows nie CUDA (Linux-Ausgabe ist nur für die CPU)
    expect(prismVariant("linux")).toBe("cpu");
  });

  it.skipIf(process.platform === "win32")("lädt mehrere Archive in einen Ordner; Löschen trifft nur diese Laufzeit", async () => {
    const runtime: RuntimeDefinition = { key: "prism-test-cpu", label: "KI-Laufzeit für Bonsai", assets: [asset("main.tar.gz"), asset("libs.tar.gz")] };
    const store = new RuntimeStore(dir, { runtime });
    expect(store.sizeBytes).toBe(runtime.assets[0]!.sizeBytes + runtime.assets[1]!.sizeBytes);
    const progress: number[] = [];
    const path = await store.download({ onProgress: (p) => progress.push(p.receivedBytes) });
    expect(path).toBe(join(dir, "prism-test-cpu", "llama-server"));
    expect(existsSync(join(dir, "prism-test-cpu", "libcuda-test.so"))).toBe(true);
    expect(progress.at(-1)).toBe(store.sizeBytes);
    // Andere Laufzeit im selben Ordner (Bild-Laufzeit) bleibt beim Löschen
    mkdirSync(join(dir, "b11320"));
    writeFileSync(join(dir, "b11320", ".complete"), "b11320");
    await store.delete();
    expect(await store.serverPath()).toBeNull();
    expect(existsSync(join(dir, "b11320", ".complete"))).toBe(true);
  });

  it("verwirft ein beschädigtes Archiv und entpackt dann nichts", async () => {
    const runtime: RuntimeDefinition = { key: "prism-test-cpu", label: "KI-Laufzeit für Bonsai", assets: [asset("main.tar.gz"), { ...asset("libs.tar.gz"), sha256: "0".repeat(64) }] };
    const store = new RuntimeStore(dir, { runtime });
    await expect(store.download()).rejects.toThrow(/Prüfsumme/);
    expect(await store.serverPath()).toBeNull();
    expect(existsSync(join(dir, "prism-test-cpu"))).toBe(false);
  });

  it("Katalog: Bonsai 9B und 27B mit fester Prüfsumme über die PrismML-Laufzeit", () => {
    const bonsai = modelCatalog.filter((m) => m.family === "bonsai");
    expect(bonsai.map((m) => [m.id, m.runtime, m.quantization])).toEqual([
      ["bonsai-2-9b-pq2", "prism", "PQ2_0"],
      ["bonsai-2-27b-pq2", "prism", "PQ2_0"],
    ]);
    for (const m of bonsai) expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(modelCatalog.filter((m) => m.recommended).map((m) => m.id)).toEqual(["gemma-4-e2b-q4"]);
  });
});

class FakeServer implements ManagedProvider {
  readonly privacyClass = "onDevice" as const;
  readonly contextWindow = 16_384;
  readonly acceptsImages = false;
  readonly displayName = "Bonsai";
  requests: AIRequest[] = [];
  constructor(readonly id: string, readonly paths: { server: string; model: string }) {}
  async generate(request: AIRequest) {
    this.requests.push(request);
    const text = request.task === "categorize" ? '{"category":"work","confidence":0.8}' : '{"summary":"Es geht um den Grillabend.","openPoints":[],"waitingOn":"nobody"}';
    return { text, providerId: this.id, privacyClass: this.privacyClass, durationMs: 5 };
  }
  async unload() {}
  async dispose() {}
}

describe("AIService – Bonsai", () => {
  const bonsai: CatalogModel = {
    id: "bonsai-test", name: "Bonsai Test", family: "bonsai", paramsB: 9, quantization: "PQ2_0", runtime: "prism",
    url: "https://models.example/bonsai.gguf", sizeBytes: 4, sha256: "0".repeat(64), minRamGb: 4, capabilities: ["text"], license: "Apache-2.0", note: "",
  };
  const gemma: CatalogModel = { ...bonsai, id: "gemma-test", name: "Gemma Test", family: "gemma", quantization: "Q4_K_M", runtime: undefined };

  function setup(options: { runtime?: RuntimeDefinition | null } = {}) {
    const db = openDatabase(":memory:");
    seedIfEmpty(db, createMockData(new Date()));
    const repository = new SqliteMailRepository(db);
    const store = new ModelStore(join(dir, "models"));
    const servers: FakeServer[] = [];
    let builtin = 0;
    let saved: unknown = { enabled: true, modelId: "bonsai-test", autoCategorize: false };
    const runtime = options.runtime === undefined ? { key: "prism-test-cpu", label: "KI-Laufzeit für Bonsai", assets: [asset("main.tar.gz")] } : options.runtime;
    const service = new AIService({
      store,
      results: new AIResultStore(db),
      thread: (id) => repository.thread(id),
      ownAddresses: async () => [],
      settings: { load: () => saved, save: (s) => (saved = s) },
      ramGb: 16,
      catalog: [gemma, bonsai],
      prismRuntime: new RuntimeStore(join(dir, "runtime"), { runtime }),
      createProvider: () => {
        builtin++;
        return new FakeServer("eingebaut", { server: "", model: "" });
      },
      createServerProvider: (model, paths) => {
        const s = new FakeServer(model.id, paths);
        servers.push(s);
        return s;
      },
    });
    const install = (model: CatalogModel) => {
      mkdirSync(dirname(store.pathFor(model)), { recursive: true });
      writeFileSync(store.pathFor(model), "gguf");
    };
    return { service, repository, servers, install, builtin: () => builtin, store };
  }

  it.skipIf(process.platform === "win32")("ohne Laufzeit nur „teilweise“ geladen; der Download holt die Laufzeit nach, dann läuft das Modell über llama-server", async () => {
    const { service, repository, servers, install, builtin } = setup();
    install(bonsai);
    const runtimeBytes = asset("main.tar.gz").sizeBytes;
    let info = (await service.status()).models.find((m) => m.id === "bonsai-test");
    expect(info).toMatchObject({ state: "partial", sizeBytes: 4 + runtimeBytes, receivedBytes: 4 });
    expect((await service.status()).ready).toBe(false);
    await expect(service.summarize((await repository.messages({ kind: "unifiedInbox" }, 1))[0]!.threadId)).rejects.toThrow(/heruntergeladen/);

    await service.download("bonsai-test");
    info = (await service.status()).models.find((m) => m.id === "bonsai-test");
    expect(info).toMatchObject({ state: "installed", sizeBytes: 4 });
    expect((await service.status()).ready).toBe(true);

    const threadId = (await repository.messages({ kind: "unifiedInbox" }, 1))[0]!.threadId;
    const summary = await service.summarize(threadId);
    expect(summary.summary).toContain("Grillabend");
    expect(servers).toHaveLength(1);
    expect(servers[0]!.paths.server).toBe(join(dir, "runtime", "prism-test-cpu", "llama-server"));
    expect(servers[0]!.paths.model.endsWith("bonsai.gguf")).toBe(true);
    expect(builtin()).toBe(0);
  });

  it.skipIf(process.platform === "win32")("löscht die Laufzeit mit dem letzten Bonsai-Modell", async () => {
    const { service, install } = setup();
    install(bonsai);
    await service.download("bonsai-test");
    expect(existsSync(join(dir, "runtime", "prism-test-cpu", ".complete"))).toBe(true);
    await service.deleteModel("bonsai-test");
    expect(existsSync(join(dir, "runtime", "prism-test-cpu"))).toBe(false);
  });

  it("zeigt Bonsai nicht an, wenn es für das System keine Laufzeit gibt; Gemma läuft eingebaut", async () => {
    const { service, install, builtin, repository } = setup({ runtime: null });
    expect((await service.status()).models.map((m) => m.id)).toEqual(["gemma-test"]);
    install(gemma);
    await service.update({ modelId: "gemma-test", enabled: true });
    await service.summarize((await repository.messages({ kind: "unifiedInbox" }, 1))[0]!.threadId);
    expect(builtin()).toBe(1);
  });
});
