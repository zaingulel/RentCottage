import {
  BookingPeriodIdentity,
  BookingPeriodEndpoints,
  BookingPeriodAccessSummary,
} from "./booking-period-details";
import { bookingPeriodMessages } from "@/i18n/booking-period-messages";
import { type PublicBookingQuoteResult } from "@/booking-quote/booking-quote";
import type { CottageDiscoveryQuery } from "@/cottage-discovery/discovery-query";
import type {
  BookingRequestAcceptanceEvidence,
  BookingRequestUiPolicy,
} from "@/booking-request/booking-request-policy";
import { bookingQuoteMessages } from "@/i18n/booking-quote-messages";
import { formatIqd } from "@/i18n/format";
import { directionFor, type Locale } from "@/i18n/routing";

import { BookingRequestForm } from "./booking-request-form";
import { ActionFocusTarget, ActionLink } from "./interaction-controls";

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
        <p
          id="booking-quote-unavailable"
          role="alert"
          tabIndex={-1}
          className="action-focus-target"
        >
          {result.status === "selection-unavailable"
            ? copy.selectionUnavailable
            : copy.unavailable}
        </p>
        <ActionFocusTarget targetId="booking-quote-unavailable" navigation />
      </main>
    );
  }
  const { quote } = result;
  if (!bookingRequestUiPolicy || !bookingRequestAcceptanceEvidence) {
    throw new Error("Quoted Booking Request requires policy evidence");
  }
  const periodCopy = bookingPeriodMessages[locale];
  return (
    <main className="results-page page" dir={directionFor(locale)}>
      <header className="page-heading">
        <ActionLink kind="text" href={cottageHref}>
          {copy.back}
        </ActionLink>
        <h1
          id="booking-quote-title"
          tabIndex={-1}
          className="page-title action-focus-target"
        >
          {copy.title}
        </h1>
        <ActionFocusTarget targetId="booking-quote-title" navigation />
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
            {quote.items.map((item, index) => (
              <li
                key={`${item.serviceDay}-${item.kind}-${item.position ?? "full"}`}
                aria-labelledby={`quote-period-${index}`}
              >
                <div>
                  <span id={`quote-period-${index}`}>
                    <BookingPeriodIdentity
                      locale={locale}
                      kind={item.kind}
                      position={item.position}
                      originalName={item.displayName}
                      presentation={quote.periodPresentation}
                    />
                  </span>
                  <strong>
                    <bdi dir="auto">{formatIqd(item.priceIqd, locale)}</bdi>
                  </strong>
                  <BookingPeriodEndpoints locale={locale} {...item} />
                  {item.kind === "full-day" &&
                  quote.periodPresentation === "morning-evening-v1" ? (
                    <span className="booking-period-explanation">
                      {periodCopy.fullDayIncludes}
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
          <BookingPeriodAccessSummary locale={locale} items={quote.items} />
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
