import Link from "next/link";

import { administratorQueueStates } from "@/administrator-records/administrator-records";
import {
  bookingMoneyFigures,
  type BookingMoneyFigures,
  type BookingMoneyRefundRecord,
  type BookingMoneyRow,
} from "@/administrator-records/administrator-booking-money";
import type { readAdministratorBookingMoney } from "@/administrator-records/supabase-administrator-booking-money";
import { bookingPayoutMessages } from "@/i18n/administrator-payment-history-messages";
import { administratorRecordsMessages } from "@/i18n/administrator-records-messages";
import { administratorTotalsMessages } from "@/i18n/administrator-totals-messages";
import { bookingLifecycleMessages } from "@/i18n/booking-lifecycle-messages";
import { bookingManagementMessages } from "@/i18n/booking-management-messages";
import { formatFilsAsIqd, formatIraqDateTime } from "@/i18n/format";
import type { Locale } from "@/i18n/routing";

import {
  ActionButton,
  ActionFeedback,
  ActionLink,
  Disclosure,
  FormControl,
} from "./interaction-controls";
import styles from "./administrator-records.module.css";

type Copy = Record<keyof (typeof administratorTotalsMessages)["en"], string>;
type FigureKey = keyof BookingMoneyFigures;
type Filters = Record<"state" | "from" | "through", string>;
type Outcome =
  | Extract<
      Awaited<ReturnType<typeof readAdministratorBookingMoney>>,
      { status: "ready" | "too_many" }
    >
  | { status: "invalid" };

const figureGroups: readonly {
  title: keyof Copy;
  figures: readonly (readonly [FigureKey, keyof Copy])[];
}[] = [
  {
    title: "captured",
    figures: [
      ["bookingPriceFils", "bookingPrice"],
      ["bookingServiceFeeFils", "bookingServiceFees"],
      ["customerTotalFils", "customerTotal"],
      ["commissionAtCaptureFils", "commissionAtCapture"],
    ],
  },
  {
    title: "refunds",
    figures: [
      ["refundedBookingPriceFils", "refundedBookingPrice"],
      ["refundedBookingServiceFeeFils", "refundedBookingServiceFees"],
      ["pendingRefundFils", "pendingRefunds"],
    ],
  },
  {
    title: "afterRefunds",
    figures: [
      ["commissionAfterRefundsFils", "commissionAfterRefunds"],
      ["ownerShareAtCaptureFils", "ownerShareAtCapture"],
      ["ownerShareAfterRefundsFils", "ownerShareAfterRefunds"],
      ["ownerShareReductionFils", "ownerShareReduction"],
    ],
  },
  {
    title: "ownerPayouts",
    figures: [
      ["paidPayoutFils", "paidPayouts"],
      ["expectedUnpaidPayoutFils", "unpaidPayouts"],
      ["toRecoverFils", "toRecover"],
    ],
  },
];

function refundSourceLabel(
  locale: Locale,
  source: BookingMoneyRefundRecord["source"],
) {
  return source === "dispute"
    ? bookingPayoutMessages[locale].disputeRefund
    : source === "administrator"
      ? bookingManagementMessages[locale].approved
      : bookingManagementMessages[locale].automatic;
}

