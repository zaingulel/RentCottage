import type { SupabaseClient } from "@supabase/supabase-js";

import {
  paymentRequiredExpiryPermitFrom,
  type BookingRequestPaymentRequiredExpiryPermit,
} from "@/payment/booking-request-payment-required-expiry-contract";
import {
  paymentRecoveryOperationKinds,
  recoveryPermitFrom,
} from "@/payment/booking-request-payment-recovery-contract";
import type {
  PaymentProviderIdentity,
  ProviderOperationBinding,
} from "@/payment/payment-contract";
import type {
  BookingRequestPaymentRequiredExpiryRepository,
  PaymentRequiredExpiryPreparation,
  PaymentRequiredExpiryResult,
} from "./booking-request-payment-required-expiry";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const terminal = [
  "processing",
  "attention-required",
  "quarantined",
  "expired",
  "confirmed",
  "not-due",
  "unavailable",
] as const;

function bindingMatches(expected: object, value: unknown): boolean {
  const raw = record(value);
  return (
    !!raw &&
    Object.keys(raw).length === Object.keys(expected).length &&
    Object.entries(expected).every(([key, entry]) =>
      entry !== null && typeof entry === "object"
        ? bindingMatches(entry, raw[key])
        : raw[key] === entry,
    )
  );
}

function expiryBinding(
  permit: BookingRequestPaymentRequiredExpiryPermit,
): ProviderOperationBinding {
  if (permit.purpose === "booking-request-payment-required-corrective-refund")
    return {
      kind: "refund",
      paymentLifecycleId: permit.binding.paymentLifecycleId,
      logicalOperationId: permit.binding.refundLogicalOperationId,
      attemptId: permit.binding.refundPhysicalAttemptId,
      amountFils: permit.binding.amountFils,
      currency: "IQD",
    };
  return {
    kind: "release",
    paymentLifecycleId: permit.binding.authorizationPaymentLifecycleId,
    logicalOperationId: permit.binding.releaseLogicalOperationId,
    attemptId: permit.binding.releasePhysicalAttemptId,
    amountFils: permit.binding.amountFils,
    currency: "IQD",
  };
}

export class SupabaseBookingRequestPaymentRequiredExpiryRepository implements BookingRequestPaymentRequiredExpiryRepository {
  constructor(private readonly serviceClient: SupabaseClient) {}

  async due(
    limit: number,
    providerIdentity: PaymentProviderIdentity,
  ): Promise<readonly string[]> {
    const { data, error } = await this.serviceClient.rpc(
      "claim_due_booking_request_payment_required_expiries",
      { target_limit: limit, target_provider_identity: providerIdentity },
    );
    if (error || !Array.isArray(data) || data.length > limit)
      throw new Error("Payment Required expiry batch is invalid");
    const ids = data.map((item) => record(item)?.bookingRequestId);
    if (
      !ids.every((id) => typeof id === "string" && uuid.test(id)) ||
      new Set(ids).size !== ids.length
    )
      throw new Error("Payment Required expiry batch is invalid");
    return ids as string[];
  }

  async prepare(
    bookingRequestId: string,
    providerIdentity: PaymentProviderIdentity,
  ): Promise<PaymentRequiredExpiryPreparation> {
    const { data, error } = await this.serviceClient.rpc(
      "prepare_booking_request_payment_required_expiry",
      {
        target_booking_request_id: bookingRequestId,
        target_provider_identity: providerIdentity,
      },
    );
    const value = record(data);
    if (error || !value)
      throw new Error("Payment Required expiry data is invalid");
    if (terminal.includes(value.status as (typeof terminal)[number]))
      return { status: value.status } as PaymentRequiredExpiryResult;
    if (value.status === "ready") return { status: "ready" };
    if (
      value.status === "release" ||
      value.status === "refund" ||
      value.status === "reconcile-expiry"
    ) {
      let permit: BookingRequestPaymentRequiredExpiryPermit;
      try {
        permit = paymentRequiredExpiryPermitFrom(value.permit);
      } catch {
        throw new Error("Payment Required expiry data is invalid");
      }
      if (
        permit.binding.bookingRequestId !== bookingRequestId ||
        (value.status === "refund" &&
          permit.purpose !==
            "booking-request-payment-required-corrective-refund") ||
        (value.status === "release" &&
          permit.purpose !== "booking-request-payment-required-expiry") ||
        !bindingMatches(permit.binding, value.binding) ||
        !bindingMatches(providerIdentity, permit.binding.providerIdentity) ||
        (value.status === "reconcile-expiry" &&
          (typeof value.providerRequestId !== "string" ||
            !value.providerRequestId.trim() ||
            typeof value.providerReference !== "string" ||
            !value.providerReference.trim()))
      )
        throw new Error("Payment Required expiry data is invalid");
      return value.status === "release" || value.status === "refund"
        ? { status: value.status, permit, binding: expiryBinding(permit) }
        : {
            status: "reconcile-expiry",
            permit,
            binding: expiryBinding(permit),
            providerRequestId: value.providerRequestId as string,
            providerReference: value.providerReference as string,
          };
    }
    if (value.status === "reconcile-recovery") {
      const permit = recoveryPermitFrom(value.permit);
      if (
        permit.binding.bookingRequestId !== bookingRequestId ||
        !bindingMatches(permit.binding, value.binding) ||
        !bindingMatches(providerIdentity, permit.binding.providerIdentity) ||
        typeof value.providerRequestId !== "string" ||
        !value.providerRequestId.trim() ||
        typeof value.providerReference !== "string" ||
        !value.providerReference.trim()
      )
        throw new Error("Payment Required expiry data is invalid");
      return {
        status: "reconcile-recovery",
        permit,
        binding: {
          kind: paymentRecoveryOperationKinds[permit.step],
          paymentLifecycleId: permit.binding.paymentLifecycleId,
          logicalOperationId: permit.binding.logicalOperationId,
          attemptId: permit.binding.physicalAttemptId,
          amountFils: permit.binding.amountFils,
          currency: "IQD",
        },
        providerRequestId: value.providerRequestId,
        providerReference: value.providerReference,
      };
    }
    throw new Error("Payment Required expiry data is invalid");
  }

  async finalize(
    bookingRequestId: string,
  ): Promise<PaymentRequiredExpiryResult> {
    const { data, error } = await this.serviceClient.rpc(
      "finalize_booking_request_payment_required_expiry",
      { target_booking_request_id: bookingRequestId },
    );
    const value = record(data);
    if (
      error ||
      !value ||
      value.bookingRequestId !== bookingRequestId ||
      ![
        "processing",
        "attention-required",
        "quarantined",
        "expired",
        "confirmed",
        "not-due",
      ].includes(value.status as string)
    )
      throw new Error("Payment Required expiry finalization is unavailable");
    return { status: value.status } as PaymentRequiredExpiryResult;
  }
}
