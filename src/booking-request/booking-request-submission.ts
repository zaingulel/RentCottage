import type { CottageDiscoveryQuery } from "@/cottage-discovery/discovery-query";
import type { Locale } from "@/i18n/routing";
import {
  iqdToFils,
  type PaymentLifecycleSnapshot,
  type PaymentProviderIdentity,
  type PaymentProviderAdapter,
  type ProviderExecutionPermit,
} from "@/payment/payment-contract";
import {
  createPaymentLifecycle,
  ProviderExecutionNotStartedError,
  rehydratePaymentAuthorizationLifecycle,
} from "@/payment/payment-lifecycle";

import { isContactSafeBookingRequestText } from "./booking-request-content";
import {
  bookingRequestAcceptanceEvidence,
  type BookingRequestAcceptanceEvidence,
} from "./booking-request-policy";
import type { BookingRequestStatus } from "./booking-request-status";

export const CANCELLATION_POLICY_VERSION = "rentcottage-mvp-2026-08-04";

export interface SubmissionInput {
  readonly customerUserId: string;
  readonly idempotencyKey: string;
  readonly locale: Locale;
  readonly publicSlug: string;
  readonly discoveryQuery: CottageDiscoveryQuery;
  readonly displayedQuote: {
    readonly fingerprint: string;
    readonly contentVersion: number;
    readonly termsVersion: string;
    readonly bookingPriceIqd: number;
    readonly serviceFeeIqd: number;
    readonly customerTotalIqd: number;
    readonly firstStartsAt: string;
  };
  readonly customerName: string;
  readonly partySize: number;
  readonly bookingNote: string | null;
  readonly acceptedHouseRules: boolean;
  readonly acceptedCancellationPolicy: boolean;
  readonly acceptedMarketplaceTerms: boolean;
  readonly acceptedInside48HourNoRefund: boolean;
  readonly acceptanceEvidence: BookingRequestAcceptanceEvidence;
}

export interface SubmissionAttempt {
  readonly id: string;
  readonly paymentLifecycleId: string;
  readonly paymentSnapshot: PaymentLifecycleSnapshot | null;
  readonly paymentProviderIdentity: PaymentProviderIdentity | null;
}

export type SubmissionFailureStatus =
  | "invalid"
  | "access-required"
  | "quote-stale"
  | "too-late"
  | "authorization-failed"
  | "payment-unavailable"
  | "reconciliation-required"
  | "unavailable";

export type ExistingBookingRequestResult = {
  readonly status: BookingRequestStatus;
  readonly bookingRequestReference: string;
  readonly responseDeadline: string;
};

export type SubmissionResult =
  | ExistingBookingRequestResult
  | {
      readonly status: SubmissionFailureStatus;
    };

export type PrepareSubmissionResult =
  | { readonly status: "ready"; readonly attempt: SubmissionAttempt }
  | { readonly status: SubmissionFailureStatus }
  | ExistingBookingRequestResult;

export type SubmissionLookupResult =
  | (ExistingBookingRequestResult & { readonly status: "pending" })
  | { readonly status: "absent" }
  | { readonly status: "unknown" };

export interface BookingRequestSubmissionRepository {
  prepare(input: SubmissionInput): Promise<PrepareSubmissionResult>;
  savePaymentSnapshot(
    attemptId: string,
    snapshot: PaymentLifecycleSnapshot,
    providerIdentity: PaymentProviderIdentity,
  ): Promise<ProviderExecutionPermit | void>;
  finalize(
    attemptId: string,
    snapshot: PaymentLifecycleSnapshot,
  ): Promise<ExistingBookingRequestResult & { readonly status: "pending" }>;
  lookup(attemptId: string): Promise<SubmissionLookupResult>;
  markReconciliationRequired(attemptId: string): Promise<void>;
}

export class BookingRequestPreAuthorizationRejected extends Error {
  constructor(
    readonly status: "invalid" | "quote-stale" | "too-late" | "unavailable",
  ) {
    super(`booking_request_pre_authorization_${status}`);
    this.name = "BookingRequestPreAuthorizationRejected";
  }
}

