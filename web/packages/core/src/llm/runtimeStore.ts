import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { downloadVerified, type DownloadProgress, type ModelFile } from "./modelStore.js";

// llama.cpp als eigenes Programm (llama-server) – nötig für Bilder (Bild-Baustein „mmproj“) und für Bonsai, was die
// eingebaute Laufzeit (node-llama-cpp) beides nicht kann. Wird erst geladen, wenn der Nutzer es braucht.
// Feste Version mit Prüfsumme: Es läuft nur genau das Programm, das wir getestet haben.

const run = promisify(execFile);

export interface RuntimeAsset extends ModelFile {
  archive: "zip" | "tar.gz";
}

/** Eine Laufzeit: ein oder mehrere Archive, die zusammen in einen Ordner entpackt werden. */
export interface RuntimeDefinition {
  /** Ordnername, zugleich Kennung der Version – ändert sie sich, wird neu geladen. */
  key: string;
  /** Für Fehlermeldungen („Die Bild-Laufzeit …“). */
  label: string;
  assets: RuntimeAsset[];
}

export const llamaRuntimeVersion = "b11320";

const release = (file: string) => `https://github.com/ggml-org/llama.cpp/releases/download/${llamaRuntimeVersion}/${file}`;

/** Fertige Programme je Plattform. Windows: Vulkan-Ausgabe (enthält auch die CPU-Varianten). */
export const llamaRuntimeAssets: Partial<Record<string, RuntimeAsset>> = {
  "win32-x64": {
    url: release(`llama-${llamaRuntimeVersion}-bin-win-vulkan-x64.zip`),
    sizeBytes: 33_208_164,
    sha256: "20e11c93085112d15bad9716531954c6752024c023153c96b493349041ae5779",
    archive: "zip",
  },
  "linux-x64": {
    url: release(`llama-${llamaRuntimeVersion}-bin-ubuntu-x64.tar.gz`),
    sizeBytes: 17_544_875,
    sha256: "ef1856938dc1434138ce53688791eb0d2d64cf46e309a0942a12bba3366c0919",
    archive: "tar.gz",
  },
};

// PrismML-Abspaltung von llama.cpp: nur sie kann die ternären Bonsai-Formate (PQ2_0, PTQ1_0). Feste Ausgabe wie in
// PrismMLs eigenem Einrichtungsskript (Bonsai-demo). Windows mit NVIDIA-Karte: CUDA 12.4 (die 13.3-Ausgabe stürzt laut
// PrismML unter Windows teils ab) samt CUDA-Bibliotheken – zusammen ~700 MB, deshalb nicht im Installer.
export const prismRuntimeVersion = "prism-b10777-e3de715";

const prismRelease = (file: string) => `https://github.com/PrismML-Eng/llama.cpp/releases/download/${prismRuntimeVersion}/${file}`;

export type PrismVariant = "cuda" | "cpu";

const prismAssets: Partial<Record<string, RuntimeAsset[]>> = {
  "win32-x64-cuda": [
    {
      url: prismRelease(`llama-${prismRuntimeVersion}-bin-win-cuda-12.4-x64.zip`),
      sizeBytes: 313_951_324,
      sha256: "fa5874a1412e251a6efb13f289e97bacbbb4e7fc6714c1836b4fc6c1dc863462",
      archive: "zip",
    },
    {
      url: prismRelease("cudart-llama-bin-win-cuda-12.4-x64.zip"),
      sizeBytes: 391_443_627,
      sha256: "8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6",
      archive: "zip",
    },
  ],
  "win32-x64-cpu": [
    {
      url: prismRelease(`llama-${prismRuntimeVersion}-bin-win-cpu-x64.zip`),
      sizeBytes: 19_530_958,
      sha256: "cff7eeff19163e6263720618cf98023715b8dac14d0873f5be0918765de323c4",
      archive: "zip",
    },
  ],
  "linux-x64-cpu": [
    {
      url: prismRelease(`llama-${prismRuntimeVersion}-bin-ubuntu-x64.tar.gz`),
      sizeBytes: 17_882_710,
      sha256: "3f97b6fbec0065fede2be92f05df531c1050636fc2613e1ba0d975249df19713",
      archive: "tar.gz",
    },
  ],
};

/** NVIDIA-Treiber installiert? (Windows: nvcuda.dll im Systemordner) – dann die CUDA-Ausgabe, sonst die CPU-Ausgabe. */
export function prismVariant(platform: string = process.platform): PrismVariant {
  if (platform !== "win32") return "cpu";
  return existsSync(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "nvcuda.dll")) ? "cuda" : "cpu";
}

/** PrismML-Laufzeit für diese Plattform (oder null, wenn es keine gibt). */
export function prismRuntime(platform: string = `${process.platform}-${process.arch}`, variant: PrismVariant = prismVariant()): RuntimeDefinition | null {
  const assets = prismAssets[`${platform}-${variant}`];
  return assets ? { key: `${prismRuntimeVersion}-${variant}`, label: "KI-Laufzeit für Bonsai", assets } : null;
}

