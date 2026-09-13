import type {
  OwnerBookingEarnings,
  OwnerBookingEarningsCause,
} from "@/booking-request/owner-booking-earnings";
import { formatFilsAsIqd, formatIraqDateTime } from "@/i18n/format";
import { ownerBookingEarningsMessages } from "@/i18n/owner-booking-earnings-messages";
import type { Locale } from "@/i18n/routing";
import styles from "./owner-booking-earnings.module.css";

type OwnerBookingEarningsTotals =
  | { readonly status: "unavailable" }
  | {
      readonly status: "available";
      readonly expectedUnpaidPayoutFils: number;
      readonly paidPayoutFils: number;
    };

function Amounts({
  locale,
  rows,
}: {
  readonly locale: Locale;
  readonly rows: readonly [string, number][];
}) {
  return (
    <dl className={styles.amounts}>
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{formatFilsAsIqd(value, locale)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function OwnerBookingEarningsSummary({
  locale,
  totals,
}: {
  readonly locale: Locale;
  readonly totals: OwnerBookingEarningsTotals;
}) {
  const copy = ownerBookingEarningsMessages[locale];
  return (
    <section className={styles.summary} aria-label={copy.summaryTitle}>
      <h2>{copy.summaryTitle}</h2>
      {totals.status === "unavailable" ? (
        <p role="status">{copy.totalsUnavailable}</p>
      ) : (
        <Amounts
          locale={locale}
          rows={[
            [copy.expectedTotal, totals.expectedUnpaidPayoutFils],
            [copy.paidTotal, totals.paidPayoutFils],
          ]}
        />
      )}
      <p className={styles.note}>{copy.summaryBasis}</p>
    </section>
  );
}

export function OwnerBookingEarningsDetails({
  locale,
  earnings,
}: {
  readonly locale: Locale;
  readonly earnings: OwnerBookingEarnings;
}) {
  const copy = ownerBookingEarningsMessages[locale];
  if (earnings.status === "not-captured" || earnings.status === "unavailable")
    return (
      <section className={styles.details} aria-label={copy.title}>
        <h3>{copy.title}</h3>
        <p role="status">
          {earnings.status === "not-captured"
            ? copy.notCaptured
            : copy.unavailable}
        </p>
      </section>
    );

  const pendingRefund =
    earnings.pendingBookingPriceRefundFils > 0 ||
    earnings.pendingBookingServiceFeeRefundFils > 0;
  const recovery =
    earnings.recoveryExposureFils > 0 ||
    earnings.recoveryBalanceFils > 0 ||
    earnings.paidWhileBlocked;
  const rows: [string, number][] = [
    [copy.bookingPrice, earnings.bookingPriceFils],
    [copy.serviceFee, earnings.bookingServiceFeeFils],
    [copy.originalCommission, earnings.originalMarketplaceCommissionFils],
    [copy.currentCommission, earnings.currentMarketplaceCommissionFils],
    [copy.completedPriceRefund, earnings.completedBookingPriceRefundFils],
    [copy.completedFeeRefund, earnings.completedBookingServiceFeeRefundFils],
  ];
  if (pendingRefund)
    rows.push(
      [copy.pendingPriceRefund, earnings.pendingBookingPriceRefundFils],
      [copy.pendingFeeRefund, earnings.pendingBookingServiceFeeRefundFils],
    );
  rows.push(
    [copy.currentNet, earnings.currentNetPayoutFils],
    [copy.expectedUnpaid, earnings.expectedUnpaidPayoutFils],
  );
  if (earnings.paidAt) rows.push([copy.paid, earnings.paidPayoutFils]);
  if (recovery)
    rows.push(
      [copy.recoveryExposure, earnings.recoveryExposureFils],
      [copy.recoveryBalance, earnings.recoveryBalanceFils],
    );

  return (
    <section className={styles.details} aria-label={copy.title}>
      <header>
        <h3>{copy.title}</h3>
        <strong className={styles.status} data-status={earnings.status}>
          {copy.statuses[earnings.status]}
        </strong>
      </header>
      <Amounts locale={locale} rows={rows} />
      <p className={styles.note}>{copy.feeNote}</p>
      {earnings.paidAt ? (
        <p>
          {copy.paidAt}:{" "}
          <time dateTime={earnings.paidAt}>
            {formatIraqDateTime(earnings.paidAt, locale)}
          </time>
        </p>
      ) : null}
      {recovery ? <p>{copy.noDebit}</p> : null}
      {earnings.causes.length ? (
        <div className={styles.causes}>
          <h4>{copy.causesTitle}</h4>
          <ul>
            {earnings.causes.map((cause: OwnerBookingEarningsCause) => (
              <li key={cause}>{copy.causes[cause]}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