export class BookingRequestAuthorizationClaimNotPersisted extends Error {
  constructor() {
    super("booking_request_authorization_claim_not_persisted");
    this.name = "BookingRequestAuthorizationClaimNotPersisted";
  }
}

export interface BookingRequestSubmission {
  submit(input: SubmissionInput): Promise<SubmissionResult>;
}

export type BookingRequestDiagnosticCode =
  | "booking_request_prepare_failed"
  | "booking_request_rehydration_failed"
  | "booking_request_provider_identity_mismatch"
  | "booking_request_authorization_failed"
  | "booking_request_finalization_failed"
  | "booking_request_lookup_failed"
  | "booking_request_lookup_unknown"
  | "booking_request_release_failed"
  | "booking_request_reconciliation_marker_failed";

export interface BookingRequestDiagnostics {
  record(event: {
    readonly code: BookingRequestDiagnosticCode;
    readonly attemptId?: string;
  }): void;
}

function sameProviderIdentity(
  left: PaymentProviderIdentity,
  right: PaymentProviderIdentity,
): boolean {
  return (
    left.provider === right.provider &&
    left.environment === right.environment &&
    left.merchantId === right.merchantId &&
    left.terminalId === right.terminalId
  );
}

function validInput(input: SubmissionInput): boolean {
  const note = input.bookingNote ?? "";
  const expectedEvidence = bookingRequestAcceptanceEvidence({
    locale: input.locale,
    termsVersion: input.displayedQuote.termsVersion,
    requiresInside48HourNoRefundAcceptance:
      input.acceptanceEvidence.inside48Warning !== null,
  });
  return (
    /^[0-9a-f-]{36}$/i.test(input.customerUserId) &&
    /^[0-9a-f-]{36}$/i.test(input.idempotencyKey) &&
    /^cottage-[0-9a-f]{32}$/.test(input.publicSlug) &&
    /^[0-9a-f]{64}$/.test(input.displayedQuote.fingerprint) &&
    input.customerName === input.customerName.trim() &&
    input.customerName.length >= 2 &&
    input.customerName.length <= 120 &&
    isContactSafeBookingRequestText(input.customerName) &&
    note === note.trim() &&
    note.length <= 500 &&
    isContactSafeBookingRequestText(note) &&
    Number.isSafeInteger(input.partySize) &&
    input.partySize > 0 &&
    input.partySize === input.discoveryQuery.guests &&
    input.acceptedHouseRules &&
    input.acceptedCancellationPolicy &&
    input.acceptedMarketplaceTerms &&
    (!expectedEvidence.inside48Warning || input.acceptedInside48HourNoRefund) &&
    JSON.stringify(input.acceptanceEvidence) ===
      JSON.stringify(expectedEvidence) &&
    Number.isSafeInteger(input.displayedQuote.bookingPriceIqd) &&
    input.displayedQuote.bookingPriceIqd > 0 &&
    Number.isSafeInteger(input.displayedQuote.serviceFeeIqd) &&
    input.displayedQuote.serviceFeeIqd > 0 &&
    input.displayedQuote.customerTotalIqd ===
      input.displayedQuote.bookingPriceIqd + input.displayedQuote.serviceFeeIqd
  );
}