export class RuntimeStore {
  constructor(
    /** Ordner für Laufzeiten (z. B. %APPDATA%/StinkyMail/runtime). */
    private readonly directory: string,
    private readonly options: { platform?: string; fetchImpl?: typeof fetch; asset?: RuntimeAsset; runtime?: RuntimeDefinition | null } = {},
  ) {}

  /** Welche Laufzeit: ausdrücklich angegeben, sonst die Bild-Laufzeit (llama.cpp) für diese Plattform. */
  get runtime(): RuntimeDefinition | null {
    if (this.options.runtime !== undefined) return this.options.runtime;
    const asset = this.options.asset ?? llamaRuntimeAssets[this.options.platform ?? `${process.platform}-${process.arch}`];
    return asset ? { key: llamaRuntimeVersion, label: "Bild-Laufzeit", assets: [asset] } : null;
  }

  /** Erstes Archiv – zeigt, ob es für dieses System überhaupt eine Laufzeit gibt. */
  get asset(): RuntimeAsset | null {
    return this.runtime?.assets[0] ?? null;
  }

  get sizeBytes(): number {
    return this.runtime?.assets.reduce((sum, asset) => sum + asset.sizeBytes, 0) ?? 0;
  }

  #versionDir(runtime: RuntimeDefinition): string {
    if (!/^[\w.-]+$/.test(runtime.key)) throw new Error("Ungültige Laufzeit-Kennung.");
    return join(this.directory, runtime.key);
  }

  /** Pfad zu llama-server, wenn installiert. */
  async serverPath(): Promise<string | null> {
    const runtime = this.runtime;
    if (!runtime) return null;
    const dir = this.#versionDir(runtime);
    if (!existsSync(join(dir, ".complete"))) return null;
    return findFile(dir, serverName());
  }

  async download(options: { signal?: AbortSignal; onProgress?: (progress: DownloadProgress) => void } = {}): Promise<string> {
    const existing = await this.serverPath();
    if (existing) return existing;
    const runtime = this.runtime;
    if (!runtime) throw new Error("Für dieses System gibt es diese KI-Laufzeit noch nicht.");
    await mkdir(this.directory, { recursive: true });
    const target = this.#versionDir(runtime);
    const total = this.sizeBytes;
    // Erst alle Archive laden und prüfen, dann entpacken – ein Abbruch hinterlässt keinen halben Ordner.
    const archives: { path: string; asset: RuntimeAsset }[] = [];
    let done = 0;
    for (const [index, asset] of runtime.assets.entries()) {
      const path = join(this.directory, `${runtime.key === llamaRuntimeVersion ? `llama-${llamaRuntimeVersion}` : `${runtime.key}-${index}`}.${asset.archive}`);
      await downloadVerified(this.options.fetchImpl ?? fetch, asset, path, options.signal, (received) => options.onProgress?.({ receivedBytes: done + received, totalBytes: total }));
      done += asset.sizeBytes;
      archives.push({ path, asset });
    }
    await rm(target, { recursive: true, force: true });
    await mkdir(target, { recursive: true });
    // Entpacken mit dem tar des Betriebssystems (unter Windows 10/11 eingebaut, kann auch ZIP) – feste Pfade, kein Suchpfad.
    const tar = process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
    for (const { path, asset } of archives) {
      await run(tar, asset.archive === "zip" ? ["-xf", path, "-C", target] : ["-xzf", path, "-C", target]);
      await rm(path, { force: true });
    }
    const server = await findFile(target, serverName());
    if (!server) {
      await rm(target, { recursive: true, force: true });
      throw new Error(`Die ${runtime.label} ist unvollständig. Bitte erneut laden.`);
    }
    // Bibliotheken (z. B. CUDA) neben das Programm, falls ein Archiv sie in einen anderen Unterordner legt
    await gatherLibraries(target, dirname(server));
    await writeFile(join(target, ".complete"), runtime.key);
    return server;
  }

  /** Nur diese Laufzeit löschen – andere im selben Ordner (Bild-Laufzeit, Bonsai) bleiben. */
  async delete(): Promise<void> {
    const runtime = this.runtime;
    if (runtime) await rm(this.#versionDir(runtime), { recursive: true, force: true });
  }
}

function serverName(): string {
  return process.platform === "win32" ? "llama-server.exe" : "llama-server";
}

/** Windows lädt DLLs aus dem Programmordner: verstreute .dll-Dateien dorthin verschieben. */
async function gatherLibraries(root: string, serverDir: string): Promise<void> {
  if (process.platform !== "win32") return;
  for (const entry of await readdir(root)) {
    const path = join(root, entry);
    if (path === serverDir) continue;
    const info = await stat(path);
    if (info.isFile() && entry.toLowerCase().endsWith(".dll") && root !== serverDir) await rename(path, join(serverDir, entry));
  }
}

/** Datei im Ordner suchen (die Archive enthalten je nach Plattform einen Unterordner). */
async function findFile(directory: string, name: string, depth = 2): Promise<string | null> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return null;
  }
  if (entries.includes(name)) return join(directory, name);
  if (depth === 0) return null;
  for (const entry of entries) {
    const path = join(directory, entry);
    if ((await stat(path)).isDirectory()) {
      const found = await findFile(path, name, depth - 1);
      if (found) return found;
    }
  }
  return null;
}
