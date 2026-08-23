import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  PaymentLifecycleSnapshot,
  PaymentProviderIdentity,
  ProviderExecutionPermit,
} from "@/payment/payment-contract";
import { isAuthorizationPhasePaymentSnapshot } from "@/payment/payment-lifecycle";

import {
  CANCELLATION_POLICY_VERSION,
  BookingRequestAuthorizationClaimNotPersisted,
  BookingRequestPreAuthorizationRejected,
  type BookingRequestSubmissionRepository,
  type SubmissionFailureStatus,
  type PrepareSubmissionResult,
  type SubmissionInput,
  type SubmissionLookupResult,
} from "./booking-request-submission";
import {
  isBookingRequestStatus,
  type BookingRequestStatus,
} from "./booking-request-status";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const bookingRequestReference = /^RC-REQ-[A-F0-9]{16}$/;
const stateStatuses = new Set<SubmissionFailureStatus>([
  "invalid",
  "access-required",
  "quote-stale",
  "too-late",
  "authorization-failed",
  "payment-unavailable",
  "reconciliation-required",
  "unavailable",
]);

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length && actual.every((key) => keys.includes(key))
  );
}

function paymentSnapshotFrom(
  value: unknown,
  paymentLifecycleId: string,
  input: SubmissionInput,
): PaymentLifecycleSnapshot | null | undefined {
  if (value === null) return null;
  return isAuthorizationPhasePaymentSnapshot(value, {
    paymentLifecycleId,
    bookingPriceFils: input.displayedQuote.bookingPriceIqd * 1_000,
    bookingServiceFeeFils: input.displayedQuote.serviceFeeIqd * 1_000,
  })
    ? value
    : undefined;
}

function providerIdentityFrom(
  value: unknown,
): PaymentProviderIdentity | null | undefined {
  if (value === null) return null;
  const identity = record(value);
  if (
    !identity ||
    !hasExactKeys(identity, [
      "provider",
      "environment",
      "merchantId",
      "terminalId",
    ]) ||
    typeof identity.provider !== "string" ||
    identity.provider.length === 0 ||
    typeof identity.environment !== "string" ||
    identity.environment.length === 0 ||
    typeof identity.merchantId !== "string" ||
    identity.merchantId.length === 0 ||
    typeof identity.terminalId !== "string" ||
    identity.terminalId.length === 0
  ) {
    return undefined;
  }
  return identity as unknown as PaymentProviderIdentity;
}

function executionPermitFrom(value: unknown): ProviderExecutionPermit {
  const result = record(value);
  const permit = record(result?.executionPermit);
  if (
    !result ||
    !hasExactKeys(result, ["status", "executionPermit"]) ||
    result.status !== "ready" ||
    !permit ||
    !hasExactKeys(permit, [
      "purpose",
      "claimId",
      "generation",
      "idempotencyKey",
      "notAfter",
    ]) ||
    permit.purpose !== "booking-request-authorization" ||
    typeof permit.claimId !== "string" ||
    !uuid.test(permit.claimId) ||
    !Number.isSafeInteger(permit.generation) ||
    (permit.generation as number) < 1 ||
    typeof permit.idempotencyKey !== "string" ||
    permit.idempotencyKey.length < 16 ||
    typeof permit.notAfter !== "string" ||
    Number.isNaN(Date.parse(permit.notAfter))
  ) {
    throw new Error("Database returned an invalid provider execution permit");
  }
  return permit as unknown as ProviderExecutionPermit;
}

function cleanupExecutionPermitFrom(value: unknown): ProviderExecutionPermit {
  const result = record(value);
  const permit = record(result?.executionPermit);
  if (
    !result ||
    !hasExactKeys(result, ["status", "executionPermit"]) ||
    result.status !== "ready" ||
    !permit ||
    !hasExactKeys(permit, [
      "purpose",
      "attemptId",
      "claimId",
      "generation",
      "stateRevision",
      "idempotencyKey",
      "requestFingerprint",
      "notAfter",
    ]) ||
    permit.purpose !== "booking-request-submission-cleanup" ||
    typeof permit.attemptId !== "string" ||
    !uuid.test(permit.attemptId) ||
    typeof permit.claimId !== "string" ||
    !uuid.test(permit.claimId) ||
    !Number.isSafeInteger(permit.generation) ||
    (permit.generation as number) < 1 ||
    !Number.isSafeInteger(permit.stateRevision) ||
    (permit.stateRevision as number) < 1 ||
    typeof permit.idempotencyKey !== "string" ||
    permit.idempotencyKey.length < 16 ||
    typeof permit.requestFingerprint !== "string" ||
    !/^[0-9a-f]{64}$/.test(permit.requestFingerprint) ||
    typeof permit.notAfter !== "string" ||
    Number.isNaN(Date.parse(permit.notAfter))
  ) {
    throw new Error("Database returned an invalid cleanup execution permit");
  }
  return permit as unknown as ProviderExecutionPermit;
}

