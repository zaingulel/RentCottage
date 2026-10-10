import Link from "next/link";

import {
  administratorQueues,
  administratorQueueStates,
  type AdministratorQueue,
  type AdministratorQueuePage,
} from "@/administrator-records/administrator-records";
import {
  administratorPaymentHistoryCodeMessages,
  bookingPayoutMessages,
} from "@/i18n/administrator-payment-history-messages";
import { administratorQueuesMessages } from "@/i18n/administrator-queues-messages";
import { administratorRecordsMessages } from "@/i18n/administrator-records-messages";
import { bookingLifecycleMessages } from "@/i18n/booking-lifecycle-messages";
import { bookingManagementMessages } from "@/i18n/booking-management-messages";
import { formatIraqDateTime } from "@/i18n/format";
import type { Locale } from "@/i18n/routing";

import {
  ActionButton,
  ActionFeedback,
  ActionLink,
  FormControl,
} from "./interaction-controls";
import styles from "./administrator-records.module.css";

type QueueStates = typeof administratorQueueStates;
type QueueFilters = {
  queue: AdministratorQueue;
  state: string;
  from: string;
  through: string;
};
type QueueOutcome =
  | { status: "ready"; page: AdministratorQueuePage }
  | { status: "invalid" };

function stateLabel(locale: Locale, queue: AdministratorQueue, state: string) {
  switch (queue) {
    case "requests":
      return administratorPaymentHistoryCodeMessages[locale][
        state as QueueStates["requests"][number]
      ];
    case "bookings":
    case "incidents":
      return bookingLifecycleMessages[locale][
        state as QueueStates["bookings"][number]
      ];
    case "refunds":
      return bookingManagementMessages[locale][
        state as QueueStates["refunds"][number]
      ];
  }
}

function sourceLabel(
  locale: Locale,
  queue: AdministratorQueue,
  source: string,
) {
  if (queue === "refunds")
    return source === "dispute"
      ? bookingPayoutMessages[locale].disputeRefund
      : source === "administrator"
        ? bookingManagementMessages[locale].approved
        : bookingManagementMessages[locale].automatic;
  return source === "lifecycle"
    ? bookingLifecycleMessages[locale].lifecycleSource
    : bookingLifecycleMessages[locale].cancellationSource;
}

function categoryLabel(locale: Locale, source: string, category: string) {
  return source === "lifecycle"
    ? bookingLifecycleMessages[locale][
        category as "safety" | "property_damage" | "conduct" | "other"
      ]
    : bookingManagementMessages[locale][
        category as "safety" | "fraud" | "legal" | "serious_operational"
      ];
}

export function AdministratorQueues({
  locale,
  filters,
  outcome,
}: {
  locale: Locale;
  filters: QueueFilters;
  outcome: QueueOutcome;
}) {
  const copy = administratorQueuesMessages[locale];
  const records = administratorRecordsMessages[locale];
  const number = new Intl.NumberFormat(locale);
  const base = `/${locale}/administrator/queues`;
  const resetHref = `${base}?queue=${filters.queue}`;

  function nextHref(cursor: { at: string; id: string }) {
    const search = new URLSearchParams({ queue: filters.queue });
    if (filters.state) search.set("state", filters.state);
    if (filters.from) search.set("from", filters.from);
    if (filters.through) search.set("through", filters.through);
    search.set("afterAt", cursor.at);
    search.set("afterId", cursor.id);
    return `${base}?${search}`;
  }

  return (
    <>
      <form action={base} method="get">
        <div
          className={styles.queues}
          role="group"
          aria-label={copy.queuesLabel}
        >
          {administratorQueues.map((queue) => (
            <ActionButton
              key={queue}
              kind="toggle"
              size="regular"
              type="submit"
              name="queue"
              value={queue}
              pressed={queue === filters.queue}
            >
              {copy.queues[queue]}
            </ActionButton>
          ))}
        </div>
        {filters.from ? (
          <input type="hidden" name="from" value={filters.from} />
        ) : null}
        {filters.through ? (
          <input type="hidden" name="through" value={filters.through} />
        ) : null}
      </form>
      <form
        key={`${filters.queue}|${filters.state}|${filters.from}|${filters.through}`}
        action={base}
        method="get"
        className={styles.filters}
      >
        <input type="hidden" name="queue" value={filters.queue} />
        <label>
          <span>{records.status}</span>
          <FormControl kind="select" name="state" defaultValue={filters.state}>
            <option value="">{records.allStatuses}</option>
            {administratorQueueStates[filters.queue].map((state) => (
              <option key={state} value={state}>
                {stateLabel(locale, filters.queue, state)}
                {outcome.status === "ready"
                  ? ` (${number.format(outcome.page.stateCounts[state])})`
                  : ""}
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
          <ActionLink kind="secondary" width="content" href={resetHref}>
            {records.reset}
          </ActionLink>
        </div>
      </form>
      {outcome.status === "invalid" ? (
        <ActionFeedback kind="error">{copy.invalid}</ActionFeedback>
      ) : (
        <div className={styles.results}>
          <p className={styles.total}>
            {records.matchingTotal}:{" "}
            <strong>{number.format(outcome.page.total)}</strong>
          </p>
          {outcome.page.rows.length ? (
            <ul className="list-rows">
              {outcome.page.rows.map((row) => (
                <li key={row.id}>
                  <Link
                    className="list-row-title"
                    href={`/${locale}/administrator/payments/${row.reference}`}
                  >
                    <bdi>{row.reference}</bdi>
                  </Link>
                  <p className="list-row-meta">
                    <span className="status-badge">
                      {stateLabel(locale, outcome.page.queue, row.state)}
                    </span>
                    <time dateTime={row.at}>
                      {formatIraqDateTime(row.at, locale)}
                    </time>
                    {row.source ? (
                      <span>
                        {sourceLabel(locale, outcome.page.queue, row.source)}
                      </span>
                    ) : null}
                    {row.source && row.category ? (
                      <span>
                        {categoryLabel(locale, row.source, row.category)}
                      </span>
                    ) : null}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty-state">
              <p>{records.empty}</p>
              <ActionLink kind="secondary" width="content" href={resetHref}>
                {records.reset}
              </ActionLink>
            </div>
          )}
          {outcome.page.nextCursor ? (
            <ActionLink
              kind="secondary"
              width="content"
              href={nextHref(outcome.page.nextCursor)}
            >
              {records.next}
            </ActionLink>
          ) : null}
        </div>
      )}
    </>
  );
}
