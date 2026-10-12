import {
  continuousFullDayAccess,
  type PublicBookingQuoteResult,
} from "@/booking-quote/booking-quote";
import type { CottageDiscoveryQuery } from "@/cottage-discovery/discovery-query";
import type {
  BookingRequestAcceptanceEvidence,
  BookingRequestUiPolicy,
} from "@/booking-request/booking-request-policy";
import { bookingQuoteMessages } from "@/i18n/booking-quote-messages";
import { formatIqd, formatIraqDateTime } from "@/i18n/format";
import { directionFor, type Locale } from "@/i18n/routing";

import { BookingRequestForm } from "./booking-request-form";
import { ActionLink } from "./interaction-controls";

export function BookingQuoteView({
  locale,
  slug,
  queryString,
  result,
  discoveryQuery,
  idempotencyKey,
  customerReady,
  customerAccessUnavailable = false,
  bookingRequestUiPolicy,
  bookingRequestAcceptanceEvidence,
  enquiryOptions = [],
  selectedConversationId,
}: {
  locale: Locale;
  slug: string;
  queryString: string;
  result: PublicBookingQuoteResult;
  discoveryQuery: CottageDiscoveryQuery;
  idempotencyKey: string;
  customerReady: boolean;
  customerAccessUnavailable?: boolean;
  bookingRequestUiPolicy: BookingRequestUiPolicy | null;
  bookingRequestAcceptanceEvidence: BookingRequestAcceptanceEvidence | null;
  enquiryOptions?: readonly { conversationId: string; label: string }[];
  selectedConversationId?: string;
}) {
  const copy = bookingQuoteMessages[locale];
  const cottageHref = `/${locale}/cottages/${slug}${queryString ? `?${queryString}` : ""}`;
  const requestQueryString = `${queryString}${selectedConversationId ? `&conversation=${selectedConversationId}` : ""}`;
  if (result.status !== "quoted") {
    return (
      <main className="results-page page" dir={directionFor(locale)}>
        <header className="page-heading">
          <ActionLink kind="text" href={cottageHref}>
            {copy.back}
          </ActionLink>
        </header>
        <p role="alert">
          {result.status === "selection-unavailable"
            ? copy.selectionUnavailable
            : copy.unavailable}
        </p>
      </main>
    );
  }
  const { quote } = result;
  if (!bookingRequestUiPolicy || !bookingRequestAcceptanceEvidence) {
    throw new Error("Quoted Booking Request requires policy evidence");
  }
  const accessRanges = continuousFullDayAccess(quote.items);
  return (
    <main className="results-page page" dir={directionFor(locale)}>
      <header className="page-heading">
        <ActionLink kind="text" href={cottageHref}>
          {copy.back}
        </ActionLink>
        <h1 className="page-title">{copy.title}</h1>
        <p>
          {copy.quoteFor} {quote.cottageName}
        </p>
      </header>
      <div className="quote-layout">
        <section
          className="quote-card"
          aria-labelledby="booking-period-heading"
        >
          <h2 id="booking-period-heading">{copy.bookingPeriod}</h2>
          <ol className="quote-items">
            {quote.items.map((item) => {
              const itemLabel =
                item.kind === "full-day"
                  ? copy.fullDay
                  : copy.shifts[item.position];
              return (
                <li
                  key={`${item.serviceDay}-${item.kind}-${item.position ?? "full"}`}
                  aria-label={`${itemLabel} ${item.serviceDay}`}
                >
                  <div>
                    <strong>{itemLabel}</strong>
                    <span>
                      {formatIraqDateTime(item.startsAt, locale)} –{" "}
                      {formatIraqDateTime(item.endsAt, locale)}
                      {item.crossesMidnight ? ` (${copy.nextDay})` : ""}
                    </span>
                  </div>
                  <strong>{formatIqd(item.priceIqd, locale)}</strong>
                </li>
              );
            })}
          </ol>
          {accessRanges.length > 0 ? (
            <div className="quote-access">
              <h3>{copy.continuousAccess}</h3>
              <ul>
                {accessRanges.map((range) => (
                  <li key={range.fromServiceDay}>
                    {formatIraqDateTime(range.startsAt, locale)} –{" "}
                    {formatIraqDateTime(range.endsAt, locale)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
        <section className="quote-card">
          <h2>{copy.houseRules}</h2>
          <p className="quote-rules">{quote.houseRules}</p>
        </section>
        <section className="quote-card booking-terms-fixture">
          <h2>{copy.marketplaceTerms}</h2>
          <pre aria-label={copy.termsBody}>{quote.marketplaceTerms.body}</pre>
        </section>
        <aside className="quote-card quote-totals">
          <dl>
            <div>
              <dt>{copy.bookingPrice}</dt>
              <dd>{formatIqd(quote.bookingPriceIqd, locale)}</dd>
            </div>
            <div>
              <dt>{copy.serviceFee}</dt>
              <dd>{formatIqd(quote.serviceFeeIqd, locale)}</dd>
            </div>
            <div className="quote-total">
              <dt>{copy.customerTotal}</dt>
              <dd>{formatIqd(quote.customerTotalIqd, locale)}</dd>
            </div>
          </dl>
        </aside>
        <BookingRequestForm
          locale={locale}
          quote={quote}
          discoveryQuery={discoveryQuery}
          idempotencyKey={idempotencyKey}
          customerReady={customerReady}
          customerAccessUnavailable={customerAccessUnavailable}
          uiPolicy={bookingRequestUiPolicy}
          acceptanceEvidence={bookingRequestAcceptanceEvidence}
          enquiryOptions={enquiryOptions}
          selectedConversationId={selectedConversationId}
          returnTo={`/${locale}/request/${slug}?${requestQueryString}`}
        />
      </div>
    </main>
  );
}
