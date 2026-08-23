"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { submitBookingRequest } from "@/booking-request/actions";
import type { SubmissionResult } from "@/booking-request/booking-request-submission";
import type {
  BookingRequestAcceptanceEvidence,
  BookingRequestUiPolicy,
} from "@/booking-request/booking-request-policy";
import type { PublicBookingQuote } from "@/booking-quote/booking-quote";
import type { CottageDiscoveryQuery } from "@/cottage-discovery/discovery-query";
import { bookingQuoteMessages } from "@/i18n/booking-quote-messages";
import {
  bookingRequestErrorMessage,
  bookingRequestMessages,
} from "@/i18n/booking-request-messages";
import { formatIraqDateTime } from "@/i18n/format";
import type { Locale } from "@/i18n/routing";

import {
  ActionButton,
  ActionFeedback,
  FormControl,
} from "./interaction-controls";
import { PhoneAccessForm } from "./phone-access-form";
import { useExclusiveAction } from "./use-exclusive-action";

export function BookingRequestForm({
  locale,
  quote,
  discoveryQuery,
  idempotencyKey,
  customerReady,
  customerAccessUnavailable = false,
  uiPolicy,
  acceptanceEvidence,
}: {
  locale: Locale;
  quote: PublicBookingQuote;
  discoveryQuery: CottageDiscoveryQuery;
  idempotencyKey: string;
  customerReady: boolean;
  customerAccessUnavailable?: boolean;
  uiPolicy: BookingRequestUiPolicy;
  acceptanceEvidence: BookingRequestAcceptanceEvidence;
}) {
  const copy = bookingRequestMessages[locale];
  const quoteNotice = bookingQuoteMessages[locale].notice;
  const firstStartsAt = quote.items[0]?.startsAt ?? "";
  const [verified, setVerified] = useState(customerReady);
  const [customerName, setCustomerName] = useState("");
  const [partySize, setPartySize] = useState(discoveryQuery.guests);
  const [bookingNote, setBookingNote] = useState("");
  const [acceptedHouseRules, setAcceptedHouseRules] = useState(false);
  const [acceptedCancellationPolicy, setAcceptedCancellationPolicy] =
    useState(false);
  const [acceptedMarketplaceTerms, setAcceptedMarketplaceTerms] =
    useState(false);
  const [acceptedInside48HourNoRefund, setAcceptedInside48HourNoRefund] =
    useState(false);
  const [result, setResult] = useState<SubmissionResult>();
  const { pending, run } = useExclusiveAction();

  if (result && "bookingRequestReference" in result) {
    return (
      <section
        className="booking-request-receipt"
        aria-labelledby="booking-request-pending-heading"
        aria-live="polite"
      >
        <h2 id="booking-request-pending-heading">
          {result.status === "pending" ? copy.pendingTitle : copy.existingTitle}
        </h2>
        <dl>
          <div>
            <dt>{copy.reference}</dt>
            <dd>{result.bookingRequestReference}</dd>
          </div>
          <div>
            <dt>{copy.responseDeadline}</dt>
            <dd>{formatIraqDateTime(result.responseDeadline, locale)}</dd>
          </div>
        </dl>
        <p>
          {result.status === "pending"
            ? copy.pendingExplanation
            : copy.existingExplanation}
        </p>
        <Link
          href={`/${locale}/booking-requests/${result.bookingRequestReference}`}
        >
          {copy.viewStatus}
        </Link>
      </section>
    );
  }

  if (customerAccessUnavailable) {
    return (
      <section className="booking-request-access">
        <h2>{copy.formTitle}</h2>
        <ActionFeedback kind="error">{copy.errors.unavailable}</ActionFeedback>
      </section>
    );
  }

  if (!verified) {
    return (
      <section className="booking-request-access">
        <h2>{copy.verifyTitle}</h2>
        <p>{copy.verifyIntro}</p>
        <p className="quote-notice">{quoteNotice}</p>
        <PhoneAccessForm
          locale={locale}
          role="customer"
          onVerified={() => setVerified(true)}
        />
      </section>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(undefined);
    const response = await run(() =>
      submitBookingRequest({
        idempotencyKey,
        locale,
        publicSlug: quote.slug,
        discoveryQuery: { ...discoveryQuery, guests: partySize },
        displayedQuote: {
          fingerprint: quote.quoteFingerprint,
          contentVersion: quote.contentVersion,
          termsVersion: quote.termsVersion,
          bookingPriceIqd: quote.bookingPriceIqd,
          serviceFeeIqd: quote.serviceFeeIqd,
          customerTotalIqd: quote.customerTotalIqd,
          firstStartsAt,
        },
        customerName,
        partySize,
        bookingNote,
        acceptedHouseRules,
        acceptedCancellationPolicy,
        acceptedMarketplaceTerms,
        acceptedInside48HourNoRefund,
        acceptanceEvidence,
      }),
    );
    if (response) setResult(response);
  }

  return (
    <section className="booking-request-panel">
      <h2>{copy.formTitle}</h2>
      <p>{copy.formIntro}</p>
      <p className="quote-notice">{quoteNotice}</p>
      {uiPolicy.insideCutoff ? (
        <ActionFeedback kind="error">{copy.cutoffPassed}</ActionFeedback>
      ) : (
        <form
          aria-label={copy.formTitle}
          className="booking-request-form"
          onSubmit={submit}
        >
          <label>
            <span>{copy.customerName}</span>
            <FormControl
              kind="input"
              type="text"
              autoComplete="name"
              minLength={2}
              maxLength={120}
              required
              value={customerName}
              onChange={(event) => setCustomerName(event.target.value)}
            />
          </label>
          <label>
            <span>{copy.partySize}</span>
            <FormControl
              kind="input"
              type="number"
              inputMode="numeric"
              min={1}
              max={100}
              required
              value={partySize}
              onChange={(event) => setPartySize(Number(event.target.value))}
            />
          </label>
          <label>
            <span>{copy.bookingNote}</span>
            <FormControl
              kind="textarea"
              rows={4}
              maxLength={500}
              value={bookingNote}
              onChange={(event) => setBookingNote(event.target.value)}
            />
            <small>{copy.noteHint}</small>
          </label>
          <label className="booking-request-acceptance">
            <input
              type="checkbox"
              required
              checked={acceptedHouseRules}
              onChange={(event) => setAcceptedHouseRules(event.target.checked)}
            />
            <span>{copy.acceptHouseRules}</span>
          </label>
          <div className="booking-request-policy">
            <p>{acceptanceEvidence.cancellationPolicy}</p>
            <label className="booking-request-acceptance">
              <input
                type="checkbox"
                required
                checked={acceptedCancellationPolicy}
                onChange={(event) =>
                  setAcceptedCancellationPolicy(event.target.checked)
                }
              />
              <span>{acceptanceEvidence.cancellationAcceptance}</span>
            </label>
          </div>
          <label className="booking-request-acceptance">
            <input
              type="checkbox"
              required
              checked={acceptedMarketplaceTerms}
              onChange={(event) =>
                setAcceptedMarketplaceTerms(event.target.checked)
              }
            />
            <span>{acceptanceEvidence.marketplaceTermsAcceptance}</span>
          </label>
          {uiPolicy.requiresInside48HourNoRefundAcceptance ? (
            <div className="booking-request-warning">
              <p>{acceptanceEvidence.inside48Warning}</p>
              <label className="booking-request-acceptance">
                <input
                  type="checkbox"
                  required
                  checked={acceptedInside48HourNoRefund}
                  onChange={(event) =>
                    setAcceptedInside48HourNoRefund(event.target.checked)
                  }
                />
                <span>{acceptanceEvidence.inside48Acceptance}</span>
              </label>
            </div>
          ) : null}
          {result ? (
            <ActionFeedback kind="error">
              {bookingRequestErrorMessage(locale, result.status)}
            </ActionFeedback>
          ) : null}
          <ActionButton
            kind="primary"
            width="full"
            type="submit"
            pending={pending}
          >
            {pending ? copy.pendingAction : copy.submit}
          </ActionButton>
        </form>
      )}
    </section>
  );
}
