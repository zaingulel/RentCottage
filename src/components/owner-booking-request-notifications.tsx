"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { ActionFocusTarget, ActionLink } from "./interaction-controls";
import { useBookingRequestRefresh } from "@/booking-request/use-booking-request-refresh";
import { BookingCottageThumbnail } from "./booking-cottage-thumbnail";
import { BookingRequestStatusContent } from "./booking-request-status-content";
import {
  isPaymentDisplayStatus,
  isWaitingBookingRequest,
  shouldRefreshBookingRequestStatus,
  type BookingRequestDisplayStatus,
  type OwnerBookingRequestNotificationDisplay,
} from "@/booking-request/booking-request-display";
import {
  bookingRequestDisplayStatusMessages,
  bookingRequestPaymentRequiredExpiryMessages,
} from "@/i18n/booking-request-status-messages";
import { formatFilsAsIqd, formatIqd, formatIraqDateTime } from "@/i18n/format";
import {
  ownerBookingRequestMessages,
  ownerRequestGuests,
  ownerRequestPeriod,
  ownerRequestTimeLeft,
} from "@/i18n/owner-booking-request-messages";
import { accessMessages } from "@/i18n/access-messages";
import type { Locale } from "@/i18n/routing";
import {
  BookingRequestDecisionControls,
  BookingRequestRowDecisionControls,
} from "./booking-request-decision-controls";

const paymentDeadlineMessages: Record<Locale, string> = {
  en: "Payment deadline",
  ar: "موعد الدفع",
  ckb: "کاتی کۆتایی پارەدان",
};