function FigureList({
  locale,
  copy,
  figures,
  keys,
}: {
  locale: Locale;
  copy: Copy;
  figures: BookingMoneyFigures;
  keys: readonly (readonly [FigureKey, keyof Copy])[];
}) {
  return (
    <dl className="fact-list">
      {keys.map(([figure, label]) => (
        <div key={figure}>
          <dt>{copy[label]}</dt>
          <dd>
            <bdi>{formatFilsAsIqd(figures[figure], locale)}</bdi>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function BookingRow({
  locale,
  copy,
  row,
}: {
  locale: Locale;
  copy: Copy;
  row: BookingMoneyRow;
}) {
  const derived = bookingMoneyFigures(row);
  return (
    <li>
      <Link
        className="list-row-title"
        href={`/${locale}/administrator/payments/${row.reference}`}
      >
        <bdi>{row.reference}</bdi>
      </Link>
      <p className="list-row-meta">
        <span className="status-badge">
          {bookingLifecycleMessages[locale][row.state]}
        </span>
        <time dateTime={row.confirmedAt}>
          {formatIraqDateTime(row.confirmedAt, locale)}
        </time>
        <span>
          {copy.customerTotal}:{" "}
          {derived.status === "available" ? (
            <bdi>
              {formatFilsAsIqd(derived.figures.customerTotalFils, locale)}
            </bdi>
          ) : (
            copy.evidenceUnavailable
          )}
        </span>
      </p>
      <Disclosure summary={copy.bookingMoney}>
        {derived.status === "available" ? (
          <FigureList
            locale={locale}
            copy={copy}
            figures={derived.figures}
            keys={figureGroups.flatMap((group) => group.figures)}
          />
        ) : (
          <p>{copy.evidenceUnavailable}</p>
        )}
        {row.refundRecords.map((record) => (
          <dl className="fact-list" key={record.id}>
            <div>
              <dt>{copy.refundRecord}</dt>
              <dd>
                <span>
                  <bdi>{record.id}</bdi>
                </span>
                <span>{refundSourceLabel(locale, record.source)}</span>
                <span>{bookingManagementMessages[locale][record.state]}</span>
              </dd>
            </div>
            <div>
              <dt>{copy.bookingPrice}</dt>
              <dd>
                <bdi>{formatFilsAsIqd(record.bookingPriceFils, locale)}</bdi>
              </dd>
            </div>
            <div>
              <dt>{copy.bookingServiceFees}</dt>
              <dd>
                <bdi>
                  {formatFilsAsIqd(record.bookingServiceFeeFils, locale)}
                </bdi>
              </dd>
            </div>
          </dl>
        ))}
        {row.settlementIntentId ? (
          <dl className="fact-list">
            <div>
              <dt>{copy.payoutRecord}</dt>
              <dd>
                <bdi>{row.settlementIntentId}</bdi>
              </dd>
            </div>
          </dl>
        ) : null}
      </Disclosure>
    </li>
  );
}

export function AdministratorBookingMoney({
  locale,
  filters,
  outcome,
}: {
  locale: Locale;
  filters: Filters;
  outcome: Outcome;
}) {
  const copy = administratorTotalsMessages[locale];
  const records = administratorRecordsMessages[locale];
  const number = new Intl.NumberFormat(locale);
  const base = `/${locale}/administrator/totals`;

  function href(cursor?: { afterAt: string; afterId: string }) {
    const search = new URLSearchParams();
    if (filters.state) search.set("state", filters.state);
    if (filters.from) search.set("from", filters.from);
    if (filters.through) search.set("through", filters.through);
    if (cursor) {
      search.set("afterAt", cursor.afterAt);
      search.set("afterId", cursor.afterId);
    }
    const query = search.toString();
    return query ? `${base}?${query}` : base;
  }

  return (
    <>
      <p>{copy.scope}</p>
      <form
        key={`${filters.state}|${filters.from}|${filters.through}`}
        action={base}
        method="get"
        className={styles.filters}
      >
        <label>
          <span>{records.status}</span>
          <FormControl kind="select" name="state" defaultValue={filters.state}>
            <option value="">{records.allStatuses}</option>
            {administratorQueueStates.bookings.map((state) => (
              <option key={state} value={state}>
                {bookingLifecycleMessages[locale][state]}
              </option>
            ))}
          </FormControl>
        </label>
        <label>
          <span>{records.from}</span>
          <FormControl
            kind="input"
            type="date"
            name="from"
            defaultValue={filters.from}
          />
        </label>
        <label>
          <span>{records.through}</span>
          <FormControl
            kind="input"
            type="date"
            name="through"
            defaultValue={filters.through}
          />
        </label>
        <div className={styles.actions}>
          <ActionButton kind="primary" width="content" type="submit">
            {copy.apply}
          </ActionButton>
          <ActionLink kind="secondary" width="content" href={base}>
            {records.reset}
          </ActionLink>
        </div>
      </form>
      {outcome.status === "invalid" ? (
        <ActionFeedback kind="error">{copy.invalid}</ActionFeedback>
      ) : outcome.status === "too_many" ? (
        <ActionFeedback kind="error">
          {copy.tooMany.replace("{limit}", number.format(outcome.limit))}
        </ActionFeedback>
      ) : (
        <BookingMoneyResults
          locale={locale}
          copy={copy}
          outcome={outcome}
          href={href}
          resetHref={base}
        />
      )}
    </>
  );
}

function BookingMoneyResults({
  locale,
  copy,
  outcome: { search, summary, page },
  href,
  resetHref,
}: {
  locale: Locale;
  copy: Copy;
  outcome: Extract<Outcome, { status: "ready" }>;
  href: (cursor?: { afterAt: string; afterId: string }) => string;
  resetHref: string;
}) {
  const records = administratorRecordsMessages[locale];
  const number = new Intl.NumberFormat(locale);
  const { totals, flagged } = summary;
  const empty = summary.bookingCount === 0 && flagged.length === 0;
  const continued = search.afterAt !== null;

  return (
    <>
      <div className={styles.results}>
        <p className={styles.total}>
          {copy.bookingCount}:{" "}
          <strong>{number.format(summary.bookingCount)}</strong>
        </p>
        {empty ? (
          <div className="empty-state">
            <p>{records.empty}</p>
            <ActionLink kind="secondary" width="content" href={resetHref}>
              {records.reset}
            </ActionLink>
          </div>
        ) : totals.status === "available" ? (
          figureGroups.map((group) => (
            <section
              key={group.title}
              aria-labelledby={`totals-${group.title}`}
            >
              <h2 className="section-title" id={`totals-${group.title}`}>
                {copy[group.title]}
              </h2>
              <FigureList
                locale={locale}
                copy={copy}
                figures={totals.figures}
                keys={group.figures}
              />
            </section>
          ))
        ) : (
          <ActionFeedback kind="error">
            {copy.totalsUnavailable.replace(
              "{count}",
              number.format(flagged.length),
            )}
          </ActionFeedback>
        )}
        {flagged.length > 0 ? (
          <section aria-labelledby="totals-flagged">
            <h2 className="section-title" id="totals-flagged">
              {copy.flagged}
            </h2>
            <ul className="list-rows">
              {flagged.map((entry) => (
                <li key={entry.bookingRequestId}>
                  <Link
                    className="list-row-title"
                    href={`/${locale}/administrator/payments/${entry.reference}`}
                  >
                    <bdi>{entry.reference}</bdi>
                  </Link>
                  <p className="list-row-meta">
                    <span>{copy.evidenceUnavailable}</span>
                    <time dateTime={entry.confirmedAt}>
                      {formatIraqDateTime(entry.confirmedAt, locale)}
                    </time>
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {page.rows.length > 0 ? (
          <section aria-labelledby="totals-contributing">
            <h2 className="section-title" id="totals-contributing">
              {copy.contributing}
            </h2>
            <ul className="list-rows">
              {page.rows.map((row) => (
                <BookingRow
                  key={row.bookingRequestId}
                  locale={locale}
                  copy={copy}
                  row={row}
                />
              ))}
            </ul>
          </section>
        ) : null}
      </div>
      {continued || page.nextCursor ? (
        <nav className="results-paging" aria-label={copy.pagingLabel}>
          {continued ? (
            <ActionLink kind="secondary" width="content" href={href()}>
              {copy.firstResults}
            </ActionLink>
          ) : null}
          {page.nextCursor ? (
            <ActionLink
              kind="secondary"
              width="content"
              href={href(page.nextCursor)}
            >
              {records.next}
            </ActionLink>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}
