import { Archive, BarChart3, Broom, EyeOff, MailMinus, X } from "lucide-react";
import type { DietSuggestion, MailboxStats, MessageCategory, StatsPeriod } from "@stinkyma/core";
import { useState } from "react";
import { useBrowserState, useUi } from "../context.js";
import type { Translate } from "../i18n.js";
import { UnsubscribeBar } from "./UnsubscribeBar.js";

const periods: StatsPeriod[] = [30, 90, 365];

function percent(value: number): string {
  return `${Math.round(value * 100)} %`;
}

/** Postfach-Statistik & Mail-Diät (W10.1): Zahlen ohne KI, Vorschläge nur auf Klick. */
export function StatsPanel() {
  const { store, t } = useUi();
  const state = useBrowserState();
  const stats = state.stats;
  const data = stats?.data;

  return (
    <section className="subs-panel" aria-labelledby="stats-title" data-testid="stats">
      <header className="subs-header">
        <BarChart3 size={20} aria-hidden="true" />
        <div>
          <h2 id="stats-title">{t("stats.title")}</h2>
          <span className="muted small">{t("stats.subtitle")}</span>
        </div>
        <span className="toolbar-gap" aria-hidden="true" />
        <div className="segmented prom-tabs stats-period" role="group" aria-label={t("stats.period")}>
          {periods.map((p) => (
            <button key={p} type="button" aria-pressed={stats?.period === p} className={stats?.period === p ? "selected" : ""} data-testid={`stats-period-${p}`} onClick={() => void store.setStatsPeriod(p)}>
              {t(`stats.period.${p}`)}
            </button>
          ))}
        </div>
        <button type="button" className="icon-button" title={t("subs.close")} aria-label={t("subs.close")} onClick={() => store.closeStats()}>
          <X size={16} />
        </button>
      </header>
      {stats?.error && <p className="dialog-error" role="alert">{stats.error}</p>}
      <div className="stats-body" aria-busy={stats?.busy}>
        {!data && <p className="muted">{t("subs.busy")}</p>}
        {data && <Diet data={data} />}
        {data && <Overview data={data} />}
      </div>
    </section>
  );
}

