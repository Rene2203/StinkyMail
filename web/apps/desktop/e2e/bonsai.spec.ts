import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { copyFileSync, mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeQuietly } from "./helpers";

// Bonsai in der echten App: Das Modell liegt schon im Modellordner (STINKYMA_E2E_BONSAI_MODEL, echte Datei
// Ternary-Bonsai-2-9B-PQ2_0.gguf), „Fortsetzen“ lädt die echte PrismML-Laufzeit (mit Prüfsumme) nach, danach fasst
// Bonsai über llama-server zusammen. Lädt aus dem Internet und braucht Minuten – nur von Hand, nicht in der CI.

const modelFile = process.env.STINKYMA_E2E_BONSAI_MODEL;
let app: ElectronApplication;
let page: Page;
let dataDir: string;

test.skip(!modelFile, "Nur mit STINKYMA_E2E_BONSAI_MODEL");
test.setTimeout(900_000);

test.beforeAll(async () => {
  if (!modelFile) return;
  dataDir = mkdtempSync(join(tmpdir(), "stinkyma-e2e-bonsai-"));
  const folder = join(dataDir, "models", "bonsai-2-9b-pq2");
  mkdirSync(folder, { recursive: true });
  const target = join(folder, "Ternary-Bonsai-2-9B-PQ2_0.gguf");
  if (process.platform === "win32") copyFileSync(modelFile, target);
  else symlinkSync(modelFile, target);
  const args = [join(__dirname, ".."), "--lang=de-DE"];
  if (process.platform === "linux") args.push("--no-sandbox");
  app = await electron.launch({ args, env: { ...process.env, STINKYMA_DB: join(dataDir, "e2e.sqlite"), STINKYMA_USER_DATA: dataDir, LANG: "de_DE.UTF-8" } });
  page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
});

test.afterAll(async () => {
  await app?.close();
  if (dataDir) removeQuietly(dataDir);
});

test("Bonsai: Laufzeit nachladen, verwenden, zusammenfassen", async () => {
  await expect(page.getByTestId("message-row").first()).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("open-options").click();
  const row = page.locator('[data-testid="ai-model"][data-model="bonsai-2-9b-pq2"]');

  await test.step("Modell da, Laufzeit fehlt: „Fortsetzen“ lädt sie", async () => {
    await expect(row.getByTestId("ai-model-download")).toHaveText(/Fortsetzen/);
    await row.getByTestId("ai-model-download").click();
    // Erstes Modell: wird nach dem Download gleich verwendet
    await expect(row.getByText("In Benutzung")).toBeVisible({ timeout: 300_000 });
    await expect(page.getByTestId("ai-enabled")).toBeChecked();
    await page.getByRole("button", { name: "Fertig" }).click();
  });

  await test.step("Zusammenfassen mit Bonsai (Herkunft „auf diesem Gerät“)", async () => {
    await page.getByTestId("message-row").first().click();
    await page.getByTestId("action-summarize").click();
    const card = page.getByTestId("summary-card");
    await expect(card).toHaveAttribute("aria-busy", "false", { timeout: 600_000 });
    await expect(card.getByTestId("summary-text")).not.toBeEmpty();
    await expect(card.getByText("Auf diesem Gerät berechnet", { exact: false })).toBeVisible();
  });
});
