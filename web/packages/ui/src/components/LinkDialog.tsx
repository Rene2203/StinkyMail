import { ExternalLink, ShieldAlert, TriangleAlert } from "lucide-react";
import type { LinkWarning } from "@stinkyma/core";
import { useEffect, useRef } from "react";
import { useBrowserState, useUi } from "../context.js";
import type { Translate } from "../i18n.js";

export function linkWarningText(w: LinkWarning, host: string, t: Translate): string {
  switch (w.code) {
    case "mismatch":
      return t(w.brand ? "link.mismatchBrand" : "link.mismatch", { shown: w.shown, host });
    case "lookalike":
      return t("link.lookalike", { brand: w.brand, host });
    case "punycode":
      return t("link.punycode", { host: w.unicode });
    case "mixedScript":
      return t("link.mixedScript", { host: w.unicode });
    case "ip":
      return t("link.ip");
    case "userinfo":
      return t("link.userinfo", { fake: w.fake, host });
    case "shortener":
      return t("link.shortener");
    case "insecure":
      return t("link.insecure");
  }
}

/** Öffnet eine geprüfte Adresse im Standard-Browser (in der App: über den Hauptprozess). */
export function openExternal(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

/** Rückfrage vor einem auffälligen Link (W11.1): wohin er wirklich führt und warum er auffällt. */
export function LinkDialog() {
  const { store, t } = useUi();
  const state = useBrowserState();
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    cancel.current?.focus();
  }, []);
  const entry = state.linkCheck;
  if (!entry) return null;
  const { check } = entry;
  const danger = check.level === "danger";
  const Icon = danger ? ShieldAlert : TriangleAlert;

  return (
    <dialog ref={dialog} className={`dialog link-dialog ${check.level}`} aria-labelledby="link-title" data-testid="link-dialog" onClose={() => store.closeLinkCheck()}>
      <div className="link-dialog-body">
        <header>
          <Icon size={20} aria-hidden="true" />
          <h2 id="link-title">{t(danger ? "link.titleDanger" : "link.titleCaution")}</h2>
        </header>
        <p className="small muted">{t("link.leadsTo")}</p>
        <p className="link-host" data-testid="link-host">{check.host}</p>
        <p className="link-url small" title={check.url}>{check.url}</p>
        <ul className="link-warnings">
          {check.warnings.map((w, i) => (
            <li key={i} data-code={w.code}>{linkWarningText(w, check.host, t)}</li>
          ))}
        </ul>
        {check.removedParams > 0 && <p className="small muted">{t("link.tracking", { n: check.removedParams })}</p>}
        <footer className="dialog-footer">
          <button ref={cancel} type="button" className="primary" data-testid="link-cancel" onClick={() => store.closeLinkCheck()}>
            {t("link.cancel")}
          </button>
          <button
            type="button"
            className={danger ? "danger" : ""}
            data-testid="link-open"
            onClick={() => {
              openExternal(check.url);
              store.closeLinkCheck();
            }}
          >
            <ExternalLink size={14} aria-hidden="true" /> {t(danger ? "link.openAnyway" : "link.open")}
          </button>
        </footer>
      </div>
    </dialog>
  );
}
