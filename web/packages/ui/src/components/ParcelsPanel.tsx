import { Check, Copy, ExternalLink, Mail, Package, PackageCheck, RotateCcw, Trash2, X } from "lucide-react";
import { carrierNames, type StoredParcel } from "@stinkyma/core";
import { useBrowserState, useUi } from "../context.js";
import { openExternal } from "./LinkDialog.js";

/** Paket-Übersicht (W12.1): offene Sendungen aus den Mails, zugestellte der letzten zwei Wochen. Ohne KI, ohne Netz. */
export function ParcelsPanel() {
  const { store, t } = useUi();
  const state = useBrowserState();
  const data = state.parcels;
  const view = data?.view;

  return (
    <section className="subs-panel" aria-labelledby="parcels-title" data-testid="parcels">
      <header className="subs-header">
        <Package size={20} aria-hidden="true" />
        <div>
          <h2 id="parcels-title">{t("parcels.title")}</h2>
          <span className="muted small">{t("parcels.subtitle")}</span>
        </div>
        <span className="toolbar-gap" aria-hidden="true" />
        <button type="button" className="icon-button" title={t("subs.close")} aria-label={t("subs.close")} onClick={() => store.closeParcels()}>
          <X size={16} />
        </button>
      </header>
      {data?.error && <p className="dialog-error" role="alert">{data.error}</p>}
      <div className="prom-list">
        {!view && <p className="muted">{t("subs.busy")}</p>}
        {view && view.open.length === 0 && <p className="muted" data-testid="parcels-empty">{t("parcels.empty")}</p>}
        <ul>
          {view?.open.map((p) => <ParcelCard key={p.trackingNumber} parcel={p} />)}
        </ul>
        {view && view.done.length > 0 && (
          <>
            <h3 className="prom-done-heading">{t("parcels.done")}</h3>
            <ul>
              {view.done.map((p) => <ParcelCard key={p.trackingNumber} parcel={p} />)}
            </ul>
          </>
        )}
        <p className="muted small parcels-privacy">{t("parcels.privacy")}</p>
      </div>
    </section>
  );
}

function ParcelCard({ parcel: p }: { parcel: StoredParcel }) {
  const { store, t, locale } = useUi();
  const lang = locale === "de" ? "de-DE" : "en-GB";
  const expected = p.expected ? new Date(`${p.expected}T12:00:00`).toLocaleDateString(lang, { weekday: "short", day: "numeric", month: "short" }) : null;
  const carrier = carrierNames[p.carrier] || t("parcels.unknownCarrier");
  return (
    <li className={`prom-card parcel-card status-${p.status}${p.done ? " done" : ""}`} data-testid="parcel-card">
      <div className="parcel-main">
        <div className="parcel-head">
          {p.done ? <PackageCheck size={16} aria-hidden="true" /> : <Package size={16} aria-hidden="true" />}
          <strong>{p.shop}</strong>
          <span className={`parcel-status status-${p.status}`} data-testid="parcel-status">{t(`parcels.status.${p.status}`)}</span>
        </div>
        <span className="small">
          {carrier} · <span className="parcel-number">{p.trackingNumber}</span>
          <button type="button" className="icon-button parcel-copy" title={t("parcels.copy")} aria-label={t("parcels.copy")} onClick={() => void navigator.clipboard?.writeText(p.trackingNumber)}>
            <Copy size={12} />
          </button>
        </span>
        {expected && !p.done && <span className="small muted">{t("parcels.expected", { date: expected })}</span>}
        <span className="small muted ellipsis" title={p.subject}>{p.subject}</span>
      </div>
      <div className="prom-actions">
        {p.trackingUrl && (
          <button type="button" data-testid="parcel-track" title={p.trackingUrl} onClick={() => openExternal(p.trackingUrl)}>
            <ExternalLink size={13} aria-hidden="true" /> {t("parcels.track")}
          </button>
        )}
        {p.messageId && (
          <button type="button" className="link" onClick={() => p.messageId && void store.openParcelMail(p.messageId)}>
            <Mail size={13} aria-hidden="true" /> {t("parcels.mail")}
          </button>
        )}
        {p.done ? (
          <button type="button" className="link" onClick={() => void store.setParcelDone(p.trackingNumber, false)}>
            <RotateCcw size={13} aria-hidden="true" /> {t("parcels.reopen")}
          </button>
        ) : (
          <button type="button" className="link" data-testid="parcel-done" onClick={() => void store.setParcelDone(p.trackingNumber, true)}>
            <Check size={13} aria-hidden="true" /> {t("parcels.markDone")}
          </button>
        )}
        <button type="button" className="link" title={t("parcels.removeHint")} data-testid="parcel-remove" onClick={() => void store.removeParcel(p.trackingNumber)}>
          <Trash2 size={13} aria-hidden="true" /> {t("parcels.remove")}
        </button>
      </div>
    </li>
  );
}