function existingRequestResultFrom(value: Record<string, unknown>) {
  if (
    !hasExactKeys(value, [
      "status",
      "bookingRequestReference",
      "responseDeadline",
    ]) ||
    !isBookingRequestStatus(value.status) ||
    typeof value.bookingRequestReference !== "string" ||
    !bookingRequestReference.test(value.bookingRequestReference) ||
    typeof value.responseDeadline !== "string" ||
    Number.isNaN(Date.parse(value.responseDeadline))
  ) {
    return undefined;
  }
  return {
    status: value.status as BookingRequestStatus,
    bookingRequestReference: value.bookingRequestReference,
    responseDeadline: value.responseDeadline,
  };
}

function preparationFrom(
  value: unknown,
  input: SubmissionInput,
): PrepareSubmissionResult {
  const result = record(value);
  if (!result || typeof result.status !== "string") {
    throw new Error(
      "Database returned an invalid Booking Request submission result",
    );
  }
  if (result.status === "ready") {
    if (
      !hasExactKeys(result, [
        "status",
        "attemptId",
        "paymentLifecycleId",
        "paymentSnapshot",
        "providerIdentity",
      ]) ||
      typeof result.attemptId !== "string" ||
      !uuid.test(result.attemptId) ||
      typeof result.paymentLifecycleId !== "string" ||
      !uuid.test(result.paymentLifecycleId)
    ) {
      throw new Error(
        "Database returned an invalid Booking Request submission result",
      );
    }
    const paymentSnapshot = paymentSnapshotFrom(
      result.paymentSnapshot,
      result.paymentLifecycleId,
      input,
    );
    const paymentProviderIdentity = providerIdentityFrom(
      result.providerIdentity,
    );
    if (
      paymentSnapshot === undefined ||
      paymentProviderIdentity === undefined ||
      (paymentSnapshot !== null && paymentProviderIdentity === null)
    ) {
      throw new Error(
        "Database returned an invalid Booking Request submission result",
      );
    }
    return {
      status: "ready",
      attempt: {
        id: result.attemptId,
        paymentLifecycleId: result.paymentLifecycleId,
        paymentSnapshot,
        paymentProviderIdentity,
      },
    };
  }
  const existingRequest = existingRequestResultFrom(result);
  if (existingRequest) return existingRequest;
  if (
    hasExactKeys(result, ["status"]) &&
    stateStatuses.has(result.status as SubmissionFailureStatus)
  ) {
    return {
      status: result.status as SubmissionFailureStatus,
    };
  }
  throw new Error(
    "Database returned an invalid Booking Request submission result",
  );
}

function submissionPayload(input: SubmissionInput) {
  return {
    locale: input.locale,
    publicSlug: input.publicSlug,
    discoveryQuery: input.discoveryQuery,
    quoteFingerprint: input.displayedQuote.fingerprint,
    contentVersion: input.displayedQuote.contentVersion,
    termsVersion: input.displayedQuote.termsVersion,
    bookingPriceIqd: input.displayedQuote.bookingPriceIqd,
    serviceFeeIqd: input.displayedQuote.serviceFeeIqd,
    customerTotalIqd: input.displayedQuote.customerTotalIqd,
    firstStartsAt: input.displayedQuote.firstStartsAt,
    intent: {
      customerName: input.customerName,
      partySize: input.partySize,
      ...(input.bookingNote ? { bookingNote: input.bookingNote } : {}),
      acceptedHouseRules: input.acceptedHouseRules,
      acceptedCancellationPolicy: input.acceptedCancellationPolicy,
      acceptedMarketplaceTerms: input.acceptedMarketplaceTerms,
      acceptedInside48HourNoRefund: input.acceptedInside48HourNoRefund,
      cancellationPolicyVersion: CANCELLATION_POLICY_VERSION,
      acceptanceEvidence: input.acceptanceEvidence,
    },
  };
}

