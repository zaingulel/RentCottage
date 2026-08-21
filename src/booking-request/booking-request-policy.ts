import { bookingRequestMessages } from "@/i18n/booking-request-messages";
import type { Locale } from "@/i18n/routing";

const SIX_HOURS_MS = 6 * 60 * 60 * 1_000;
const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1_000;

export interface BookingRequestUiPolicy {
  readonly insideCutoff: boolean;
  readonly requiresInside48HourNoRefundAcceptance: boolean;
}

export interface BookingRequestAcceptanceEvidence {
  readonly locale: Locale;
  readonly cancellationPolicy: string;
  readonly cancellationAcceptance: string;
  readonly marketplaceTermsAcceptance: string;
  readonly inside48Warning: string | null;
  readonly inside48Acceptance: string | null;
}

export function bookingRequestUiPolicy({
  firstStartsAt,
  evaluatedAt,
}: {
  readonly firstStartsAt: string;
  readonly evaluatedAt: string;
}): BookingRequestUiPolicy {
  const startsAtMilliseconds = Date.parse(firstStartsAt);
  const evaluatedAtMilliseconds = Date.parse(evaluatedAt);
  if (
    !Number.isFinite(startsAtMilliseconds) ||
    !Number.isFinite(evaluatedAtMilliseconds)
  ) {
    throw new TypeError("Booking Request policy requires valid timestamps");
  }
  const leadMilliseconds = startsAtMilliseconds - evaluatedAtMilliseconds;
  return {
    insideCutoff: leadMilliseconds < SIX_HOURS_MS,
    requiresInside48HourNoRefundAcceptance:
      leadMilliseconds < FORTY_EIGHT_HOURS_MS,
  };
}

export function bookingRequestAcceptanceEvidence({
  locale,
  termsVersion,
  requiresInside48HourNoRefundAcceptance,
}: {
  readonly locale: Locale;
  readonly termsVersion: string;
  readonly requiresInside48HourNoRefundAcceptance: boolean;
}): BookingRequestAcceptanceEvidence {
  const copy = bookingRequestMessages[locale];
  return {
    locale,
    cancellationPolicy: copy.cancellationPolicy,
    cancellationAcceptance: copy.acceptCancellation,
    marketplaceTermsAcceptance: `${copy.acceptTerms} (${termsVersion})`,
    inside48Warning: requiresInside48HourNoRefundAcceptance
      ? copy.inside48Warning
      : null,
    inside48Acceptance: requiresInside48HourNoRefundAcceptance
      ? copy.acceptInside48
      : null,
  };
}
