import { linksInText } from "@stinkyma/core";
import type { ReactNode } from "react";
import { composeLabels } from "../composeLabels.js";
import { useUi } from "../context.js";
import { openExternal } from "./LinkDialog.js";

/** Reiner Text mit anklickbaren Web-Adressen – jeder Klick läuft durch den Link-Prüfer (W11.1). */
export function LinkedText({ text }: { text: string }) {
  const { store, t, locale } = useUi();
  const parts: ReactNode[] = [];
  let at = 0;
  for (const link of linksInText(text)) {
    if (link.start > at) parts.push(text.slice(at, link.start));
    const shown = text.slice(link.start, link.end);
    parts.push(
      <a
        key={link.start}
        href={link.url}
        title={link.url}
        onClick={(event) => {
          event.preventDefault();
          const url = store.openLink(link.url, shown, composeLabels(t, locale));
          if (url) openExternal(url);
        }}
      >
        {shown}
      </a>,
    );
    at = link.end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}