function Overview({ data }: { data: MailboxStats }) {
  const { t, locale } = useUi();
  const max = Math.max(1, ...data.weeks.map((w) => Math.max(w.received, w.sent)));
  const dateFormat = new Intl.DateTimeFormat(locale === "de" ? "de-DE" : "en-GB", { day: "numeric", month: "short" });
  const weekday = (n: number) => new Intl.DateTimeFormat(locale === "de" ? "de-DE" : "en-GB", { weekday: "long" }).format(new Date(2026, 0, 4 + n));
  const categoryTotal = data.categories.reduce((n, c) => n + c.count, 0) || 1;

  return (
    <>
      <div className="stats-tiles">
        <Tile label={t("stats.received")} value={String(data.received)} testId="stats-received" />
        <Tile label={t("stats.sent")} value={String(data.sent)} testId="stats-sent" />
        <Tile label={t("stats.unread")} value={percent(data.unreadShare)} />
        <Tile
          label={t("stats.myReply")}
          value={data.myReply ? hoursText(data.myReply.medianHours, t) : "–"}
          hint={data.myReply ? t("stats.myReplyHint", { share: percent(data.myReply.sameDayShare), count: data.myReply.count }) : t("stats.myReplyNone")}
        />
      </div>
      {(data.busiestWeekday !== null || data.busiestHour !== null) && (
        <p className="muted small">
          {t("stats.busiest", { weekday: data.busiestWeekday !== null ? weekday(data.busiestWeekday) : "–", hour: data.busiestHour ?? 0 })}
        </p>
      )}

      <h3 className="stats-heading">{t("stats.perWeek")}</h3>
      <div className="stats-chart" role="img" aria-label={t("stats.perWeek")} data-testid="stats-chart">
        {data.weeks.map((w) => {
          const [y = 0, m = 1, d = 1] = w.week.split("-").map(Number);
          const label = dateFormat.format(new Date(y, m - 1, d));
          return (
            <div key={w.week} className="stats-bar" title={t("stats.weekTitle", { week: label, received: w.received, sent: w.sent })}>
              <div className="stats-bar-pair">
                <span className="stats-bar-received" style={{ height: `${(w.received / max) * 100}%` }} />
                <span className="stats-bar-sent" style={{ height: `${(w.sent / max) * 100}%` }} />
              </div>
              {data.weeks.length <= 14 && <span className="stats-bar-label">{label}</span>}
            </div>
          );
        })}
      </div>
      <p className="stats-legend small muted">
        <span className="stats-dot received" aria-hidden="true" /> {t("stats.received")} <span className="stats-dot sent" aria-hidden="true" /> {t("stats.sent")}
      </p>

      <div className="stats-columns">
        <div>
          <h3 className="stats-heading">{t("stats.topSenders")}</h3>
          {data.topSenders.length === 0 ? (
            <p className="muted small">{t("stats.none")}</p>
          ) : (
            <table className="stats-table" data-testid="stats-senders">
              <thead>
                <tr>
                  <th scope="col">{t("stats.sender")}</th>
                  <th scope="col">{t("stats.mails")}</th>
                  <th scope="col">{t("stats.readShare")}</th>
                  <th scope="col">{t("stats.replied")}</th>
                </tr>
              </thead>
              <tbody>
                {data.topSenders.map((s) => (
                  <tr key={s.address}>
                    <td>
                      <span className="stats-sender" title={s.address}>{s.name ?? s.address}</span>
                    </td>
                    <td>{s.received}</td>
                    <td>{percent(s.read / s.received)}</td>
                    <td>{s.replied}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div>
          <h3 className="stats-heading">{t("stats.categories")}</h3>
          <ul className="stats-categories">
            {data.categories.map((c) => (
              <li key={c.category}>
                <span>{c.category === "uncategorized" ? t("stats.uncategorized") : t(`category.${c.category as MessageCategory}`)}</span>
                <span className="stats-meter" aria-hidden="true">
                  <span style={{ width: `${(c.count / categoryTotal) * 100}%` }} />
                </span>
                <span className="muted small">{c.count}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}

function hoursText(hours: number, t: Translate): string {
  if (hours < 1) return t("stats.minutes", { n: Math.max(1, Math.round(hours * 60)) });
  if (hours < 48) return t("stats.hours", { n: Math.round(hours * 10) / 10 });
  return t("stats.days", { n: Math.round(hours / 24) });
}

function Tile({ label, value, hint, testId }: { label: string; value: string; hint?: string; testId?: string }) {
  return (
    <div className="stats-tile" data-testid={testId}>
      <span className="muted small">{label}</span>
      <strong>{value}</strong>
      {hint && <span className="muted small">{hint}</span>}
    </div>
  );
}

function Diet({ data }: { data: MailboxStats }) {
  const { store, t } = useUi();
  const state = useBrowserState();
  const note = state.stats?.note;
  return (
    <div className="stats-diet" data-testid="stats-diet">
      <h3 className="stats-heading">{t("stats.diet")}</h3>
      {note && (
        <p className="stats-note small" role="status">
          {t(note.moved ? "stats.archivedRuleMoved" : "stats.archivedRule", { address: note.address })}
        </p>
      )}
      {data.suggestions.length === 0 ? (
        <p className="muted small" data-testid="stats-diet-empty">{t("stats.dietEmpty")}</p>
      ) : (
        <ul>
          {data.suggestions.map((s) => (
            <DietCard key={s.key} suggestion={s} />
          ))}
        </ul>
      )}
      <button type="button" className="link-button small" onClick={() => void store.resetDiet()}>
        {t("stats.dietReset")}
      </button>
    </div>
  );
}

function DietCard({ suggestion: s }: { suggestion: DietSuggestion }) {
  const { store, t } = useUi();
  const state = useBrowserState();
  const [existing, setExisting] = useState(true);
  const unsubscribe = state.unsubscribes[s.messageId]?.view;
  // Angabe gelesen, aber kein Abmelde-Weg: wie bei Massenmails ohne Abmeldung automatisch archivieren anbieten
  const noWay = s.kind === "unsubscribe" && unsubscribe !== undefined && unsubscribe !== null && !unsubscribe.info && !unsubscribe.done;
  const archive = s.kind === "autoArchive" || noWay;
  const facts = [
    t("stats.dietFacts", { received: s.received, read: s.read }),
    s.trashedUnread > 0 ? t("stats.dietTrashed", { n: s.trashedUnread }) : null,
  ].filter(Boolean).join(" · ");

  return (
    <li className="stats-diet-card" data-testid="diet-card" data-kind={s.kind}>
      <div className="stats-diet-head">
        {archive ? <Archive size={16} aria-hidden="true" /> : <MailMinus size={16} aria-hidden="true" />}
        <div>
          <strong title={s.address}>{s.name ?? s.address}</strong>
          <span className="muted small">{facts}</span>
          <span className="small">{t(archive ? "stats.dietArchiveWhy" : "stats.dietUnsubscribeWhy")}</span>
        </div>
      </div>
      {!archive && <UnsubscribeBar messageId={s.messageId} showCleanup={false} />}
      <div className="stats-diet-actions">
        {archive && store.canUseRules && (
          <>
            <label className="small">
              <input type="checkbox" checked={existing} onChange={(e) => setExisting(e.target.checked)} /> {t("stats.dietExisting")}
            </label>
            <button type="button" data-testid="diet-archive" onClick={() => void store.dietAutoArchive(s, existing)}>
              <Archive size={13} aria-hidden="true" /> {t("stats.dietArchive")}
            </button>
          </>
        )}
        {store.canCleanup && (
          <button type="button" className="link-button" onClick={() => void store.statsCleanup(s.address)}>
            <Broom size={13} aria-hidden="true" /> {t("stats.dietCleanup")}
          </button>
        )}
        <button type="button" className="link-button" data-testid="diet-dismiss" onClick={() => void store.dismissDiet(s.key)}>
          <EyeOff size={13} aria-hidden="true" /> {t("stats.dietDismiss")}
        </button>
      </div>
    </li>
  );
}
