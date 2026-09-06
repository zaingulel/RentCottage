"use client";

import { useState } from "react";
import { useBookingRequestRefresh } from "@/booking-request/use-booking-request-refresh";
import { BookingRequestStatusContent } from "./booking-request-status-content";
import {
  isPaymentDisplayStatus,
  shouldRefreshBookingRequestStatus,
  type BookingRequestDisplayStatus,
  type OwnerBookingRequestNotificationDisplay,
} from "@/booking-request/booking-request-display";
import { bookingRequestDisplayStatusMessages } from "@/i18n/booking-request-status-messages";
import { formatFilsAsIqd, formatIqd, formatIraqDateTime } from "@/i18n/format";
import { ownerBookingRequestMessages } from "@/i18n/owner-booking-request-messages";
import type { Locale } from "@/i18n/routing";
import { BookingRequestDecisionControls } from "./booking-request-decision-controls";

const paymentDeadlineMessages: Record<Locale, string> = {
  en: "Payment deadline",
  ar: "موعد الدفع",
  ckb: "کاتی کۆتایی پارەدان",
};

function OwnerBookingRequestCard({
  locale,
  notification,
  refresh,
}: {
  locale: Locale;
  notification: OwnerBookingRequestNotificationDisplay;
  refresh: () => void;
}) {
  const copy = ownerBookingRequestMessages[locale];
  const [status, setStatus] = useState<BookingRequestDisplayStatus>(
    notification.status,
  );
  return (
    <article
      aria-label={notification.bookingRequestReference}
      className="owner-booking-request-card"
    >
      <header
        className={
          isPaymentDisplayStatus(status)
            ? "booking-request-payment-header"
            : undefined
        }
      >
        <strong>{notification.bookingRequestReference}</strong>
        <span
          role="status"
          aria-live="polite"
          className={
            isPaymentDisplayStatus(status)
              ? "booking-request-payment-status"
              : undefined
          }
        >
          <BookingRequestStatusContent
            locale={locale}
            status={status}
            role="owner"
            paymentRequiredPhase={notification.paymentRequiredWindow?.phase}
          />
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
        {!isPaymentDisplayStatus(status) ? (
          <div>
            <dt>{copy.responseDeadline}</dt>
            <dd>{formatIraqDateTime(notification.responseDeadline, locale)}</dd>
          </div>
        ) : null}
        {status === "payment-required" && notification.paymentRequiredWindow ? (
          <div>
            <dt>{paymentDeadlineMessages[locale]}</dt>
            <dd>
              {formatIraqDateTime(
                notification.paymentRequiredWindow.deadline,
                locale,
              )}
            </dd>
          </div>
        ) : null}
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
              {bookingRequestDisplayStatusMessages[locale][receipt.status]} ·{" "}
              {formatIraqDateTime(receipt.createdAt, locale)}
            </dd>
          </div>
        ))}
      </dl>
      {notification.status === "pending" ? (
        <BookingRequestDecisionControls
          locale={locale}
          bookingRequestId={notification.id}
          onStatusChange={(next) => {
            setStatus(next);
            if (next !== "pending" && next !== "processing") refresh();
          }}
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
  notifications: OwnerBookingRequestNotificationDisplay[] | undefined;
}) {
  const copy = ownerBookingRequestMessages[locale];
  const refresh = useBookingRequestRefresh(
    Boolean(
      notifications?.some(({ status, paymentRequiredWindow }) =>
        shouldRefreshBookingRequestStatus(status, paymentRequiredWindow),
      ),
    ),
  );
  if (!notifications) {
    return (
      <section className="owner-booking-requests" role="alert">
        <p>{copy.future}</p>
      </section>
    );
  }
  const containsPaymentDisplayState = notifications.some(({ status }) =>
    isPaymentDisplayStatus(status),
  );
  return (
    <section
      className="owner-booking-requests"
      aria-labelledby="owner-booking-requests-heading"
    >
      <div>
        <h2 id="owner-booking-requests-heading">
          {containsPaymentDisplayState ? copy.paymentTitle : copy.title}
        </h2>
        <p>{containsPaymentDisplayState ? copy.paymentIntro : copy.intro}</p>
      </div>
      {notifications.length === 0 ? <p>{copy.empty}</p> : null}
      <div className="owner-booking-request-grid">
        {notifications.map((notification) => (
          <OwnerBookingRequestCard
            locale={locale}
            notification={notification}
            key={`${notification.bookingRequestReference}:${notification.status}`}
            refresh={refresh}
          />
        ))}
      </div>
    </section>
  );
}
