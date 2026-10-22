"use client";

import {
  BookingPeriodIdentity,
  BookingPeriodEndpoints,
  BookingPeriodAccessSummary,
} from "./booking-period-details";
import { bookingPeriodMessages } from "@/i18n/booking-period-messages";
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
import { customerBookingRequestProgress } from "@/booking-request/booking-request-progress";
import { actOnBookingRequest } from "@/booking-request/lifecycle-actions";
import { recoverBookingRequestPayment } from "@/booking-request/payment-recovery-actions";
import {
  bookingRequestDeclineReasonMessages,
  bookingRequestPaymentRecoveryMessages,
  bookingRequestDisplayStatusMessages,
  bookingRequestPaymentRequiredExpiryMessages,
} from "@/i18n/booking-request-status-messages";
import { formatIqd, formatIraqDateTime } from "@/i18n/format";
import { accessMessages } from "@/i18n/access-messages";
import type { Locale } from "@/i18n/routing";

import { BookingCottageThumbnail } from "./booking-cottage-thumbnail";
import { BookingRequestProgress } from "./booking-request-progress";
import {
  ActionLink,
  ActionButton,
  ActionFeedback,
  ActionFocusTarget,
} from "./interaction-controls";

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
      "This request is not settled. Money and inventory remain reserved until release is confirmed. Do not submit another request yet.",
    failed: "The request could not be updated safely. Try again.",
    notification: "Status notification",
    paymentDeadline: "Payment deadline",
    statusSentence: {
      pending:
        "Waiting for the Cottage Owner to accept or decline this request. The booking is not confirmed yet.",
      accepted:
        "The Cottage Owner accepted the request. The booking is not confirmed yet.",
      declined: "This request was declined. The booking is not confirmed.",
      withdrawn: "You withdrew this request. The booking is not confirmed.",
      expired: "The response deadline passed. The booking is not confirmed.",
    },
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
    processing:
      "لم يُحسم هذا الطلب. يبقى المبلغ والفترة محجوزين حتى تأكيد التحرير. لا ترسل طلباً آخر الآن.",
    failed: "تعذر تحديث الطلب بأمان. حاول مرة أخرى.",
    notification: "إشعار الحالة",
    paymentDeadline: "موعد الدفع",
    statusSentence: {
      pending:
        "بانتظار قبول مالك البيت لهذا الطلب أو رفضه. الحجز غير مؤكد بعد.",
      accepted: "وافق مالك البيت على الطلب. الحجز غير مؤكد بعد.",
      declined: "رُفض هذا الطلب. الحجز غير مؤكد.",
      withdrawn: "سحبت هذا الطلب. الحجز غير مؤكد.",
      expired: "انتهى موعد الرد. الحجز غير مؤكد.",
    },
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
      "ئەم داواکارییە هێشتا یەکلا نەکراوەتەوە. پارە و ماوەکە تا پشتڕاستکردنەوەی ئازادکردن بە گیراوی دەمێننەوە. هێشتا داواکارییەکی تر مەبنێرە.",
    failed: "داواکارییەکە بە سەلامەتی نوێ نەکرایەوە. دووبارە هەوڵ بدە.",
    notification: "ئاگادارکردنەوەی دۆخ",
    paymentDeadline: "کاتی کۆتایی پارەدان",
    statusSentence: {
      pending:
        "چاوەڕێی خاوەنی کۆتێجین کە ئەم داواکارییە قبوڵ بکات یان ڕەتی بکاتەوە. حجزەکە هێشتا پشتڕاست نەکراوەتەوە.",
      accepted:
        "خاوەنی کۆتێج داواکارییەکەی قبوڵ کرد. حجزەکە هێشتا پشتڕاست نەکراوەتەوە.",
      declined: "ئەم داواکارییە ڕەت کرایەوە. حجزەکە پشتڕاست نەکراوەتەوە.",
      withdrawn: "ئەم داواکارییەت کشاندەوە. حجزەکە پشتڕاست نەکراوەتەوە.",
      expired: "کاتی کۆتایی وەڵام بەسەرچووە. حجزەکە پشتڕاست نەکراوەتەوە.",
    },
  },
} as const;