export class SupabaseBookingRequestSubmissionRepository implements BookingRequestSubmissionRepository {
  constructor(private readonly client: SupabaseClient) {}

  async prepare(input: SubmissionInput): Promise<PrepareSubmissionResult> {
    const { data, error } = await this.client.rpc(
      "prepare_booking_request_submission",
      {
        target_customer_user_id: input.customerUserId,
        target_idempotency_key: input.idempotencyKey,
        target_submission: submissionPayload(input),
      },
    );
    if (error) throw new Error("Booking Request submission is unavailable");
    return preparationFrom(data, input);
  }

  async savePaymentSnapshot(
    attemptId: string,
    snapshot: PaymentLifecycleSnapshot,
    providerIdentity: PaymentProviderIdentity,
  ): Promise<ProviderExecutionPermit | void> {
    const authorization = snapshot.authorization;
    const startsAuthorization =
      authorization?.status === "pending" &&
      authorization.providerRequestId === null &&
      authorization.providerReference === null &&
      authorization.movementReference === null &&
      snapshot.release === null;
    const startsCleanupRelease =
      authorization?.status === "succeeded" &&
      snapshot.capture === null &&
      snapshot.release?.status === "pending" &&
      snapshot.release.providerRequestId === null &&
      snapshot.release.providerReference === null &&
      snapshot.release.movementReference === null &&
      snapshot.release.reconciliationRequired === false &&
      snapshot.release.retrySafe === false;
    const { data, error } = await this.client.rpc(
      startsAuthorization
        ? "begin_booking_request_authorization_claim"
        : startsCleanupRelease
          ? "begin_booking_request_submission_cleanup_release"
          : "save_booking_request_payment_snapshot",
      {
        target_attempt_id: attemptId,
        target_payment_snapshot: snapshot,
        target_provider_identity: providerIdentity,
      },
    );
    if (error) {
      if (startsAuthorization) {
        const classification = await this.client.rpc(
          "classify_booking_request_authorization_claim_persistence",
          { target_attempt_id: attemptId },
        );
        const result = record(classification.data);
        if (
          !classification.error &&
          result &&
          hasExactKeys(result, ["status"]) &&
          result.status === "absent"
        ) {
          throw new BookingRequestAuthorizationClaimNotPersisted();
        }
      }
      throw new Error("Payment evidence could not be persisted");
    }
    if (startsCleanupRelease) return cleanupExecutionPermitFrom(data);
    if (!startsAuthorization) return;
    const result = record(data);
    if (
      result &&
      hasExactKeys(result, ["status"]) &&
      ["invalid", "quote-stale", "too-late", "unavailable"].includes(
        result.status as string,
      )
    ) {
      throw new BookingRequestPreAuthorizationRejected(
        result.status as "invalid" | "quote-stale" | "too-late" | "unavailable",
      );
    }
    return executionPermitFrom(data);
  }

  async finalize(attemptId: string, snapshot: PaymentLifecycleSnapshot) {
    const { data, error } = await this.client.rpc(
      "finalize_booking_request_submission",
      {
        target_attempt_id: attemptId,
        target_payment_snapshot: snapshot,
      },
    );
    if (error) throw new Error("Booking Request finalization is unavailable");
    const result = record(data);
    const pending = result ? existingRequestResultFrom(result) : undefined;
    if (!pending || pending.status !== "pending") {
      throw new Error("Database returned an invalid Booking Request result");
    }
    return { ...pending, status: "pending" as const };
  }

  async lookup(attemptId: string): Promise<SubmissionLookupResult> {
    const { data, error } = await this.client.rpc(
      "lookup_booking_request_submission",
      { target_attempt_id: attemptId },
    );
    if (error) throw new Error("Booking Request lookup is unavailable");
    const result = record(data);
    const pending = result ? existingRequestResultFrom(result) : undefined;
    if (pending?.status === "pending") {
      return { ...pending, status: "pending" as const };
    }
    if (
      result &&
      hasExactKeys(result, ["status"]) &&
      result.status === "absent"
    ) {
      return { status: "absent" };
    }
    return { status: "unknown" };
  }

  async markReconciliationRequired(attemptId: string): Promise<void> {
    const { error } = await this.client.rpc(
      "mark_booking_request_reconciliation_required",
      { target_attempt_id: attemptId },
    );
    if (error)
      throw new Error("Payment reconciliation state could not be saved");
  }
}
