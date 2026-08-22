import Link from "next/link";

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

import { LocaleLinks } from "./locale-links";
import { BookingRequestForm } from "./booking-request-form";

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
}) {
  const copy = bookingQuoteMessages[locale];
  const cottageHref = `/${locale}/cottages/${slug}${queryString ? `?${queryString}` : ""}`;
  if (result.status !== "quoted") {
    return (
      <main className="quote-page" dir={directionFor(locale)}>
        <header className="results-header">
          <Link href={cottageHref}>{copy.back}</Link>
          <LocaleLinks
            locale={locale}
            path={`/request/${slug}`}
            queryString={queryString}
          />
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
    <main className="quote-page" dir={directionFor(locale)}>
      <header className="results-header">
        <Link href={cottageHref}>{copy.back}</Link>
        <LocaleLinks
          locale={locale}
          path={`/request/${slug}`}
          queryString={queryString}
        />
      </header>
      <header className="quote-heading">
        <p>
          {copy.quoteFor} {quote.cottageName}
        </p>
        <h1>{copy.title}</h1>
        <small>
          {copy.contentVersion} {quote.contentVersion}
        </small>
      </header>
      <div className="quote-layout">
        <div>
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
            <dl>
              <div>
                <dt>{copy.termsVersion}</dt>
                <dd>{quote.marketplaceTerms.version}</dd>
              </div>
              <div>
                <dt>{copy.termsLocale}</dt>
                <dd>{quote.marketplaceTerms.locale}</dd>
              </div>
              <div>
                <dt>{copy.termsHash}</dt>
                <dd>{quote.marketplaceTerms.sha256}</dd>
              </div>
            </dl>
          </section>
          <BookingRequestForm
            locale={locale}
            quote={quote}
            discoveryQuery={discoveryQuery}
            idempotencyKey={idempotencyKey}
            customerReady={customerReady}
            customerAccessUnavailable={customerAccessUnavailable}
            uiPolicy={bookingRequestUiPolicy}
            acceptanceEvidence={bookingRequestAcceptanceEvidence}
          />
        </div>
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
          <p>
            <strong>{copy.termsVersion}:</strong> {quote.termsVersion}
          </p>
        </aside>
      </div>
    </main>
  );
}
