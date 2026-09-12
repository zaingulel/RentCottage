import Link from "next/link";
import type { BookingFinancialView } from "@/booking-request/booking-financial-view";
import { bookingFinancialPresentation } from "@/booking-request/booking-financial-presentation";
import { refundAllocationTotal } from "@/payment/payment-refund-allocation";
import type { RefundAllocation } from "@/payment/payment-contract";
import { formatFilsAsIqd, formatIraqDateTime } from "@/i18n/format";
import { bookingManagementMessages } from "@/i18n/booking-management-messages";
import type { Locale } from "@/i18n/routing";
import { BookingLifecycleDetails } from "./booking-lifecycle-details";
import { BookingManagementControl } from "./booking-management-controls";
import { NotificationRetryControl } from "./notification-retry-control";
import styles from "./booking-financial-details.module.css";
export function BookingFinancialDetails({
  locale,
  view,
}: {
  locale: Locale;
  view: BookingFinancialView;
}) {
  const c = bookingManagementMessages[locale],
    isOwner = view.actorRole !== "customer";
  const pending = view.refunds.some((r) =>
    ["requested", "processing", "unknown"].includes(r.state),
  );
  const presentation = bookingFinancialPresentation({
    captured: view.captured,
    refunded: view.refunded,
    obligation: view.cancellation?.obligation ?? {
      bookingPriceFils: 0,
      bookingServiceFeeFils: 0,
    },
    pending,
  });
  const amount = (value: number) => formatFilsAsIqd(value, locale);
  const components = (a: RefundAllocation) => (
    <dl className={styles.summary}>
      <div>
        <dt>{c.price}</dt>
        <dd>{amount(a.bookingPriceFils)}</dd>
      </div>
      <div>
        <dt>{c.fee}</dt>
        <dd>{amount(a.bookingServiceFeeFils)}</dd>
      </div>
      <div>
        <dt>{c.total}</dt>
        <dd>{amount(refundAllocationTotal(a))}</dd>
      </div>
    </dl>
  );
  const cancelCommandId = crypto.randomUUID(),
    refundCommandId = crypto.randomUUID();
  const noticeNames = {
    cancelled: c.noticeCancelled,
    refund_requested: c.noticeRequested,
    refund_returned: c.noticeReturned,
    refund_attention: c.noticeAttention,
    preparation_reminder: c.noticePreparation,
  };
  const noticeStates = {
    pending: c.noticePending,
    processing: c.noticeProcessing,
    retryable: c.noticeRetryable,
    uncertain: c.noticeUncertain,
    delivered: c.noticeDelivered,
    suppressed: c.noticeSuppressed,
  };
  return (
    <section className={styles.panel} aria-label={c.title}>
      <BookingLifecycleDetails
        locale={locale}
        reference={view.bookingRequestReference}
        bookingReference={view.bookingReference}
        actorRole={view.actorRole}
        lifecycle={view.lifecycle}
        eligibility={view.eligibility}
      />
      {view.cancellation ? (
        <header>
          <h1>{c.cancelled}</h1>
          <p>
            {view.cottageName} · <strong>{view.bookingReference}</strong>
          </p>
          <p>{formatIraqDateTime(view.cancellation.occurredAt, locale)}</p>
          {view.actorRole !== "platform_administrator" ? (
            <Link
              href={`/${locale}/bookings${view.actorRole === "cottage_owner" ? "?workspace=owner" : ""}`}
            >
              {c.history}
            </Link>
          ) : null}
        </header>
      ) : (
        <h2>{c.title}</h2>
      )}
      {view.cancellation || view.actorRole === "platform_administrator" ? (
        <>
          <dl className={styles.summary}>
            <div>
              <dt>{c.originalPrice}</dt>
              <dd>{amount(view.captured.bookingPriceFils)}</dd>
            </div>
            <div>
              <dt>{c.originalFee}</dt>
              <dd>{amount(view.captured.bookingServiceFeeFils)}</dd>
            </div>
            <div>
              <dt>{c.originalTotal}</dt>
              <dd>{amount(refundAllocationTotal(view.captured))}</dd>
            </div>
            {isOwner ? (
              <>
                <div>
                  <dt>{c.originalCommission}</dt>
                  <dd>{amount(presentation.originalCommissionFils)}</dd>
                </div>
                <div>
                  <dt>{c.originalShare}</dt>
                  <dd>{amount(presentation.originalOwnerShareFils)}</dd>
                </div>
              </>
            ) : null}
            <div>
              <dt>{c.firstShift}</dt>
              <dd>{formatIraqDateTime(view.firstStartsAt, locale)}</dd>
            </div>
          </dl>
          <details>
            <summary>{c.terms}</summary>
            <p dir="auto">{view.bookingTermsBody}</p>
          </details>
        </>
      ) : null}
      {view.cancellation ? (
        <div className={styles.policy}>
          <h2>
            {presentation.fullRefundRequired
              ? c.fullRequired
              : c.standardRefund}
          </h2>
          <strong>
            {amount(refundAllocationTotal(view.cancellation.obligation))}
          </strong>
          {presentation.fullRefundRequired && isOwner ? (
            <p>{c.noPayout}</p>
          ) : null}
        </div>
      ) : null}
      <div data-testid="verified-refund">
        <h3>{c.returned}</h3>
        {components(view.refunded)}
      </div>
      {isOwner && !presentation.fullRefundRequired ? (
        <div data-testid="owner-after-completed">
          <h3>{c.afterCompleted}</h3>
          <p>
            <strong>
              {amount(presentation.ownerShareAfterCompletedRefundsFils)}
            </strong>
          </p>
          {presentation.pending ? <p>{c.pendingWarning}</p> : null}
          <small>{c.payoutTiming}</small>
        </div>
      ) : null}
      {view.refunds.length ? (
        <ol className={styles.history} aria-label={c.approved}>
          {view.refunds.map((refund) => (
            <li key={refund.id}>
              <h3>
                {refund.source === "administrator" ? c.approved : c.automatic}
              </h3>
              <p>
                {formatIraqDateTime(refund.occurredAt, locale)} ·{" "}
                <strong>{c[refund.state]}</strong>
              </p>
              {components(refund.allocation)}
            </li>
          ))}
        </ol>
      ) : null}
      {view.notifications.length ? (
        <section>
          <h3>{c.notice}</h3>
          <ul className={styles.history}>
            {view.notifications.map((notice) => (
              <li key={notice.eventId}>
                <div className={styles.notice}>
                  <span>{noticeNames[notice.kind]}</span>
                  <span>{noticeStates[notice.state]}</span>
                </div>
                {notice.dueAt ? (
                  <p>
                    {c.noticeDue}: {formatIraqDateTime(notice.dueAt, locale)}
                  </p>
                ) : null}
                {notice.deliveredAt ? (
                  <p>
                    {c.noticeDeliveredAt}:{" "}
                    {formatIraqDateTime(notice.deliveredAt, locale)}
                  </p>
                ) : null}
                {notice.retryAllowed ? (
                  <NotificationRetryControl
                    locale={locale}
                    reference={view.bookingRequestReference}
                    receiptId={notice.receiptId}
                    eventId={notice.eventId}
                    label={c.retry}
                    failed={c.retryFailed}
                    queued={c.retryQueued}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {!view.cancellation &&
      view.lifecycle.status !== "completed" &&
      view.lifecycle.status !== "no_show" ? (
        <BookingManagementControl
          key={cancelCommandId}
          locale={locale}
          reference={view.bookingRequestReference}
          actorRole={view.actorRole}
          action="cancel"
          commandId={cancelCommandId}
        />
      ) : null}
      {view.actorRole === "platform_administrator" ? (
        <BookingManagementControl
          key={refundCommandId}
          locale={locale}
          reference={view.bookingRequestReference}
          actorRole={view.actorRole}
          action="refund"
          commandId={refundCommandId}
        />
      ) : null}
      {view.actorRole === "platform_administrator" && view.audit ? (
        <details>
          <summary>{c.audit}</summary>
          {view.audit.cancellation ? (
            <p dir="auto">
              {view.audit.cancellation.category
                ? c[
                    view.audit.cancellation.category as
                      | "safety"
                      | "fraud"
                      | "legal"
                      | "serious_operational"
                  ]
                : null}{" "}
              · {view.audit.cancellation.reason} · {c.actor}:{" "}
              <bdi>{view.audit.cancellation.actorUserId}</bdi>
            </p>
          ) : null}
          <ul>
            {view.audit.refunds.map((a) => (
              <li key={a.id} dir="auto">
                {a.reason} · {c.actor}: <bdi>{a.actorUserId}</bdi>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
