import type { OwnerBookingRequestNotification } from "@/booking-request/owner-booking-request-notifications";
import { formatIraqDateTime } from "@/i18n/format";
import { ownerBookingRequestMessages } from "@/i18n/owner-booking-request-messages";
import type { Locale } from "@/i18n/routing";

export function OwnerBookingRequestNotifications({
  locale,
  notifications,
}: {
  locale: Locale;
  notifications: OwnerBookingRequestNotification[];
}) {
  const copy = ownerBookingRequestMessages[locale];
  return (
    <section
      className="owner-booking-requests"
      aria-labelledby="owner-booking-requests-heading"
    >
      <div>
        <h2 id="owner-booking-requests-heading">{copy.title}</h2>
        <p>{copy.intro}</p>
      </div>
      {notifications.length === 0 ? <p>{copy.empty}</p> : null}
      <div className="owner-booking-request-grid">
        {notifications.map((notification) => (
          <article
            aria-label={notification.bookingRequestReference}
            className="owner-booking-request-card"
            key={notification.bookingRequestReference}
          >
            <header>
              <strong>{notification.bookingRequestReference}</strong>
              <span>{copy.pending}</span>
            </header>
            <dl>
              <div>
                <dt>{copy.cottage}</dt>
                <dd>{notification.cottageName}</dd>
              </div>
              <div>
                <dt>{copy.customer}</dt>
                <dd>{notification.customerName}</dd>
              </div>
              <div>
                <dt>{copy.partySize}</dt>
                <dd>{notification.partySize}</dd>
              </div>
              <div>
                <dt>{copy.bookingPeriod}</dt>
                <dd>
                  {notification.bookingPeriod.map((item) => (
                    <span
                      key={`${item.serviceDay}-${item.kind}-${item.position ?? "full"}`}
                    >
                      {formatIraqDateTime(item.startsAt, locale)} –{" "}
                      {formatIraqDateTime(item.endsAt, locale)}
                    </span>
                  ))}
                </dd>
              </div>
              {notification.bookingNote ? (
                <div>
                  <dt>{copy.bookingNote}</dt>
                  <dd>{notification.bookingNote}</dd>
                </div>
              ) : null}
              <div>
                <dt>{copy.responseDeadline}</dt>
                <dd>
                  {formatIraqDateTime(notification.responseDeadline, locale)}
                </dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}