export function createBookingRequestSubmission({
  repository,
  paymentProvider,
  diagnostics,
}: {
  repository: BookingRequestSubmissionRepository;
  paymentProvider: PaymentProviderAdapter;
  diagnostics?: BookingRequestDiagnostics;
}): BookingRequestSubmission {
  return {
    async submit(input) {
      if (!validInput(input)) return { status: "invalid" };
      const record = (
        code: BookingRequestDiagnosticCode,
        attemptId?: string,
      ) => {
        diagnostics?.record({ code, ...(attemptId ? { attemptId } : {}) });
      };
      const markReconciliationRequired = async (attemptId: string) => {
        try {
          await repository.markReconciliationRequired(attemptId);
        } catch {
          record("booking_request_reconciliation_marker_failed", attemptId);
        }
      };
      let prepared: PrepareSubmissionResult;
      try {
        prepared = await repository.prepare(input);
      } catch {
        record("booking_request_prepare_failed");
        return { status: "unavailable" };
      }
      if (prepared.status !== "ready") return prepared;
      const paymentInput = {
        paymentLifecycleId: prepared.attempt.paymentLifecycleId,
        bookingPriceFils: iqdToFils(input.displayedQuote.bookingPriceIqd),
        bookingServiceFeeFils: iqdToFils(input.displayedQuote.serviceFeeIqd),
      };
      if (
        prepared.attempt.paymentSnapshot &&
        (!prepared.attempt.paymentProviderIdentity ||
          !sameProviderIdentity(
            prepared.attempt.paymentProviderIdentity,
            paymentProvider.identity,
          ))
      ) {
        record(
          "booking_request_provider_identity_mismatch",
          prepared.attempt.id,
        );
        await markReconciliationRequired(prepared.attempt.id);
        return { status: "reconciliation-required" };
      }
      const persistence = {
        save: (snapshot: PaymentLifecycleSnapshot) =>
          repository.savePaymentSnapshot(
            prepared.attempt.id,
            snapshot,
            paymentProvider.identity,
          ),
      };
      let payment;
      try {
        payment = prepared.attempt.paymentSnapshot
          ? rehydratePaymentAuthorizationLifecycle(
              paymentInput,
              paymentProvider,
              prepared.attempt.paymentSnapshot,
              persistence,
            )
          : createPaymentLifecycle(paymentInput, paymentProvider, persistence);
        const storedRelease = payment.snapshot().release;
        if (storedRelease) {
          const release =
            storedRelease.status === "pending"
              ? await payment.reconcile(storedRelease.logicalOperationId)
              : storedRelease;
          if (release.status === "succeeded") return { status: "unavailable" };
          await markReconciliationRequired(prepared.attempt.id);
          return { status: "reconciliation-required" };
        }
      } catch {
        record("booking_request_rehydration_failed", prepared.attempt.id);
        await markReconciliationRequired(prepared.attempt.id);
        return { status: "reconciliation-required" };
      }
      let authorization;
      try {
        const storedAuthorization = payment.snapshot().authorization;
        authorization = storedAuthorization
          ? storedAuthorization.status === "pending"
            ? await payment.reconcile(storedAuthorization.logicalOperationId)
            : storedAuthorization
          : await payment.authorize();
      } catch (error) {
        if (error instanceof BookingRequestAuthorizationClaimNotPersisted) {
          return { status: "unavailable" };
        }
        if (error instanceof BookingRequestPreAuthorizationRejected) {
          return { status: error.status };
        }
        if (error instanceof ProviderExecutionNotStartedError) {
          return { status: "too-late" };
        }
        record("booking_request_authorization_failed", prepared.attempt.id);
        await markReconciliationRequired(prepared.attempt.id);
        return { status: "reconciliation-required" };
      }
      if (authorization.status === "failed") {
        return { status: "authorization-failed" };
      }
      if (
        authorization.status !== "succeeded" ||
        authorization.reconciliationRequired
      ) {
        await markReconciliationRequired(prepared.attempt.id);
        return { status: "reconciliation-required" };
      }

      try {
        return await repository.finalize(
          prepared.attempt.id,
          payment.snapshot(),
        );
      } catch {
        record("booking_request_finalization_failed", prepared.attempt.id);
        let lookup: SubmissionLookupResult = { status: "unknown" };
        try {
          lookup = await repository.lookup(prepared.attempt.id);
        } catch {
          record("booking_request_lookup_failed", prepared.attempt.id);
        }
        if (lookup.status === "pending") return lookup;
        if (lookup.status === "unknown") {
          record("booking_request_lookup_unknown", prepared.attempt.id);
        }
        if (lookup.status === "absent") {
          try {
            const release = await payment.release(
              iqdToFils(input.displayedQuote.customerTotalIqd),
            );
            if (release.status === "succeeded") {
              return { status: "unavailable" };
            }
          } catch {
            record("booking_request_release_failed", prepared.attempt.id);
          }
        }
        await markReconciliationRequired(prepared.attempt.id);
        return { status: "reconciliation-required" };
      }
    },
  };
}
