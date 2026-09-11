import { bookingRefundRequestMatches } from "./booking-refund-contract";
import { recoveryRequestMatches } from "./booking-request-payment-recovery-contract";
import { paymentRequiredExpiryRequestMatches } from "./booking-request-payment-required-expiry-contract";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ProviderOperationBinding,
  ProviderOperationRequest,
  ProviderOperationResult,
  ProviderReconciliationQuery,
  PaymentProviderIdentity,
} from "./payment-contract";
import type {
  PaymentOperationAdmission,
  PaymentOperationAdmissionResult,
  PaymentOperationExecutionRepository,
} from "./payment-operation-execution";
import {
  paymentBindingMatches,
  paymentIdentityMatches,
  validatedProviderResult,
} from "./payment-operation-execution";
import type {
  SimulatorEffectBinding,
  SimulatorEffectRepository,
} from "./durable-payment-simulator-core";

function operationFingerprint(
  request: ProviderOperationBinding,
  identity: PaymentProviderIdentity,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        provider: identity,
        kind: request.kind,
        paymentLifecycleId: request.paymentLifecycleId,
        logicalOperationId: request.logicalOperationId,
        attemptId: request.attemptId,
        amountFils: request.amountFils,
        currency: request.currency,
      }),
    )
    .digest("hex");
}

function operationPayload(
  request: ProviderOperationBinding,
  identity: PaymentProviderIdentity,
) {
  return {
    target_operation: {
      providerIdentity: identity,
      requestFingerprint: operationFingerprint(request, identity),
      paymentLifecycleId: request.paymentLifecycleId,
      logicalOperationId: request.logicalOperationId,
      physicalAttemptId: request.attemptId,
      operationKind: request.kind,
      amountFils: request.amountFils,
      currency: request.currency,
    },
  };
}

type ActiveExecutionPermit = Exclude<
  NonNullable<ProviderOperationRequest["executionPermit"]>,
  | { readonly purpose: "booking-request-capture" }
  | { readonly purpose: "booking-request-payment-recovery" }
  | { readonly purpose: "booking-request-payment-required-expiry" }
  | { readonly purpose: "booking-request-payment-required-corrective-refund" }
  | { readonly purpose: "booking-refund" }
>;

function permitPayload(permit: ActiveExecutionPermit) {
  if (permit.purpose === "booking-request-authorization") {
    return {
      permitPurpose: permit.purpose,
      claimId: permit.claimId,
      claimGeneration: permit.generation,
      idempotencyKey: permit.idempotencyKey,
      notAfter: permit.notAfter,
      workId: null,
      leaseGeneration: null,
      leaseToken: null,
      operationId: null,
      operationGeneration: null,
      cleanupAttemptId: null,
      stateRevision: null,
    };
  }
  if (permit.purpose === "booking-request-submission-cleanup") {
    return {
      permitPurpose: permit.purpose,
      claimId: permit.claimId,
      claimGeneration: permit.generation,
      idempotencyKey: permit.idempotencyKey,
      notAfter: permit.notAfter,
      workId: null,
      leaseGeneration: null,
      leaseToken: null,
      operationId: null,
      operationGeneration: null,
      cleanupAttemptId: permit.attemptId,
      stateRevision: permit.stateRevision,
    };
  }
  return {
    permitPurpose: permit.purpose,
    claimId: null,
    claimGeneration: null,
    idempotencyKey: permit.idempotencyKey,
    notAfter: permit.notAfter,
    workId: permit.workId,
    leaseGeneration: permit.leaseGeneration,
    leaseToken: permit.leaseToken,
    operationId: permit.operationId,
    operationGeneration: permit.operationGeneration,
    cleanupAttemptId: null,
    stateRevision: null,
  };
}

