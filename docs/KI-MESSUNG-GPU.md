# KI-Messung auf dem eigenen PC (Grafikkarte)

> **Zum Benutzen braucht es diese Anleitung nicht:** Bonsai lässt sich direkt in StinkyMail unter Optionen → KI
> herunterladen; die App lädt und startet die PrismML-Laufzeit selbst. Diese Anleitung ist nur für die **Messung** mit
> dem Testsatz (Vergleichszahlen für `docs/KI-MESSUNG.md`).

Anleitung, um Modelle wie **Ternary Bonsai 2** (PrismML) mit demselben Testsatz zu messen wie Gemma – auf dem eigenen
Windows-PC mit NVIDIA-Grafikkarte. Alles läuft lokal; der Testsatz besteht nur aus erfundenen Mails. Ergebnisse bitte
mit den Ausgabedateien zurückgeben (siehe unten), dann trage ich sie in `docs/KI-MESSUNG.md` ein.

> Zur Einordnung: Standard bleibt ein ~3B-Modell auf schwacher Hardware. Diese Messung zeigt nur, was ein
> **optionaler** „eigener Server“ (Spezifikation 5.3) mit großem Modell bringen würde.

## 1. Programme

- **Node.js 22** (LTS) und **Git** – falls noch nicht da.
- **llama.cpp von PrismML** (nötig für die Bonsai-Formate `PQ2_0`/`PTQ1_0`, die das normale llama.cpp nicht kennt):
  Releases unter <https://github.com/PrismML-Eng/llama.cpp/releases> – die Windows-Datei mit **CUDA 12.4** im Namen
  nehmen (laut PrismML stürzen die CUDA-13.3-Builds unter Windows teils kommentarlos ab) und entpacken, z. B. nach
  `C:\bonsai\llama`. Alternativ richtet das Repo <https://github.com/PrismML-Eng/Bonsai-demo> alles automatisch ein.
  - Startet die CUDA-Variante nicht (bekanntes Problem auf manchen CPUs), testweise die CPU-Variante nehmen.

## 2. Modelle (Hugging Face, Apache 2.0)

In einen Ordner, z. B. `C:\bonsai\models`:

| Modell | Datei | Größe |
|---|---|---|
| Bonsai 2 9B | `Ternary-Bonsai-2-9B-PQ2_0.gguf` aus `prism-ml/Ternary-Bonsai-2-9B-gguf` | 2,4 GB |
| Bonsai 2 27B | `Ternary-Bonsai-2-27B-PQ2_0.gguf` aus `prism-ml/Ternary-Bonsai-2-27B-gguf` | 7,2 GB |

`PQ2_0` ist laut PrismML das bevorzugte Format für CUDA und CPU (in unserer CPU-Messung ~6× schneller als `PTQ1_0`).
Beide passen zusammen mit 16K-Kontext in die 16 GB der RTX 4070 Ti Super – aber **nacheinander** messen, nicht gleichzeitig.

## 3. Server starten (eine Eingabeaufforderung offen lassen)

```bat
cd C:\bonsai\llama
llama-server.exe -m C:\bonsai\models\Ternary-Bonsai-2-9B-PQ2_0.gguf -ngl 99 -fa on -c 16384 -np 1 --port 8080 --jinja
```

Für 27B denselben Befehl mit `Ternary-Bonsai-2-27B-PQ2_0.gguf`. Der Server lauscht nur auf `127.0.0.1`.
Kurztest im Browser: <http://127.0.0.1:8080/health> zeigt `{"status":"ok"}`.

## 4. Messen (zweite Eingabeaufforderung)

```bat
git clone https://github.com/Rene2203/StinkyMa.git
cd StinkyMa
git checkout claude/ki-mail-app-ipados-dirvmz
cd web
npm install
```

Dann je Modell (Name anpassen; der erste Parameter `.` ist bei `--server` ohne Bedeutung):

```bat
npx tsx packages/core/scripts/eval-models.ts . --server http://127.0.0.1:8080 --server-name "Bonsai 2 9B GPU" > 9b-test.txt
npx tsx packages/core/scripts/eval-models.ts . --server http://127.0.0.1:8080 --server-name "Bonsai 2 9B GPU" --holdout > 9b-kontrolle.txt
npx tsx packages/core/scripts/eval-models.ts . --server http://127.0.0.1:8080 --server-name "Bonsai 2 9B GPU" --summaries > 9b-zusammenfassungen.txt
npx tsx packages/core/scripts/eval-models.ts . --server http://127.0.0.1:8080 --server-name "Bonsai 2 9B GPU" --actions > 9b-aktionen.txt
```

Optional weitere Teile: `--replies`, `--rules`, `--subscriptions`, `--receipts`, `--promises`, `--user-categories`.

Nützliche Schalter:
- `--limit 20` – gleichmäßig verteilte Stichprobe von 20 Mails statt aller 80 (schneller Überblick).
- `--server-body "{\"reasoning_effort\":\"none\"}"` – zusätzliche Felder je Anfrage. Nur nötig, falls das 27B trotz
  allem anfängt „nachzudenken“ (lange Antwortzeiten, leere Antworten). In unserer Messung war das nicht nötig.

**Zum Vergleich auf derselben Grafikkarte** (Modellordner = `%APPDATA%\StinkyMail\models`, dort liegen die Gemma-Dateien,
wenn die App sie heruntergeladen hat):

```bat
npx tsx packages/core/scripts/eval-models.ts "%APPDATA%\StinkyMail\models" gemma-4-e2b-q4 gemma-4-e4b-q4 --gpu > gemma-gpu.txt
```

## 5. Zurückgeben

Die `.txt`-Dateien reichen. Sie enthalten nur Ergebnisse zu den erfundenen Testmails, keine eigenen Daten.
