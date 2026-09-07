"use client";

import { useState } from "react";
import { useBookingRequestRefresh } from "@/booking-request/use-booking-request-refresh";
import { BookingRequestStatusContent } from "./booking-request-status-content";

import {
  isPaymentDisplayStatus,
  canRecoverBookingRequestPayment,
  shouldRefreshBookingRequestStatus,
  type BookingRequestDisplayStatus,
  type CustomerBookingRequestDisplay,
} from "@/booking-request/booking-request-display";
import { actOnBookingRequest } from "@/booking-request/lifecycle-actions";
import { recoverBookingRequestPayment } from "@/booking-request/payment-recovery-actions";
import {
  bookingRequestDeclineReasonMessages,
  bookingRequestPaymentRecoveryMessages,
  bookingRequestDisplayStatusMessages,
  bookingRequestPaymentRequiredExpiryMessages,
} from "@/i18n/booking-request-status-messages";
import { formatIqd, formatIraqDateTime } from "@/i18n/format";
import type { Locale } from "@/i18n/routing";

import { ActionButton, ActionFeedback } from "./interaction-controls";

const messages = {
  en: {
    title: "Booking Request status",
    cottage: "Cottage",
    period: "Booking Period",
    party: "Party size",
    price: "Booking Price",
    fee: "Service fee",
    total: "Customer Total",
    deadline: "Owner response deadline",
    reason: "Decline reason",
    note: "Cottage Owner note",
    withdraw: "Withdraw pending request",
    processing:
      "Reserved money and held inventory are being released. Do not submit another request yet.",
    failed: "The request could not be updated safely. Try again.",
    notification: "Status notification",
    paymentDeadline: "Payment deadline",
  },
  ar: {
    title: "حالة طلب الحجز",
    cottage: "البيت",
    period: "فترة الحجز",
    party: "عدد أفراد المجموعة",
    price: "سعر الحجز",
    fee: "رسوم الخدمة",
    total: "إجمالي العميل",
    deadline: "موعد رد المالك",
    reason: "سبب الرفض",
    note: "ملاحظة مالك البيت",
    withdraw: "سحب الطلب قيد الانتظار",
    processing: "جارٍ تحرير المبلغ والفترة المحجوزين. لا ترسل طلباً آخر الآن.",
    failed: "تعذر تحديث الطلب بأمان. حاول مرة أخرى.",
    notification: "إشعار الحالة",
    paymentDeadline: "موعد الدفع",
  },
  ckb: {
    title: "دۆخی داواکاری حجز",
    cottage: "کۆتێج",
    period: "ماوەی حجز",
    party: "ژمارەی کەسان",
    price: "نرخی حجز",
    fee: "کرێی خزمەتگوزاری",
    total: "کۆی گشتی کڕیار",
    deadline: "کاتی کۆتایی وەڵامی خاوەن",
    reason: "هۆکاری ڕەتکردنەوە",
    note: "تێبینی خاوەنی کۆتێج",
    withdraw: "کشاندنەوەی داواکاری چاوەڕێ",
    processing:
      "پارە و ماوەی گیراو ئازاد دەکرێن. هێشتا داواکارییەکی تر مەبنێرە.",
    failed: "داواکارییەکە بە سەلامەتی نوێ نەکرایەوە. دووبارە هەوڵ بدە.",
    notification: "ئاگادارکردنەوەی دۆخ",
    paymentDeadline: "کاتی کۆتایی پارەدان",
  },
} as const;

export function CustomerBookingRequestStatus(props: {
  locale: Locale;
  request: CustomerBookingRequestDisplay;
}) {
  return (
    <CustomerBookingRequestStatusView
      key={`${props.request.id}:${props.request.status}:${props.request.paymentRequiredWindow?.phase ?? "none"}:${props.request.paymentRecovery?.status ?? "none"}:${props.request.paymentRequiredExpiry?.status ?? "none"}`}
      {...props}
    />
  );
}

