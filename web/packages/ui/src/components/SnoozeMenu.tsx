import { AlarmClock, AlarmClockOff } from "lucide-react";
import { isSnoozed, snoozeOptions, type Message } from "@stinkyma/core";
import { useEffect, useRef, useState } from "react";
import { useUi } from "../context.js";

function localInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Schlummern (W11.3): Knopf in der Werkzeugleiste mit Zeitvorschlägen und eigenem Zeitpunkt */
export function SnoozeMenu({ message }: { message: Message }) {
  const { store, t, locale } = useUi();
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const lang = locale === "de" ? "de-DE" : "en-GB";
  const snoozed = isSnoozed(message);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const when = (date: Date) => date.toLocaleString(lang, { weekday: "short", hour: "2-digit", minute: "2-digit" });
  const pick = (date: Date) => {
    setOpen(false);
    void store.snooze([message.id], date);
  };
  const customDate = custom ? new Date(custom) : null;
  const customValid = customDate !== null && !Number.isNaN(customDate.getTime()) && customDate.getTime() > Date.now();

  return (
    <div className="snooze" ref={root}>
      <button
        type="button"
        title={snoozed && message.snoozedUntil ? t("snooze.until", { when: new Date(message.snoozedUntil).toLocaleString(lang, { dateStyle: "medium", timeStyle: "short" }) }) : `${t("snooze.action")} (B)`}
        aria-label={t("snooze.action")}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="action-snooze"
        onClick={() => {
          setCustom(localInputValue(new Date(Date.now() + 24 * 3_600_000)));
          setOpen(!open);
        }}
      >
        <AlarmClock size={17} />
      </button>
      {open && (
        <div className="snooze-menu" role="menu" data-testid="snooze-menu">
          <p className="snooze-title">{t("snooze.title")}</p>
          {snoozeOptions().map((o) => (
            <button key={o.preset} type="button" role="menuitem" data-testid={`snooze-${o.preset}`} onClick={() => pick(o.at)}>
              <span>{t(`snooze.preset.${o.preset}`)}</span>
              <span className="muted small">{when(o.at)}</span>
            </button>
          ))}
          <div className="snooze-custom">
            <input type="datetime-local" aria-label={t("snooze.custom")} data-testid="snooze-custom" value={custom} min={localInputValue(new Date())} onChange={(e) => setCustom(e.target.value)} />
            <button type="button" disabled={!customValid} data-testid="snooze-custom-ok" onClick={() => customDate && pick(customDate)}>
              {t("snooze.ok")}
            </button>
          </div>
          {snoozed && (
            <button
              type="button"
              role="menuitem"
              data-testid="snooze-wake"
              onClick={() => {
                setOpen(false);
                void store.unsnooze([message.id]);
              }}
            >
              <span>
                <AlarmClockOff size={14} aria-hidden="true" /> {t("snooze.wake")}
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
