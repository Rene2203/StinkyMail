import DOMPurify from "dompurify";
import { trackingImage } from "@stinkyma/core";

export interface SanitizedHtml {
  html: string;
  /** Anzahl externer Inhalte (Bilder, Hintergründe) in der Mail – meist auch Tracking-Pixel. */
  remoteCount: number;
  /** Davon blockiert: alle, solange der Nutzer sie nicht ausdrücklich lädt. */
  blockedRemote: number;
  /** Erkannte Zählpixel (Dienst bzw. Host) – bleiben auch nach „Externe Inhalte laden“ blockiert (W11.2) */
  trackers: string[];
}

export interface SanitizeOptions {
  /** Externe Bilder laden – nur auf ausdrücklichen Wunsch des Nutzers (Spezifikation 7.2). */
  allowRemote?: boolean;
}

const remote = /^\s*(https?:)?\/\//i;
const remoteCssUrl = /url\(\s*['"]?\s*(https?:)?\/\/[^)]*\)/gi;
const remoteCssImport = /@import\s+(url\()?\s*['"]?\s*(https?:)?\/\/[^;]*;?/gi;

/**
 * Macht HTML-Mails sicher für die Anzeige (Spezifikation 4.4 / 7.6):
 * keine Skripte, keine Formulare, keine eingebetteten Fremdseiten, externe Bilder blockiert,
 * Links öffnen außerhalb der App. Zusätzlich läuft die Anzeige in einem Sandbox-Frame ohne Skripte.
 */
export function sanitizeEmailHtml(
  html: string,
  options: SanitizeOptions = {},
  window: Window & typeof globalThis = globalThis.window,
): SanitizedHtml {
  const purify = DOMPurify(window);
  const allowRemote = options.allowRemote ?? false;
  let remoteCount = 0;
  const trackers = new Set<string>();

  /** Entfernt externe Adressen aus CSS (Stil-Attribut oder <style>-Block) und zählt sie. */
  const stripCss = (css: string): string => {
    const withoutImports = css.replace(remoteCssImport, "");
    const hits = (css.match(remoteCssImport)?.length ?? 0) + (withoutImports.match(remoteCssUrl)?.length ?? 0);
    remoteCount += hits;
    return hits === 0 || allowRemote ? css : withoutImports.replace(remoteCssUrl, "none");
  };

  purify.addHook("uponSanitizeElement", (node, data) => {
    if (data.tagName === "style" && node.textContent) node.textContent = stripCss(node.textContent);
  });

  purify.addHook("afterSanitizeAttributes", (node) => {
    const element = node as Element;
    if (element.tagName === "IMG") {
      const pixel = trackingImage(element.outerHTML);
      if (pixel) {
        trackers.add(pixel.service);
        remoteCount += 1;
        element.removeAttribute("src");
        element.removeAttribute("srcset");
      }
    }
    for (const attribute of ["src", "srcset", "background", "poster"]) {
      const value = element.getAttribute?.(attribute);
      if (value && remote.test(value)) {
        remoteCount += 1;
        if (!allowRemote) element.removeAttribute(attribute);
      }
    }
    const style = element.getAttribute?.("style");
    if (style) {
      const cleaned = stripCss(style);
      if (cleaned !== style) element.setAttribute("style", cleaned);
    }
    if (element.tagName === "A") {
      const href = element.getAttribute("href") ?? "";
      if (/^(https?:|mailto:)/i.test(href)) {
        element.setAttribute("target", "_blank");
        element.setAttribute("rel", "noopener noreferrer");
        // Beim Überfahren das echte Ziel zeigen (Link-Prüfer, W11.1)
        element.setAttribute("title", href.length > 160 ? `${href.slice(0, 157)}…` : href);
      } else {
        element.removeAttribute("href");
      }
    }
  });

  const clean = purify.sanitize(html, {
    WHOLE_DOCUMENT: false,
    FORBID_TAGS: ["form", "input", "button", "textarea", "select", "option", "iframe", "frame", "object", "embed", "base", "meta", "link", "script", "noscript"],
    FORBID_ATTR: ["action", "formaction", "ping"],
    ALLOW_DATA_ATTR: false,
  }) as unknown as string;

  purify.removeAllHooks();
  return { html: clean, remoteCount, blockedRemote: allowRemote ? 0 : remoteCount, trackers: [...trackers] };
}

/** Vollständiges Dokument für den Sandbox-Frame. Mails erwarten meist hellen Hintergrund – daher immer hell. */
export function emailDocument(bodyHtml: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:#fff;color:#1b1b1b;}
    body{font-family:"Avenir Next","Avenir","Segoe UI",system-ui,sans-serif;font-size:14px;line-height:1.5;overflow-wrap:anywhere;padding:4px 2px;}
    img{max-width:100%;height:auto;}
    table{max-width:100%;}
    a{color:#0067c0;}
  </style></head><body>${bodyHtml}</body></html>`;
}