function CustomerBookingRequestStatusView({
  locale,
  request,
}: {
  locale: Locale;
  request: CustomerBookingRequestDisplay;
}) {
  const copy = messages[locale];
  const recoveryCopy = bookingRequestPaymentRecoveryMessages[locale];
  const [commandKey, setCommandKey] = useState(() => crypto.randomUUID());
  const [status, setStatus] = useState<BookingRequestDisplayStatus>(
    request.status,
  );
  const paymentDeadline =
    request.paymentRequiredExpiry?.deadline ??
    (status === "payment-required"
      ? request.paymentRequiredWindow?.deadline
      : undefined);
  const refresh = useBookingRequestRefresh(
    shouldRefreshBookingRequestStatus(request.status),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  async function withdraw() {
    setPending(true);
    setError(false);
    setStatus("processing");
    try {
      const result = await actOnBookingRequest({
        locale,
        bookingRequestId: request.id,
        action: "withdraw",
      });
      if (
        result.status === "invalid" ||
        result.status === "access-required" ||
        result.status === "unavailable"
      ) {
        setStatus(request.status);
        setError(true);
      } else {
        setStatus(result.status);
        refresh();
      }
    } catch {
      setStatus(request.status);
      setError(true);
    } finally {
      setPending(false);
    }
  }
  async function recoverPayment() {
    setPending(true);
    setError(false);
    try {
      const result = await recoverBookingRequestPayment({
        locale,
        bookingRequestId: request.id,
        commandKey,
      });
      if (result.status === "unavailable" || result.status === "invalid")
        setError(true);
      if (result.status === "retryable") setCommandKey(crypto.randomUUID());
      refresh();
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }
  return (
    <section
      className="customer-booking-request-status"
      aria-labelledby="customer-booking-request-title"
    >
      <h1 id="customer-booking-request-title">{copy.title}</h1>
      <p
        className={`booking-request-status-badge${isPaymentDisplayStatus(status) || request.paymentRequiredExpiry !== null ? " booking-request-payment-status" : ""}`}
        role="status"
        aria-live="polite"
      >
        <BookingRequestStatusContent
          locale={locale}
          status={status}
          role="customer"
          paymentRequiredPhase={request.paymentRequiredWindow?.phase}
          paymentRequiredExpiry={request.paymentRequiredExpiry}
        />
      </p>
      <strong>{request.bookingRequestReference}</strong>
      <dl>
        <div>
          <dt>{copy.cottage}</dt>
          <dd>{request.cottageName}</dd>
        </div>
        <div>
          <dt>{copy.period}</dt>
          <dd>
            {request.bookingPeriod.map((item) => (
              <span
                key={`${item.serviceDay}-${item.kind}-${item.position ?? "full"}`}
              >
                {formatIraqDateTime(item.startsAt, locale)} –{" "}
                {formatIraqDateTime(item.endsAt, locale)}
              </span>
            ))}
          </dd>
        </div>
        <div>
          <dt>{copy.party}</dt>
          <dd>{request.partySize}</dd>
        </div>
        <div>
          <dt>{copy.price}</dt>
          <dd>{formatIqd(request.bookingPriceIqd, locale)}</dd>
        </div>
        <div>
          <dt>{copy.fee}</dt>
          <dd>{formatIqd(request.serviceFeeIqd, locale)}</dd>
        </div>
        <div>
          <dt>{copy.total}</dt>
          <dd>{formatIqd(request.customerTotalIqd, locale)}</dd>
        </div>
        {!isPaymentDisplayStatus(status) && !request.paymentRequiredExpiry ? (
          <div>
            <dt>{copy.deadline}</dt>
            <dd>{formatIraqDateTime(request.responseDeadline, locale)}</dd>
          </div>
        ) : null}
        {paymentDeadline ? (
          <div>
            <dt>{copy.paymentDeadline}</dt>
            <dd>{formatIraqDateTime(paymentDeadline, locale)}</dd>
          </div>
        ) : null}
        {request.declineReason ? (
          <div>
            <dt>{copy.reason}</dt>
            <dd>
              {
                bookingRequestDeclineReasonMessages[locale][
                  request.declineReason
                ]
              }
            </dd>
          </div>
        ) : null}
        {request.statusNotifications.map((receipt) => (
          <div key={receipt.id}>
            <dt>{copy.notification}</dt>
            <dd>
              {receipt.status === "expired" &&
              request.paymentRequiredExpiry?.status === "expired"
                ? bookingRequestPaymentRequiredExpiryMessages[locale]
                    .expiredLabel
                : bookingRequestDisplayStatusMessages[locale][
                    receipt.status
                  ]}{" "}
              · {formatIraqDateTime(receipt.createdAt, locale)}
            </dd>
          </div>
        ))}
        {request.declineNote ? (
          <div>
            <dt>{copy.note}</dt>
            <dd>{request.declineNote}</dd>
          </div>
        ) : null}
      </dl>
      {status === "processing" ? <p>{copy.processing}</p> : null}
      {status === "payment-required" &&
      request.paymentRecovery?.status === "processing" ? (
        <p>{recoveryCopy.processing}</p>
      ) : null}
      {canRecoverBookingRequestPayment(request) ? (
        <ActionButton
          kind="primary"
          width="full"
          type="button"
          pending={pending}
          onClick={() => void recoverPayment()}
        >
          {request.paymentRecovery?.status === "retryable"
            ? recoveryCopy.retry
            : recoveryCopy.action}
        </ActionButton>
      ) : null}
      {status === "pending" ? (
        <ActionButton
          kind="secondary"
          size="regular"
          width="full"
          type="button"
          pending={pending}
          onClick={() => void withdraw()}
        >
          {copy.withdraw}
        </ActionButton>
      ) : null}
      {error ? (
        <ActionFeedback kind="error">{copy.failed}</ActionFeedback>
      ) : null}
    </section>
  );
}
