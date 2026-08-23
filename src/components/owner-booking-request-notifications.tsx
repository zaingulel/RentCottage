"use client";

import { useState } from "react";
import type { OwnerBookingRequestNotification } from "@/booking-request/owner-booking-request-notifications";
import { bookingRequestStatusMessages } from "@/i18n/booking-request-status-messages";
import { formatFilsAsIqd, formatIqd, formatIraqDateTime } from "@/i18n/format";
import { ownerBookingRequestMessages } from "@/i18n/owner-booking-request-messages";
import type { Locale } from "@/i18n/routing";
import { BookingRequestDecisionControls } from "./booking-request-decision-controls";

function OwnerBookingRequestCard({
  locale,
  notification,
}: {
  locale: Locale;
  notification: OwnerBookingRequestNotification;
}) {
  const copy = ownerBookingRequestMessages[locale];
  const [status, setStatus] = useState(notification.status);
  return (
    <article
      aria-label={notification.bookingRequestReference}
      className="owner-booking-request-card"
    >
      <header>
        <strong>{notification.bookingRequestReference}</strong>
        <span role="status" aria-live="polite">
          {bookingRequestStatusMessages[locale][status]}
        </span>
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
                <strong>{item.displayName}</strong> (
                {item.kind === "shift" ? copy.shift : copy.fullDay}) ·{" "}
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
          <dd>{formatIraqDateTime(notification.responseDeadline, locale)}</dd>
        </div>
        <div>
          <dt>{copy.bookingPrice}</dt>
          <dd>{formatIqd(notification.bookingPriceIqd, locale)}</dd>
        </div>
        <div>
          <dt>{copy.commission}</dt>
          <dd>
            {formatFilsAsIqd(notification.marketplaceCommissionFils, locale)}{" "}
            (10%)
          </dd>
        </div>
        <div>
          <dt>{copy.ownerNet}</dt>
          <dd>{formatFilsAsIqd(notification.ownerNetFils, locale)}</dd>
        </div>
        <div>
          <dt>{copy.houseRules}</dt>
          <dd>{notification.houseRules}</dd>
        </div>
        <div>
          <dt>{copy.bookingTerms}</dt>
          <dd>{notification.bookingTermsVersion}</dd>
        </div>
        <div>
          <dt>{copy.cancellationPolicy}</dt>
          <dd>{notification.cancellationPolicyVersion}</dd>
        </div>
        {notification.statusNotifications.map((receipt) => (
          <div key={receipt.id}>
            <dt>{copy.notification}</dt>
            <dd>
              {bookingRequestStatusMessages[locale][receipt.status]} ·{" "}
              {formatIraqDateTime(receipt.createdAt, locale)}
            </dd>
          </div>
        ))}
      </dl>
      {notification.status === "pending" ? (
        <BookingRequestDecisionControls
          locale={locale}
          bookingRequestId={notification.id}
          onStatusChange={setStatus}
        />
      ) : null}
    </article>
  );
}

export function OwnerBookingRequestNotifications({
  locale,
  notifications,
}: {
  locale: Locale;
  notifications: OwnerBookingRequestNotification[] | undefined;
}) {
  const copy = ownerBookingRequestMessages[locale];
  if (!notifications) {
    return (
      <section className="owner-booking-requests" role="alert">
        <p>{copy.future}</p>
      </section>
    );
  }
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
          <OwnerBookingRequestCard
            locale={locale}
            notification={notification}
            key={notification.bookingRequestReference}
          />
        ))}
      </div>
    </section>
  );
}