function admissionFrom(
  value: unknown,
  binding: ProviderOperationBinding,
  identity: PaymentProviderIdentity,
): PaymentOperationAdmission {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid payment admission");
  const admission = value as PaymentOperationAdmission;
  const validTime = (time: unknown) =>
    time === null ||
    (typeof time === "string" && Number.isFinite(Date.parse(time)));
  if (
    typeof admission.operationId !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(admission.operationId) ||
    typeof admission.idempotencyKey !== "string" ||
    !admission.idempotencyKey ||
    typeof admission.requestFingerprint !== "string" ||
    !/^[0-9a-f]{64}$/.test(admission.requestFingerprint) ||
    !admission.binding ||
    !paymentBindingMatches(admission.binding, binding) ||
    !admission.providerIdentity ||
    !paymentIdentityMatches(admission.providerIdentity, identity) ||
    !validTime(admission.notBefore) ||
    !validTime(admission.notAfter) ||
    !["execute", "reconcile"].includes(admission.mode) ||
    ![
      "booking-request-authorization",
      "booking-request-submission-cleanup",
      "booking-request-release",
      "booking-request-capture",
      "booking-request-payment-recovery",
      "booking-request-payment-required-expiry",
      "booking-request-payment-required-corrective-refund",
      "booking-refund",
    ].includes(admission.purpose)
  )
    throw new Error("Invalid payment admission binding");
  return admission;
}

function purposeRoutine(purpose: PaymentOperationAdmission["purpose"]): string {
  switch (purpose) {
    case "booking-refund":
      return "booking_refund";
    case "booking-request-capture":
      return "booking_request_capture";
    case "booking-request-payment-recovery":
      return "booking_request_payment_recovery";
    case "booking-request-payment-required-expiry":
    case "booking-request-payment-required-corrective-refund":
      return "booking_request_payment_required_expiry";
    default:
      return "booking_request_provider_operation";
  }
}

