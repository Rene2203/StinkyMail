import { Check, Hourglass, Reply } from "lucide-react";
import { displayName, type Message } from "@stinkyma/core";
import { composeLabels } from "../composeLabels.js";
import { useUi } from "../context.js";

/** Nachhak-Wächter (W11.5): eigene Mail ohne Antwort – nachhaken oder „nicht nötig“ */
export function FollowUpBar({ message }: { message: Message }) {
  const { store, t, locale } = useUi();
  const days = Math.max(1, Math.floor((Date.now() - Date.parse(message.date)) / 86_400_000));
  const to = message.to[0];
  return (
    <section className="screener-bar follow-up-bar" data-testid="follow-up-bar">
      <Hourglass size={18} aria-hidden="true" />
      <div className="screener-text">
        <strong>{t("followUp.waiting", { days, name: to ? displayName(to) : "–" })}</strong>
        <span className="small">{t("followUp.explain")}</span>
      </div>
      <div className="screener-buttons">
        <button type="button" className="primary" data-testid="follow-up" onClick={() => store.followUp(message, composeLabels(t, locale), locale)}>
          <Reply size={15} aria-hidden="true" /> {t("followUp.action")}
        </button>
        <button type="button" data-testid="follow-up-dismiss" onClick={() => void store.dismissFollowUp(message.id)}>
          <Check size={15} aria-hidden="true" /> {t("followUp.dismiss")}
        </button>
      </div>
    </section>
  );
}