export function CustomerBookingRequestStatus(props: {
  locale: Locale;
  request: CustomerBookingRequestDisplay;
  focusSuccessorId?: string;
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
  focusSuccessorId,
}: {
  locale: Locale;
  request: CustomerBookingRequestDisplay;
  focusSuccessorId?: string;
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
      {focusSuccessorId && (status === "processing" || !pending) ? (
        <ActionFocusTarget targetId={focusSuccessorId} />
      ) : null}
      <header className="page-heading">
        <ActionLink kind="text" href={`/${locale}/bookings`}>
          {accessMessages[locale].backToBookings}
        </ActionLink>
        <h1
          id="customer-booking-request-title"
          tabIndex={-1}
          className="page-title action-focus-target"
        >
          {copy.title}
        </h1>
        <ActionFocusTarget
          targetId="customer-booking-request-title"
          navigation
        />
      </header>
      <div className="card customer-booking-request-progress">
        <p className="status-banner" role="status" aria-live="polite">
          <BookingRequestStatusContent
            locale={locale}
            status={status}
            role="customer"
            paymentRequiredPhase={request.paymentRequiredWindow?.phase}
            paymentRequiredExpiry={request.paymentRequiredExpiry}
          />
          {status === "processing" ? (
            <span>{copy.processing}</span>
          ) : status === request.status &&
            !isPaymentDisplayStatus(status) &&
            request.paymentRequiredExpiry === null ? (
            <span>{copy.statusSentence[status]}</span>
          ) : null}
        </p>
        <BookingRequestProgress
          locale={locale}
          progress={customerBookingRequestProgress({ ...request, status })}
        />
      </div>
      <div className="card customer-booking-request-details">
        {request.coverMediaUrl !== null ? (
          <div className="booking-cottage-identity">
            <BookingCottageThumbnail
              key={request.coverMediaUrl}
              src={request.coverMediaUrl}
            />
            <div className="booking-cottage-identity-text">
              <h2>{request.cottageName}</h2>
              <p>
                <bdi>{request.bookingRequestReference}</bdi>
              </p>
            </div>
          </div>
        ) : (
          <strong>{request.bookingRequestReference}</strong>
        )}
        <dl className="fact-list">
          {request.coverMediaUrl === null ? (
            <div>
              <dt>{copy.cottage}</dt>
              <dd>{request.cottageName}</dd>
            </div>
          ) : null}
          <div>
            <dt>{copy.period}</dt>
            <dd>
              {request.bookingPeriod.map((item) => (
                <span
                  className="booking-period-record"
                  key={`${item.serviceDay}-${item.kind}-${item.position ?? "full"}`}
                >
                  <BookingPeriodIdentity
                    locale={locale}
                    kind={item.kind}
                    position={item.position}
                    originalName={item.displayName}
                    presentation={request.periodPresentation}
                  />
                  <bdi dir="auto">{formatIqd(item.priceIqd, locale)}</bdi>
                  <BookingPeriodEndpoints locale={locale} {...item} />
                  {item.kind === "full-day" &&
                  request.periodPresentation === "morning-evening-v1" ? (
                    <span className="booking-period-explanation">
                      {bookingPeriodMessages[locale].fullDayIncludes}
                    </span>
                  ) : null}
                </span>
              ))}
              <BookingPeriodAccessSummary
                locale={locale}
                items={request.bookingPeriod}
              />
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
          <div className="customer-booking-request-total">
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
        {status === "payment-required" &&
        request.paymentRecovery?.status === "processing" ? (
          <p>{recoveryCopy.processing}</p>
        ) : null}
        <div className="customer-booking-request-actions">
          {canRecoverBookingRequestPayment(request) ? (
            <ActionButton
              kind="primary"
              width="full"
              type="button"
              pending={pending}
              focusSuccessorId={focusSuccessorId}
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
              type="button"
              pending={pending}
              focusSuccessorId={focusSuccessorId}
              onClick={() => void withdraw()}
            >
              {copy.withdraw}
            </ActionButton>
          ) : null}
        </div>
        {error ? (
          <ActionFeedback kind="error">{copy.failed}</ActionFeedback>
        ) : null}
      </div>
    </section>
  );
}
