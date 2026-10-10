import { AlarmClock, AlarmClockOff } from "lucide-react";
import { isSnoozed, type Message } from "@stinkyma/core";
import { useRef, useState } from "react";
import { useUi } from "../context.js";
import { TimeChoices, usePopover } from "./TimeChoices.js";

/** Schlummern (W11.3): Knopf in der Werkzeugleiste mit Zeitvorschlägen und eigenem Zeitpunkt */
export function SnoozeMenu({ message }: { message: Message }) {
  const { store, t, locale } = useUi();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  usePopover(open, setOpen, root);
  const snoozed = isSnoozed(message);
  const pick = (date: Date) => {
    setOpen(false);
    void store.snooze([message.id], date);
  };

  return (
    <div className="snooze" ref={root}>
      <button
        type="button"
        title={snoozed && message.snoozedUntil ? t("snooze.until", { when: new Date(message.snoozedUntil).toLocaleString(locale === "de" ? "de-DE" : "en-GB", { dateStyle: "medium", timeStyle: "short" }) }) : `${t("snooze.action")} (B)`}
        aria-label={t("snooze.action")}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="action-snooze"
        onClick={() => setOpen(!open)}
      >
        <AlarmClock size={17} />
      </button>
      {open && (
        <div className="snooze-menu" role="menu" data-testid="snooze-menu">
          <p className="snooze-title">{t("snooze.title")}</p>
          <TimeChoices onPick={pick} testPrefix="snooze" okLabel={t("snooze.ok")} />
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
