import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Versionsnummer aus package.json – erscheint in den Optionen („StinkyMail 0.9.0-rc.1“) */
const version = (JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf8")) as { version: string }).version;

// Main- und Preload-Prozess: Abhängigkeiten aus "dependencies" (better-sqlite3) bleiben extern,
// die eigenen Pakete (@stinkyma/*, TypeScript-Quellen) werden eingebündelt.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve(__dirname, "src/main/index.ts") } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve(__dirname, "src/preload/index.ts") } },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    plugins: [react()],
    define: { __APP_VERSION__: JSON.stringify(version) },
    build: { rollupOptions: { input: resolve(__dirname, "src/renderer/index.html") } },
  },
});
