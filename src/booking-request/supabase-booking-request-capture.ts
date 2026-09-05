import type { SupabaseClient } from "@supabase/supabase-js";

import {
  rehydrateBookingRequestCaptureExecutionPermit,
  rehydrateBookingRequestCaptureSnapshot,
} from "@/payment/booking-request-capture-contract";
import type {
  BookingRequestCaptureBinding,
  BookingRequestCaptureExecutionPermit,
  ProviderOperationResult,
  BookingRequestCapturePermitExpectation,
  BookingRequestCaptureEvidenceExpectation,
  BookingRequestCaptureProviderResultIdentity,
  PaymentProviderIdentity,
} from "@/payment/payment-contract";

import type {
  BookingRequestCaptureLeasedWork,
  BookingRequestCaptureResult,
  BookingRequestCaptureRepository,
} from "./booking-request-capture";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return (
    Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}
function isUuid(value: unknown) {
  return typeof value === "string" && uuid.test(value);
}
function positiveInteger(value: unknown) {
  return Number.isSafeInteger(value) && (value as number) > 0;
}
function timestamp(value: unknown) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function bindingFrom(
  value: Record<string, unknown>,
  bookingRequestId: string,
  providerIdentity: PaymentProviderIdentity,
): BookingRequestCaptureBinding {
  const provider = record(value.providerIdentity);
  if (
    value.bookingRequestId !== bookingRequestId ||
    !isUuid(value.bookingRequestId) ||
    !isUuid(value.submissionAttemptId) ||
    !isUuid(value.authorizationClaimId) ||
    !positiveInteger(value.authorizationClaimGeneration) ||
    !isUuid(value.paymentLifecycleId) ||
    value.authorizationLogicalOperationId !==
      `${value.paymentLifecycleId}:authorization` ||
    typeof value.authorizationPhysicalAttemptId !== "string" ||
    !new RegExp(
      `^${value.authorizationLogicalOperationId}:attempt-[1-9][0-9]*$`,
    ).test(value.authorizationPhysicalAttemptId) ||
    value.captureLogicalOperationId !== `${value.paymentLifecycleId}:capture` ||
    value.capturePhysicalAttemptId !==
      `${value.captureLogicalOperationId}:attempt-2` ||
    !positiveInteger(value.amountFils) ||
    value.currency !== "IQD" ||
    value.idempotencyKey !==
      `booking-request-capture:${bookingRequestId}:${value.authorizationClaimGeneration}` ||
    typeof value.requestFingerprint !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.requestFingerprint) ||
    !provider ||
    !exactKeys(provider, [
      "provider",
      "environment",
      "merchantId",
      "terminalId",
    ]) ||
    Object.entries(providerIdentity).some(
      ([key, expected]) =>
        typeof expected !== "string" ||
        expected.length === 0 ||
        provider[key] !== expected,
    )
  )
    throw new Error("Database returned invalid Capture bindings");
  return {
    bookingRequestId,
    submissionAttemptId: value.submissionAttemptId as string,
    authorizationClaimId: value.authorizationClaimId as string,
    authorizationClaimGeneration: value.authorizationClaimGeneration as number,
    paymentLifecycleId: value.paymentLifecycleId as string,
    authorizationLogicalOperationId:
      value.authorizationLogicalOperationId as string,
    authorizationPhysicalAttemptId: value.authorizationPhysicalAttemptId,
    captureLogicalOperationId: value.captureLogicalOperationId as string,
    capturePhysicalAttemptId: value.capturePhysicalAttemptId as string,
    amountFils: value.amountFils as number,
    currency: "IQD",
    providerIdentity,
    idempotencyKey: value.idempotencyKey as string,
    requestFingerprint: value.requestFingerprint,
  };
}

function resultIdentityFrom(
  value: unknown,
): BookingRequestCaptureProviderResultIdentity {
  const identity = record(value);
  if (
    !identity ||
    !exactKeys(identity, [
      "providerRequestId",
      "providerReference",
      "movementReference",
    ]) ||
    Object.values(identity).some(
      (item) => typeof item !== "string" || item.trim().length === 0,
    )
  )
    throw new Error("Database returned invalid Capture provider evidence");
  return identity as unknown as BookingRequestCaptureProviderResultIdentity;
}