export class SupabasePaymentOperationExecutionRepository implements PaymentOperationExecutionRepository {
  constructor(private readonly client: SupabaseClient) {}
  async pendingAuthorizationQueries(
    identity: PaymentProviderIdentity,
  ): Promise<readonly ProviderReconciliationQuery[]> {
    const { data, error } = await this.client.rpc(
      "pending_booking_request_authorization_observations",
    );
    if (error || !Array.isArray(data))
      throw new Error("Payment inquiry selection is unavailable");
    return data.map((value) => {
      const candidate = value as PaymentOperationAdmission;
      if (
        !candidate?.binding ||
        candidate.binding.currency !== "IQD" ||
        !Number.isSafeInteger(candidate.binding.amountFils) ||
        candidate.binding.amountFils <= 0 ||
        !["authorization", "release"].includes(candidate.binding.kind) ||
        ![
          candidate.binding.paymentLifecycleId,
          candidate.binding.logicalOperationId,
          candidate.binding.attemptId,
        ].every((part) => typeof part === "string" && part.length > 0)
      )
        throw new Error("Invalid pending payment inquiry");
      const admission = admissionFrom(value, candidate.binding, identity);
      return {
        ...admission.binding,
        providerRequestId: null,
        providerReference: null,
      };
    });
  }
  async admit(
    request: ProviderOperationRequest,
    identity: PaymentProviderIdentity,
  ): Promise<PaymentOperationAdmissionResult> {
    const permit = request.executionPermit;
    if (!permit)
      throw new Error("Payment admission needs a booking execution permit");
    if (
      (permit.purpose === "booking-refund" &&
        !bookingRefundRequestMatches(request, permit, identity)) ||
      (permit.purpose === "booking-request-payment-recovery" &&
        !recoveryRequestMatches(request, permit, identity)) ||
      ((permit.purpose === "booking-request-payment-required-expiry" ||
        permit.purpose ===
          "booking-request-payment-required-corrective-refund") &&
        !paymentRequiredExpiryRequestMatches(request, permit, identity))
    )
      throw new Error("Payment request does not match its admission permit");
    const routine = purposeRoutine(permit.purpose);
    const payload =
      routine === "booking_request_provider_operation"
        ? {
            target_operation: {
              ...operationPayload(request, identity).target_operation,
              ...permitPayload(permit as ActiveExecutionPermit),
              requestFingerprint:
                "requestFingerprint" in permit
                  ? permit.requestFingerprint
                  : operationFingerprint(request, identity),
            },
          }
        : { target_permit: permit };
    const { data, error } = await this.client.rpc(`admit_${routine}`, payload);
    if (error) throw new Error("Payment operation admission is unavailable");
    if (data?.status === "not-admitted" && Object.keys(data).length === 1)
      return { status: "not-admitted" };
    return admissionFrom(data, request, identity);
  }
  async reload(
    query: ProviderReconciliationQuery,
    identity: PaymentProviderIdentity,
  ): Promise<PaymentOperationAdmissionResult> {
    if (
      (query.refundPermit &&
        !bookingRefundRequestMatches(query, query.refundPermit, identity)) ||
      (query.recoveryPermit &&
        !recoveryRequestMatches(query, query.recoveryPermit, identity)) ||
      (query.expiryPermit &&
        !paymentRequiredExpiryRequestMatches(
          query,
          query.expiryPermit,
          identity,
        ))
    )
      throw new Error("Payment inquiry permit is invalid");
    const fingerprint = query.refundPermit
      ? query.refundPermit.binding.requestFingerprint
      : query.recoveryPermit
        ? query.recoveryPermit.binding.requestFingerprint
        : query.expiryPermit
          ? query.expiryPermit.purpose ===
            "booking-request-payment-required-expiry"
            ? query.expiryPermit.binding.requestFingerprint
            : null
          : query.kind === "release"
            ? null
            : operationFingerprint(query, identity);
    const { data, error } = await this.client.rpc(
      "reload_booking_request_payment_operation",
      {
        target_operation: {
          ...operationPayload(query, identity).target_operation,
          requestFingerprint: fingerprint,
        },
        target_provider_request_id: query.providerRequestId,
        target_provider_reference: query.providerReference,
      },
    );
    if (error) throw new Error("Payment operation inquiry is unavailable");
    if (data?.status === "not-admitted" && Object.keys(data).length === 1)
      return { status: "not-admitted" };
    return admissionFrom(data, query, identity);
  }
  async record(
    admission: PaymentOperationAdmission,
    result: ProviderOperationResult,
  ): Promise<ProviderOperationResult> {
    if (
      [
        "booking-request-payment-recovery",
        "booking-request-payment-required-expiry",
        "booking-request-payment-required-corrective-refund",
        "booking-refund",
      ].includes(admission.purpose)
    )
      throw new Error("Payment observation requires application consequences");
    const { data, error } = await this.client.rpc(
      `record_${purposeRoutine(admission.purpose)}_observation`,
      {
        target_operation_id: admission.operationId,
        target_result: result,
      },
    );
    if (error) throw new Error("Payment operation recording is unavailable");
    return validatedProviderResult(data, admission.operationId);
  }
}

export class SupabaseSimulatorEffectRepository implements SimulatorEffectRepository {
  constructor(private readonly client: SupabaseClient) {}
  async executeOnce(
    binding: SimulatorEffectBinding,
    proposed: ProviderOperationResult,
  ): Promise<ProviderOperationResult> {
    const { data, error } = await this.client.rpc(
      "persist_simulated_payment_effect",
      { target_binding: binding, target_result: proposed },
    );
    if (error) throw new Error("Fictional provider effect is unavailable");
    return validatedProviderResult(data, binding.operationId);
  }
  async queryAndSealAbsent(
    binding: SimulatorEffectBinding,
  ): Promise<ProviderOperationResult> {
    const { data, error } = await this.client.rpc(
      "seal_simulated_payment_absence",
      { target_binding: binding },
    );
    if (error) throw new Error("Fictional provider inquiry is unavailable");
    return validatedProviderResult(data, binding.operationId);
  }
  async resolve(
    binding: SimulatorEffectBinding,
    expectedEventId: string,
    proposed: ProviderOperationResult,
  ): Promise<ProviderOperationResult> {
    const { data, error } = await this.client.rpc(
      "resolve_simulated_payment_effect",
      {
        target_binding: binding,
        target_event_id: expectedEventId,
        target_result: proposed,
      },
    );
    if (error) throw new Error("Fictional provider resolution is unavailable");
    return validatedProviderResult(data, binding.operationId);
  }
}