export function OwnerBookingRequestCard({
  locale,
  notification,
  refresh,
  focusSuccessorId,
  presentation = "section",
}: {
  locale: Locale;
  notification: OwnerBookingRequestNotificationDisplay;
  refresh?: () => void;
  focusSuccessorId?: string;
  presentation?: "page" | "section";
}) {
  const copy = ownerBookingRequestMessages[locale];
  const coverMediaUrl =
    presentation === "page" ? notification.coverMediaUrl : null;
  const [status, setStatus] = useState<BookingRequestDisplayStatus>(
    notification.status,
  );
  const paymentDeadline =
    notification.paymentRequiredExpiry?.deadline ??
    (status === "payment-required"
      ? notification.paymentRequiredWindow?.deadline
      : undefined);
  return (
    <article
      aria-label={notification.bookingRequestReference}
      className="owner-booking-request-card"
    >
      {status !== "pending" && focusSuccessorId ? (
        <ActionFocusTarget targetId={focusSuccessorId} />
      ) : null}
      <header
        className={
          [
            isPaymentDisplayStatus(status) ||
            notification.paymentRequiredExpiry !== null
              ? "booking-request-payment-header"
              : null,
            coverMediaUrl !== null
              ? "owner-booking-request-header-with-cover"
              : null,
          ]
            .filter(Boolean)
            .join(" ") || undefined
        }
      >
        {coverMediaUrl !== null ? (
          <div className="booking-cottage-identity">
            <BookingCottageThumbnail key={coverMediaUrl} src={coverMediaUrl} />
            <div className="booking-cottage-identity-text">
              <h2>{notification.cottageName}</h2>
              <p>
                <bdi>{notification.bookingRequestReference}</bdi>
              </p>
            </div>
          </div>
        ) : (
          <strong>{notification.bookingRequestReference}</strong>
        )}
        <span
          role="status"
          aria-live="polite"
          className={
            isPaymentDisplayStatus(status) ||
            notification.paymentRequiredExpiry !== null
              ? "booking-request-payment-status"
              : undefined
          }
        >
          <BookingRequestStatusContent
            locale={locale}
            status={status}
            role="owner"
            paymentRequiredPhase={notification.paymentRequiredWindow?.phase}
            paymentRequiredExpiry={notification.paymentRequiredExpiry}
          />
        </span>
      </header>
      <dl className="fact-list">
        {coverMediaUrl === null ? (
          <div>
            <dt>{copy.cottage}</dt>
            <dd>{notification.cottageName}</dd>
          </div>
        ) : null}
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
        {!isPaymentDisplayStatus(status) &&
        !notification.paymentRequiredExpiry ? (
          <div>
            <dt>{copy.responseDeadline}</dt>
            <dd>{formatIraqDateTime(notification.responseDeadline, locale)}</dd>
          </div>
        ) : null}
        {paymentDeadline ? (
          <div>
            <dt>{paymentDeadlineMessages[locale]}</dt>
            <dd>{formatIraqDateTime(paymentDeadline, locale)}</dd>
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
        {notification.statusNotifications.map((receipt) => (
          <div key={receipt.id}>
            <dt>{copy.notification}</dt>
            <dd>
              {receipt.status === "expired" &&
              notification.paymentRequiredExpiry?.status === "expired"
                ? bookingRequestPaymentRequiredExpiryMessages[locale]
                    .expiredLabel
                : bookingRequestDisplayStatusMessages[locale][
                    receipt.status
                  ]}{" "}
              · {formatIraqDateTime(receipt.createdAt, locale)}
            </dd>
          </div>
        ))}
      </dl>
      {isWaitingBookingRequest(notification) ? (
        <BookingRequestDecisionControls
          locale={locale}
          bookingRequestId={notification.id}
          focusSuccessorId={focusSuccessorId}
          onStatusChange={(next) => {
            setStatus(next);
            if (next !== "pending" && next !== "processing") refresh?.();
          }}
        />
      ) : notification.status === "paid-confirmed" ? (
        <Link
          prefetch={false}
          href={`/${locale}/owner/booking-requests/${notification.bookingRequestReference}`}
        >
          {copy.openConfirmedBooking}
        </Link>
      ) : null}
    </article>
  );
}

function OwnerBookingRequestRow({
  locale,
  notification,
  refresh,
  focusSuccessorId,
}: {
  locale: Locale;
  notification: OwnerBookingRequestNotificationDisplay;
  refresh?: () => void;
  focusSuccessorId?: string;
}) {
  const copy = ownerBookingRequestMessages[locale];
  const [status, setStatus] = useState<BookingRequestDisplayStatus>(
    notification.status,
  );
  return (
    <article
      aria-label={notification.bookingRequestReference}
      className="card request-row"
    >
      {status !== "pending" && focusSuccessorId ? (
        <ActionFocusTarget targetId={focusSuccessorId} />
      ) : null}
      <div className="request-row-photo">
        {notification.coverMediaUrl ? (
          <Image src={notification.coverMediaUrl} alt="" fill sizes="5rem" />
        ) : null}
      </div>
      <div className="request-row-facts">
        <h3 className="card-title">
          {`${notification.customerName} · ${ownerRequestGuests(locale, notification.partySize)}`}
        </h3>
        <p className="card-detail">
          {[
            notification.cottageName,
            ...ownerRequestPeriod(locale, notification.bookingPeriod),
            formatIqd(notification.bookingPriceIqd, locale),
          ].join(" · ")}
        </p>
        {status === "pending" ? (
          <span className="status-badge status-badge-attention">
            {ownerRequestTimeLeft(locale, notification.responseTimeLeft)}
          </span>
        ) : null}
        <ActionLink
          kind="text"
          href={`/${locale}/owner/booking-requests/${notification.bookingRequestReference}`}
          prefetch={false}
        >
          {copy.viewRequest}
        </ActionLink>
        <span role="status" aria-live="polite">
          {status === "pending" ? null : (
            <BookingRequestStatusContent
              locale={locale}
              status={status}
              role="owner"
              paymentRequiredPhase={notification.paymentRequiredWindow?.phase}
              paymentRequiredExpiry={notification.paymentRequiredExpiry}
            />
          )}
        </span>
      </div>
      <BookingRequestRowDecisionControls
        locale={locale}
        bookingRequestId={notification.id}
        focusSuccessorId={focusSuccessorId}
        onStatusChange={(next) => {
          setStatus(next);
          if (next !== "pending" && next !== "processing") refresh?.();
        }}
      />
    </article>
  );
}

export function OwnerBookingRequestNotifications({
  locale,
  notifications,
  focusSuccessorId = "owner-booking-requests-heading",
  waitingPresentation = "card",
  presentation = "section",
}: {
  locale: Locale;
  notifications: OwnerBookingRequestNotificationDisplay[] | undefined;
  focusSuccessorId?: string;
  waitingPresentation?: "card" | "row";
  presentation?: "page" | "section";
}) {
  const copy = ownerBookingRequestMessages[locale];
  const refresh = useBookingRequestRefresh(
    Boolean(
      notifications?.some(({ status }) =>
        shouldRefreshBookingRequestStatus(status),
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
  const containsPaymentDisplayState = notifications.some(
    ({ status, paymentRequiredExpiry }) =>
      isPaymentDisplayStatus(status) || paymentRequiredExpiry !== null,
  );
  const Heading = presentation === "page" ? "h1" : "h2";
  const HeadingWrapper = presentation === "page" ? "header" : "div";
  const rows =
    waitingPresentation === "row"
      ? notifications.filter(isWaitingBookingRequest)
      : [];
  const cards =
    waitingPresentation === "row"
      ? notifications.filter(
          (notification) => !isWaitingBookingRequest(notification),
        )
      : notifications;
  return (
    <section
      className="owner-booking-requests"
      aria-labelledby="owner-booking-requests-heading"
    >
      <HeadingWrapper
        className={presentation === "page" ? "page-heading" : undefined}
      >
        {presentation === "page" ? (
          <ActionLink kind="text" href={`/${locale}/bookings?workspace=owner`}>
            {accessMessages[locale].backToBookings}
          </ActionLink>
        ) : null}
        <Heading
          id="owner-booking-requests-heading"
          tabIndex={-1}
          className={
            presentation === "page"
              ? "page-title action-focus-target"
              : "section-title action-focus-target"
          }
        >
          {containsPaymentDisplayState ? copy.paymentTitle : copy.title}
        </Heading>
        <p>{containsPaymentDisplayState ? copy.paymentIntro : copy.intro}</p>
      </HeadingWrapper>
      {notifications.length === 0 ? <p>{copy.empty}</p> : null}
      {rows.length > 0 ? (
        <div className="request-rows">
          {rows.map((notification) => (
            <OwnerBookingRequestRow
              locale={locale}
              notification={notification}
              key={`${notification.bookingRequestReference}:${notification.status}`}
              refresh={refresh}
              focusSuccessorId={focusSuccessorId}
            />
          ))}
        </div>
      ) : null}
      <div className="owner-booking-request-grid">
        {cards.map((notification) => (
          <OwnerBookingRequestCard
            locale={locale}
            notification={notification}
            presentation={presentation}
            key={`${notification.bookingRequestReference}:${notification.status}`}
            refresh={refresh}
            focusSuccessorId={focusSuccessorId}
          />
        ))}
      </div>
    </section>
  );
}
