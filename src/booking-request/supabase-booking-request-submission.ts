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
  type RecoverableSubmissionAttempt,
  type SubmissionFailureStatus,
  type PrepareSubmissionResult,
  type SubmissionInput,
  type SubmissionPaymentPersistencePurpose,
  type SubmissionLookupResult,
} from "./booking-request-submission";
import type { BookingRequestSubmissionRecoveryRepository } from "./booking-request-submission-recovery";
import { isTimestamp, rowObject } from "./booking-request-row";
import {
  isBookingRequestStatus,
  type BookingRequestStatus,
} from "./booking-request-status";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const bookingRequestReference = /^RC-REQ-[A-F0-9]{16}$/;
const stateStatuses = new Set<SubmissionFailureStatus>([
  "invalid",
  "self-booking-not-allowed",
  "access-required",
  "customer-suspended",
  "quote-stale",
  "too-late",
  "authorization-failed",
  "payment-unavailable",
  "reconciliation-required",
  "unavailable",
]);

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
  const identity = rowObject(value);
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
  const result = rowObject(value);
  const permit = rowObject(result?.executionPermit);
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
    !isTimestamp(permit.notAfter)
  ) {
    throw new Error("Database returned an invalid provider execution permit");
  }
  return permit as unknown as ProviderExecutionPermit;
}

function cleanupExecutionPermitFrom(value: unknown): ProviderExecutionPermit {
  const result = rowObject(value);
  const permit = rowObject(result?.executionPermit);
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
    !isTimestamp(permit.notAfter)
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
    !isTimestamp(value.responseDeadline)
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
  const result = rowObject(value);
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
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
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
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    },
  };
}

export class SupabaseBookingRequestSubmissionRepository
  implements
    BookingRequestSubmissionRepository,
    BookingRequestSubmissionRecoveryRepository
{
  constructor(private readonly client: SupabaseClient) {}

  async expireAuthorizationClaims(): Promise<boolean> {
    const { error } = await this.client.rpc(
      "expire_booking_request_authorization_claims",
    );
    return !error;
  }

  async dueAuthorizedRecoveries(
    identity: PaymentProviderIdentity,
  ): Promise<readonly RecoverableSubmissionAttempt[]> {
    if (!providerIdentityFrom(identity))
      throw new Error("Invalid recovery provider identity");
    const { data, error } = await this.client.rpc(
      "due_booking_request_submission_recoveries",
      {
        target_provider_identity: identity,
      },
    );
    if (error)
      throw new Error("Booking Request recovery selection is unavailable");
    if (!Array.isArray(data) || data.length > 50)
      throw new Error("Invalid Booking Request recovery batch");
    const ids = new Set<string>();
    const lifecycles = new Set<string>();
    return data.map((value: unknown) => {
      const row = rowObject(value);
      const provider = providerIdentityFrom(row?.paymentProviderIdentity);
      if (
        !row ||
        !hasExactKeys(row, [
          "id",
          "paymentLifecycleId",
          "bookingPriceFils",
          "bookingServiceFeeFils",
          "paymentSnapshot",
          "paymentProviderIdentity",
        ]) ||
        typeof row.id !== "string" ||
        !uuid.test(row.id) ||
        typeof row.paymentLifecycleId !== "string" ||
        !uuid.test(row.paymentLifecycleId) ||
        typeof row.bookingPriceFils !== "number" ||
        !Number.isSafeInteger(row.bookingPriceFils) ||
        row.bookingPriceFils <= 0 ||
        typeof row.bookingServiceFeeFils !== "number" ||
        !Number.isSafeInteger(row.bookingServiceFeeFils) ||
        row.bookingServiceFeeFils <= 0 ||
        !Number.isSafeInteger(
          row.bookingPriceFils + row.bookingServiceFeeFils,
        ) ||
        !provider ||
        provider.provider !== identity.provider ||
        provider.environment !== identity.environment ||
        provider.merchantId !== identity.merchantId ||
        provider.terminalId !== identity.terminalId ||
        ids.has(row.id) ||
        lifecycles.has(row.paymentLifecycleId) ||
        !isAuthorizationPhasePaymentSnapshot(row.paymentSnapshot, {
          paymentLifecycleId: row.paymentLifecycleId,
          bookingPriceFils: row.bookingPriceFils,
          bookingServiceFeeFils: row.bookingServiceFeeFils,
        }) ||
        row.paymentSnapshot.authorization?.status !== "succeeded" ||
        row.paymentSnapshot.authorization.reconciliationRequired
      ) {
        throw new Error("Invalid Booking Request recovery batch");
      }
      ids.add(row.id);
      lifecycles.add(row.paymentLifecycleId);
      return {
        id: row.id,
        paymentLifecycleId: row.paymentLifecycleId,
        bookingPriceFils: row.bookingPriceFils,
        bookingServiceFeeFils: row.bookingServiceFeeFils,
        paymentSnapshot: row.paymentSnapshot,
        paymentProviderIdentity: provider,
      };
    });
  }

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
    purpose: SubmissionPaymentPersistencePurpose,
  ): Promise<ProviderExecutionPermit | void> {
    const { data, error } = await this.client.rpc(
      purpose === "authorization-claim"
        ? "begin_booking_request_authorization_claim"
        : purpose === "cleanup-release"
          ? "begin_booking_request_submission_cleanup_release"
          : "save_booking_request_payment_snapshot",
      {
        target_attempt_id: attemptId,
        target_payment_snapshot: snapshot,
        target_provider_identity: providerIdentity,
      },
    );
    if (error) {
      if (purpose === "authorization-claim") {
        const classification = await this.client.rpc(
          "classify_booking_request_authorization_claim_persistence",
          { target_attempt_id: attemptId },
        );
        const result = rowObject(classification.data);
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
    if (purpose === "cleanup-release") return cleanupExecutionPermitFrom(data);
    if (purpose !== "authorization-claim") return;
    const result = rowObject(data);
    if (
      result &&
      hasExactKeys(result, ["status"]) &&
      [
        "invalid",
        "customer-suspended",
        "quote-stale",
        "too-late",
        "unavailable",
      ].includes(result.status as string)
    ) {
      throw new BookingRequestPreAuthorizationRejected(
        result.status as
          | "invalid"
          | "customer-suspended"
          | "quote-stale"
          | "too-late"
          | "unavailable",
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
    const result = rowObject(data);
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
    const result = rowObject(data);
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
