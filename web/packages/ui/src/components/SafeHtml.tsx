import { ImageDown, ShieldCheck } from "lucide-react";
import { matchRemoteContentException, senderDomain } from "@stinkyma/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { composeLabels } from "../composeLabels.js";
import { useBrowserState, useUi } from "../context.js";
import { openExternal } from "./LinkDialog.js";
import { emailDocument, sanitizeEmailHtml } from "../sanitize.js";

/**
 * HTML-Mail in einem Sandbox-Frame: Skripte sind abgeschaltet (kein allow-scripts), Links öffnen im Browser.
 * allow-same-origin ohne allow-scripts ist unbedenklich und erlaubt, die Höhe des Inhalts zu messen.
 */
export function SafeHtml({ html, sender, remoteActions = true }: { html: string; sender: string; remoteActions?: boolean }) {
  const { store, t, locale } = useUi();
  const { remoteContentExceptions } = useBrowserState();
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);
  // Externe Inhalte nur auf Wunsch (Spezifikation 7.2): per Klick für diese eine Mail (nicht gespeichert)
  // oder dauerhaft für Absender aus der Ausnahmeliste in den Optionen.
  const [loadedByClick, setLoadedByClick] = useState(false);
  const exception = matchRemoteContentException(remoteContentExceptions, sender);
  const allowRemote = loadedByClick || exception !== null;
  const sanitized = useMemo(() => sanitizeEmailHtml(html, { allowRemote }), [html, allowRemote]);

  useEffect(() => {
    const iframe = frame.current;
    if (!iframe) return;
    let observer: ResizeObserver | undefined;
    // Link-Prüfer (W11.1): Klicks auf Links abfangen und erst prüfen – geöffnet wird außerhalb der App
    const onClick = (event: MouseEvent) => {
      const target = event.target as { closest?: (selector: string) => Element | null } | null;
      const link = target?.closest?.("a[href]");
      if (!link) return;
      event.preventDefault();
      const url = store.openLink(link.getAttribute("href") ?? "", link.textContent ?? "", composeLabels(t, locale));
      if (url) openExternal(url);
    };
    let attached: Document | null = null;
    const measure = () => {
      const doc = iframe.contentDocument;
      if (!doc?.documentElement) return;
      if (attached !== doc) {
        doc.addEventListener("click", onClick);
        doc.addEventListener("auxclick", onClick);
        attached = doc;
      }
      setHeight(Math.max(40, doc.documentElement.scrollHeight));
      if (!observer && doc.body) {
        observer = new ResizeObserver(() => setHeight(Math.max(40, doc.documentElement.scrollHeight)));
        observer.observe(doc.body);
      }
    };
    iframe.addEventListener("load", measure);
    return () => {
      iframe.removeEventListener("load", measure);
      attached?.removeEventListener("click", onClick);
      attached?.removeEventListener("auxclick", onClick);
      observer?.disconnect();
    };
  }, [sanitized.html, store, t, locale]);

  return (
    <div className="safe-html">
      {sanitized.blockedRemote > 0 && (
        <p className="blocked-note">
          <ShieldCheck size={14} aria-hidden="true" /> {t("html.blocked")}
          {sanitized.trackers.length > 0 && <TrackerNote trackers={sanitized.trackers} />}
          <span className="note-actions">
            <button type="button" className="link-button" onClick={() => setLoadedByClick(true)}>
              <ImageDown size={14} aria-hidden="true" /> {t("html.loadRemote")}
            </button>
            {remoteActions && (
              <button type="button" className="link-button" data-testid="remote-always" onClick={() => store.openOptions(senderDomain(sender))}>
                {t("html.always")}
              </button>
            )}
          </span>
        </p>
      )}
      {sanitized.blockedRemote === 0 && sanitized.trackers.length > 0 && (
        <p className="blocked-note" data-testid="trackers-kept">
          <ShieldCheck size={14} aria-hidden="true" /> <TrackerNote trackers={sanitized.trackers} kept />
        </p>
      )}
      {exception !== null && sanitized.remoteCount > 0 && (
        <p className="blocked-note">
          <ImageDown size={14} aria-hidden="true" /> {t("html.loadedByException", { exception })}
          <span className="note-actions">
            <button type="button" className="link-button" onClick={() => store.openOptions()}>
              {t("html.manageExceptions")}
            </button>
          </span>
        </p>
      )}
      <iframe
        ref={frame}
        title="E-Mail"
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        srcDoc={emailDocument(sanitized.html)}
        style={{ height }}
      />
    </div>
  );
}

/** „3 Zählpixel: Mailchimp, Google Analytics …“ */
function TrackerNote({ trackers, kept = false }: { trackers: string[]; kept?: boolean }) {
  const { t } = useUi();
  const shown = trackers.slice(0, 3).join(", ");
  const more = trackers.length > 3 ? ` ${t("html.trackersMore", { n: trackers.length - 3 })}` : "";
  return (
    <span className="tracker-note" data-testid="tracker-note" title={trackers.join(", ")}>
      {kept ? "" : " "}{t(kept ? "html.trackersKept" : "html.trackers", { n: trackers.length, names: shown })}{more}
    </span>
  );
}
