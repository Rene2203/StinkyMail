import { ChevronDown } from "lucide-react";
import { useRef, useState } from "react";
import { useUi } from "../context.js";
import { TimeChoices, usePopover } from "./TimeChoices.js";

/** Später senden (W11.4): Pfeil neben „Senden“ – die Mail wartet im Postausgang bis zum gewählten Zeitpunkt */
export function SendLaterMenu({ disabled, onPick }: { disabled: boolean; onPick: (at: Date) => void }) {
  const { t } = useUi();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  usePopover(open, setOpen, root);
  return (
    <div className="snooze send-later" ref={root}>
      <button
        type="button"
        className="primary send-later-toggle"
        disabled={disabled}
        aria-label={t("sendLater.action")}
        title={t("sendLater.action")}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="compose-send-later"
        onClick={() => setOpen(!open)}
      >
        <ChevronDown size={15} />
      </button>
      {open && (
        <div className="snooze-menu send-later-menu" role="menu" data-testid="send-later-menu">
          <p className="snooze-title">{t("sendLater.title")}</p>
          <TimeChoices
            testPrefix="send-later"
            okLabel={t("sendLater.ok")}
            onPick={(at) => {
              setOpen(false);
              onPick(at);
            }}
          />
        </div>
      )}
    </div>
  );
}
