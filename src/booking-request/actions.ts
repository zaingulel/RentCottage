"use server";

import { SupabaseAccountContextStore } from "@/access/supabase-account-access";
import { createRequestSupabaseClient } from "@/access/supabase-server";
import {
  BOOKING_SERVICE_FEE_IQD,
  BOOKING_TERMS_VERSION,
  isBookingQuoteFingerprint,
  isPublicCottageSlug,
} from "@/booking-quote/booking-quote";
import {
  parseCottageDiscoveryQuery,
  type CottageDiscoveryQuery,
} from "@/cottage-discovery/discovery-query";
import { isLocale } from "@/i18n/routing";
import {
  bookingRequestAcceptanceEvidence,
  type BookingRequestAcceptanceEvidence,
} from "./booking-request-policy";

import type {
  SubmissionInput,
  SubmissionResult,
} from "./booking-request-submission";
import { createRequestBookingRequestSubmission } from "./request-booking-request-submission";
import { isContactSafeBookingRequestText } from "./booking-request-content";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function discoveryQueryFrom(value: unknown): CottageDiscoveryQuery | undefined {
  const query = record(value);
  if (
    !query ||
    !Array.isArray(query.selections) ||
    !Array.isArray(query.amenities)
  ) {
    return undefined;
  }
  const selections: string[] = [];
  for (const rawSelection of query.selections) {
    const selection = record(rawSelection);
    if (
      !selection ||
      typeof selection.serviceDay !== "string" ||
      (selection.kind !== "shift" && selection.kind !== "full-day")
    ) {
      return undefined;
    }
    if (selection.kind === "shift") {
      if (![1, 2, 3].includes(selection.position as number)) return undefined;
      selections.push(
        `${selection.serviceDay}:shift:${String(selection.position)}`,
      );
    } else {
      selections.push(`${selection.serviceDay}:full-day`);
    }
  }
  if (query.amenities.some((amenity) => typeof amenity !== "string")) {
    return undefined;
  }
  const parsed = parseCottageDiscoveryQuery({
    from: typeof query.from === "string" ? query.from : undefined,
    to: typeof query.to === "string" ? query.to : undefined,
    guests:
      Number.isSafeInteger(query.guests) && (query.guests as number) > 0
        ? String(query.guests)
        : undefined,
    selection: selections,
    amenity: query.amenities as string[],
    governorate:
      typeof query.governorate === "string" ? query.governorate : undefined,
    area: typeof query.area === "string" ? query.area : undefined,
  });
  return parsed.status === "loaded" ? parsed.query : undefined;
}

function inputFrom(
  value: unknown,
): Omit<SubmissionInput, "customerUserId"> | undefined {
  const input = record(value);
  const quote = record(input?.displayedQuote);
  const query = discoveryQueryFrom(input?.discoveryQuery);
  const customerName =
    typeof input?.customerName === "string" ? input.customerName.trim() : "";
  const normalizedNote =
    typeof input?.bookingNote === "string" ? input.bookingNote.trim() : "";
  const note = normalizedNote === "" ? null : normalizedNote;
  const evidence = record(input?.acceptanceEvidence);
  if (
    !input ||
    typeof input.idempotencyKey !== "string" ||
    !uuid.test(input.idempotencyKey) ||
    typeof input.locale !== "string" ||
    !isLocale(input.locale) ||
    typeof input.publicSlug !== "string" ||
    !isPublicCottageSlug(input.publicSlug) ||
    !query ||
    !quote ||
    !isBookingQuoteFingerprint(quote.fingerprint) ||
    !Number.isSafeInteger(quote.contentVersion) ||
    (quote.contentVersion as number) < 1 ||
    quote.termsVersion !== BOOKING_TERMS_VERSION ||
    !Number.isSafeInteger(quote.bookingPriceIqd) ||
    (quote.bookingPriceIqd as number) <= 0 ||
    quote.serviceFeeIqd !== BOOKING_SERVICE_FEE_IQD ||
    !Number.isSafeInteger(quote.customerTotalIqd) ||
    quote.customerTotalIqd !==
      (quote.bookingPriceIqd as number) + BOOKING_SERVICE_FEE_IQD ||
    typeof quote.firstStartsAt !== "string" ||
    Number.isNaN(Date.parse(quote.firstStartsAt)) ||
    customerName.length < 2 ||
    customerName.length > 120 ||
    !isContactSafeBookingRequestText(customerName) ||
    (note !== null &&
      (note.length > 500 || !isContactSafeBookingRequestText(note))) ||
    !Number.isSafeInteger(input.partySize) ||
    (input.partySize as number) < 1 ||
    input.partySize !== query.guests ||
    typeof input.acceptedHouseRules !== "boolean" ||
    typeof input.acceptedCancellationPolicy !== "boolean" ||
    typeof input.acceptedMarketplaceTerms !== "boolean" ||
    typeof input.acceptedInside48HourNoRefund !== "boolean" ||
    !evidence ||
    typeof evidence.locale !== "string" ||
    !isLocale(evidence.locale) ||
    typeof evidence.cancellationPolicy !== "string" ||
    typeof evidence.cancellationAcceptance !== "string" ||
    typeof evidence.marketplaceTermsAcceptance !== "string" ||
    (evidence.inside48Warning !== null &&
      typeof evidence.inside48Warning !== "string") ||
    (evidence.inside48Acceptance !== null &&
      typeof evidence.inside48Acceptance !== "string")
  ) {
    return undefined;
  }
  const acceptanceEvidence =
    evidence as unknown as BookingRequestAcceptanceEvidence;
  const expectedEvidence = bookingRequestAcceptanceEvidence({
    locale: input.locale,
    termsVersion: BOOKING_TERMS_VERSION,
    requiresInside48HourNoRefundAcceptance:
      acceptanceEvidence.inside48Warning !== null,
  });
  if (JSON.stringify(acceptanceEvidence) !== JSON.stringify(expectedEvidence)) {
    return undefined;
  }
  return {
    idempotencyKey: input.idempotencyKey,
    locale: input.locale,
    publicSlug: input.publicSlug,
    discoveryQuery: query,
    displayedQuote: {
      fingerprint: quote.fingerprint,
      contentVersion: quote.contentVersion as number,
      termsVersion: BOOKING_TERMS_VERSION,
      bookingPriceIqd: quote.bookingPriceIqd as number,
      serviceFeeIqd: BOOKING_SERVICE_FEE_IQD,
      customerTotalIqd: quote.customerTotalIqd as number,
      firstStartsAt: quote.firstStartsAt,
    },
    customerName,
    partySize: input.partySize as number,
    bookingNote: note,
    acceptedHouseRules: input.acceptedHouseRules,
    acceptedCancellationPolicy: input.acceptedCancellationPolicy,
    acceptedMarketplaceTerms: input.acceptedMarketplaceTerms,
    acceptedInside48HourNoRefund: input.acceptedInside48HourNoRefund,
    acceptanceEvidence,
  };
}

export async function submitBookingRequest(
  value: unknown,
): Promise<SubmissionResult> {
  const input = inputFrom(value);
  if (!input) return { status: "invalid" };
  try {
    const client = await createRequestSupabaseClient();
    const context = await new SupabaseAccountContextStore(client).resolve();
    if (context?.role !== "customer") return { status: "access-required" };
    const submission = await createRequestBookingRequestSubmission();
    if (!submission) return { status: "payment-unavailable" };
    return await submission.submit({
      ...input,
      customerUserId: context.userId,
    });
  } catch {
    console.error("Booking Request action failed", {
      code: "booking_request_action_failed",
    });
    return { status: "unavailable" };
  }
}
