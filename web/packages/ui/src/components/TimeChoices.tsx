import { snoozeOptions } from "@stinkyma/core";
import { useEffect, useState, type RefObject } from "react";
import { useUi } from "../context.js";

function localInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Zeitvorschläge („Morgen früh“ …) und eigener Zeitpunkt – für Schlummern und Später senden */
export function TimeChoices({ onPick, testPrefix, okLabel }: { onPick: (at: Date) => void; testPrefix: string; okLabel: string }) {
  const { t, locale } = useUi();
  const [custom, setCustom] = useState(() => localInputValue(new Date(Date.now() + 24 * 3_600_000)));
  const lang = locale === "de" ? "de-DE" : "en-GB";
  const when = (date: Date) => date.toLocaleString(lang, { weekday: "short", hour: "2-digit", minute: "2-digit" });
  const customDate = custom ? new Date(custom) : null;
  const customValid = customDate !== null && !Number.isNaN(customDate.getTime()) && customDate.getTime() > Date.now();
  return (
    <>
      {snoozeOptions().map((o) => (
        <button key={o.preset} type="button" role="menuitem" data-testid={`${testPrefix}-${o.preset}`} onClick={() => onPick(o.at)}>
          <span>{t(`snooze.preset.${o.preset}`)}</span>
          <span className="muted small">{when(o.at)}</span>
        </button>
      ))}
      <div className="snooze-custom">
        <input type="datetime-local" aria-label={t("snooze.custom")} data-testid={`${testPrefix}-custom`} value={custom} min={localInputValue(new Date())} onChange={(e) => setCustom(e.target.value)} />
        <button type="button" disabled={!customValid} data-testid={`${testPrefix}-custom-ok`} onClick={() => customDate && onPick(customDate)}>
          {okLabel}
        </button>
      </div>
    </>
  );
}

/** Schließt ein Aufklappmenü bei Klick daneben oder Escape (Escape schließt dann nur das Menü, nicht den Dialog dahinter) */
export function usePopover(open: boolean, setOpen: (open: boolean) => void, root: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open, setOpen, root]);
}
