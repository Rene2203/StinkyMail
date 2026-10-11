import { BedDouble, BusFront, CalendarPlus, Car, Mail, Plane, Ticket, TrainFront, Trash2, X, type LucideIcon } from "lucide-react";
import type { BookingKind, StoredBooking, Trip } from "@stinkyma/core";
import { useBrowserState, useUi } from "../context.js";

const kindIcon: Record<BookingKind, LucideIcon> = { flight: Plane, train: TrainFront, bus: BusFront, hotel: BedDouble, car: Car, event: Ticket };

/** Reise-Zeitleiste (W12.2): Buchungen aus Mails, zu Reisen gruppiert. Ohne KI, ohne Netz. */
export function TravelPanel() {
  const { store, t } = useUi();
  const state = useBrowserState();
  const data = state.travel;
  const view = data?.view;

  return (
    <section className="subs-panel" aria-labelledby="travel-title" data-testid="travel">
      <header className="subs-header">
        <Plane size={20} aria-hidden="true" />
        <div>
          <h2 id="travel-title">{t("travel.title")}</h2>
          <span className="muted small">{t("travel.subtitle")}</span>
        </div>
        <span className="toolbar-gap" aria-hidden="true" />
        <button type="button" className="icon-button" title={t("subs.close")} aria-label={t("subs.close")} onClick={() => store.closeTravel()}>
          <X size={16} />
        </button>
      </header>
      {data?.error && <p className="dialog-error" role="alert">{data.error}</p>}
      <div className="prom-list">
        {!view && <p className="muted">{t("subs.busy")}</p>}
        {view && view.upcoming.length === 0 && <p className="muted" data-testid="travel-empty">{t("travel.empty")}</p>}
        {view?.upcoming.map((trip) => <TripCard key={trip.id} trip={trip} />)}
        {view && view.past.length > 0 && (
          <details className="travel-past">
            <summary>{t("travel.past", { count: view.past.length })}</summary>
            {view.past.map((trip) => <TripCard key={trip.id} trip={trip} past />)}
          </details>
        )}
      </div>
    </section>
  );
}

function TripCard({ trip, past = false }: { trip: Trip; past?: boolean }) {
  const { t, locale } = useUi();
  const lang = locale === "de" ? "de-DE" : "en-GB";
  const day = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(lang, { weekday: "short", day: "numeric", month: "short" });
  const range = trip.start === trip.end ? day(trip.start) : `${day(trip.start)} – ${day(trip.end)}`;
  const today = new Date();
  const startDate = new Date(`${trip.start}T00:00:00`);
  const inDays = Math.round((startDate.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86_400_000);
  return (
    <article className={`trip-card${past ? " past" : ""}`} data-testid="trip-card">
      <header className="trip-head">
        <h3>{trip.title}</h3>
        <span className="muted small">{range}</span>
        {!past && <span className="trip-countdown small">{inDays > 0 ? t("travel.inDays", { days: inDays }) : t("travel.now")}</span>}
      </header>
      <ol className="trip-timeline">
        {trip.bookings.map((b) => (
          <BookingItem key={b.id} booking={b} />
        ))}
      </ol>
    </article>
  );
}

function BookingItem({ booking: b }: { booking: StoredBooking }) {
  const { store, t, locale } = useUi();
  const lang = locale === "de" ? "de-DE" : "en-GB";
  const Icon = kindIcon[b.kind];
  const when = (s: string) => {
    const [date = s, time] = s.split("T");
    const d = new Date(`${date}T12:00:00`).toLocaleDateString(lang, { weekday: "short", day: "numeric", month: "short" });
    return time ? `${d}, ${time}` : d;
  };
  const endTime = b.end?.includes("T") && b.end.slice(0, 10) === b.start.slice(0, 10) ? b.end.slice(11) : b.end ? when(b.end) : null;
  return (
    <li className={`trip-item kind-${b.kind}`} data-testid="booking">
      <span className="trip-icon" aria-hidden="true">
        <Icon size={15} />
      </span>
      <div className="trip-body">
        <div className="trip-line">
          <strong>{b.title}</strong>
          <span className="muted small">
            {when(b.start)}
            {endTime ? ` – ${endTime}` : ""}
          </span>
        </div>
        {(b.from || b.to) && (
          <span className="small">
            {b.from ?? "?"} → {b.to ?? "?"}
          </span>
        )}
        {b.place && <span className="small muted">{b.place}</span>}
        {b.reference && <span className="small muted">{t("travel.reference", { ref: b.reference })}</span>}
        <div className="prom-actions">
          <button type="button" className="link" data-testid="booking-calendar" onClick={() => void store.bookingToCalendar(b.id)}>
            <CalendarPlus size={13} aria-hidden="true" /> {t("travel.calendar")}
          </button>
          {b.messageId && (
            <button type="button" className="link" onClick={() => b.messageId && void store.openBookingMail(b.messageId)}>
              <Mail size={13} aria-hidden="true" /> {t("travel.mail")}
            </button>
          )}
          <button type="button" className="link muted" title={t("parcels.removeHint")} data-testid="booking-remove" onClick={() => void store.removeBooking(b.id)}>
            <Trash2 size={13} aria-hidden="true" /> {t("parcels.remove")}
          </button>
        </div>
      </div>
    </li>
  );
}