function completedFrom(
  value: unknown,
  bookingRequestId: string,
  providerIdentity: PaymentProviderIdentity,
  permit?: BookingRequestCaptureExecutionPermit,
  providerResult?: BookingRequestCaptureProviderResultIdentity,
): Extract<BookingRequestCaptureResult, { status: "complete" }> {
  const result = record(value);
  const expected = record(result?.expectation);
  if (
    !result ||
    !exactKeys(result, ["status", "snapshot", "expectation"]) ||
    result.status !== "complete" ||
    !expected
  )
    throw new Error("Database returned invalid Capture evidence");
  const binding = bindingFrom(expected, bookingRequestId, providerIdentity);
  if (
    !exactKeys(expected, [
      ...Object.keys(binding),
      "authorizationProviderResult",
      "captureProviderResult",
      "authorizationRecordedAt",
      "captureRecordedAt",
    ]) ||
    !timestamp(expected.authorizationRecordedAt) ||
    !timestamp(expected.captureRecordedAt) ||
    (permit &&
      Object.entries(binding).some(
        ([key, value]) =>
          key !== "providerIdentity" &&
          permit[key as keyof BookingRequestCaptureBinding] !== value,
      ))
  )
    throw new Error("Database returned replaced Capture evidence");
  const captureProviderResult = resultIdentityFrom(
    expected.captureProviderResult,
  );
  if (
    providerResult &&
    Object.entries(captureProviderResult).some(
      ([key, value]) =>
        providerResult[
          key as keyof BookingRequestCaptureProviderResultIdentity
        ] !== value,
    )
  )
    throw new Error("Database returned replaced Capture provider evidence");
  const expectation: BookingRequestCaptureEvidenceExpectation = {
    ...binding,
    authorizationProviderResult: resultIdentityFrom(
      expected.authorizationProviderResult,
    ),
    captureProviderResult,
    authorizationRecordedAt: expected.authorizationRecordedAt as string,
    captureRecordedAt: expected.captureRecordedAt as string,
  };
  return {
    status: "complete",
    snapshot: rehydrateBookingRequestCaptureSnapshot(
      result.snapshot,
      expectation,
    ),
  };
}

export class SupabaseBookingRequestCaptureRepository implements BookingRequestCaptureRepository {
  constructor(private readonly client: SupabaseClient) {}
  async lease(
    bookingRequestId: string,
    providerIdentity: PaymentProviderIdentity,
  ): Promise<BookingRequestCaptureLeasedWork | BookingRequestCaptureResult> {
    const { data, error } = await this.client.rpc(
      "lease_booking_request_capture_work",
      {
        target_booking_request_id: bookingRequestId,
        target_provider_identity: providerIdentity,
      },
    );
    if (error) throw new Error("Capture lease is unavailable");
    const result = record(data);
    if (result?.status === "complete")
      return completedFrom(data, bookingRequestId, providerIdentity);
    if (
      result &&
      exactKeys(result, ["status"]) &&
      (result.status === "processing" ||
        result.status === "expired" ||
        result.status === "unavailable")
    )
      return { status: result.status };
    const permit = record(result?.permit);
    if (
      !result ||
      !exactKeys(result, ["status", "permit"]) ||
      result.status !== "leased" ||
      !permit ||
      permit.workId !== bookingRequestId ||
      !positiveInteger(permit.leaseGeneration) ||
      !isUuid(permit.leaseToken) ||
      !timestamp(permit.notAfter)
    )
      throw new Error("Database returned an invalid Capture permit");
    const expected: BookingRequestCapturePermitExpectation = {
      ...bindingFrom(permit, bookingRequestId, providerIdentity),
      workId: bookingRequestId,
      leaseGeneration: permit.leaseGeneration as number,
      leaseToken: permit.leaseToken as string,
      notAfter: permit.notAfter as string,
    };
    return {
      status: "leased",
      permit: rehydrateBookingRequestCaptureExecutionPermit(permit, expected),
    };
  }
  async complete(
    permit: BookingRequestCaptureExecutionPermit,
    providerResult: Extract<ProviderOperationResult, { outcome: "succeeded" }>,
  ) {
    const { data, error } = await this.client.rpc(
      "complete_booking_request_capture",
      {
        target_booking_request_id: permit.bookingRequestId,
        target_lease_generation: permit.leaseGeneration,
        target_lease_token: permit.leaseToken,
        target_provider_result: providerResult,
      },
    );
    if (error) throw new Error("Capture completion is unavailable");
    return completedFrom(
      data,
      permit.bookingRequestId,
      permit.providerIdentity,
      permit,
      providerResult,
    );
  }
}
