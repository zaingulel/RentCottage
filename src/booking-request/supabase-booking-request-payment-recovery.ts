import {
  recoveryConfirmationEvidenceFrom,
  SupabaseBookingRequestConfirmationRepository,
} from "./supabase-booking-request-confirmation";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  paymentRecoveryOperationKinds,
  recoveryPermitFrom,
} from "@/payment/booking-request-payment-recovery-contract";
import type {
  BookingRequestPaymentRecoveryRepository,
  PaymentRecoveryAdmission,
  PaymentRecoveryLease,
} from "./booking-request-payment-recovery";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const terminalStatuses = [
  "retryable",
  "succeeded",
  "late-succeeded",
  "deadline-elapsed",
  "blocked",
  "quarantined",
  "unavailable",
] as const;

export class SupabaseBookingRequestPaymentRecoveryRepository implements BookingRequestPaymentRecoveryRepository {
  constructor(
    private readonly customerClient: SupabaseClient,
    private readonly serviceClient: SupabaseClient,
  ) {}

  async admit(input: {
    readonly bookingRequestId: string;
    readonly commandKey: string;
  }): Promise<PaymentRecoveryAdmission> {
    const { data, error } = await this.customerClient.rpc(
      "claim_customer_booking_request_payment_recovery",
      {
        target_booking_request_id: input.bookingRequestId,
        target_command_key: input.commandKey,
        target_replacement_method: "simulated-replacement",
      },
    );
    if (error)
      throw new Error("Booking Request payment recovery is unavailable");
    const value = data as Record<string, unknown>;
    if (value?.status === "quarantined") return { status: "quarantined" };
    if (
      !value ||
      !["processing", "retryable", "succeeded", "late-succeeded"].includes(
        value.status as string,
      ) ||
      typeof value.attemptId !== "string" ||
      !uuid.test(value.attemptId) ||
      typeof value.deadline !== "string" ||
      Number.isNaN(Date.parse(value.deadline))
    ) {
      throw new Error("Booking Request payment recovery data is invalid");
    }
    return value as PaymentRecoveryAdmission;
  }

  async lease(attemptId: string): Promise<PaymentRecoveryLease> {
    const { data, error } = await this.serviceClient.rpc(
      "lease_booking_request_payment_recovery_step",
      { target_attempt_id: attemptId },
    );
    if (error)
      throw new Error("Booking Request payment recovery is unavailable");
    const value = data as Record<string, unknown>;
    if (value?.status === "leased" || value?.status === "reconcile") {
      const permit = recoveryPermitFrom(value.permit);
      const raw = permit.binding;
      if (
        permit.attemptId !== attemptId ||
        JSON.stringify(value.binding) !==
          JSON.stringify((value.permit as Record<string, unknown>).binding)
      )
        throw new Error("Booking Request payment recovery data is invalid");
      const binding = {
        kind: paymentRecoveryOperationKinds[raw.step],
        paymentLifecycleId: raw.paymentLifecycleId,
        logicalOperationId: raw.logicalOperationId,
        attemptId: raw.physicalAttemptId,
        amountFils: raw.amountFils,
        currency: "IQD",
      } as const;
      if (value.status === "reconcile") {
        if (
          typeof value.providerRequestId !== "string" ||
          !value.providerRequestId ||
          typeof value.providerReference !== "string" ||
          !value.providerReference
        )
          throw new Error("Booking Request payment recovery data is invalid");
        return {
          status: "reconcile",
          permit,
          binding,
          providerRequestId: value.providerRequestId,
          providerReference: value.providerReference,
        };
      }
      return { status: "leased", permit, binding };
    }

    if (
      terminalStatuses.includes(
        value?.status as (typeof terminalStatuses)[number],
      )
    )
      return { status: value.status as (typeof terminalStatuses)[number] };
    throw new Error("Booking Request payment recovery data is invalid");
  }

  async due(limit: number): Promise<readonly string[]> {
    const { data, error } = await this.serviceClient.rpc(
      "due_booking_request_payment_recoveries",
      { target_limit: limit },
    );
    if (
      error ||
      !Array.isArray(data) ||
      data.length > limit ||
      !data.every((value) => typeof value === "string" && uuid.test(value)) ||
      new Set(data).size !== data.length
    )
      throw new Error("Booking Request recovery batch is invalid");
    return data;
  }

  async finalize(attemptId: string): Promise<void> {
    const { data, error } = await this.serviceClient.rpc(
      "get_booking_request_payment_recovery_confirmation_evidence",
      { target_attempt_id: attemptId },
    );
    if (error)
      throw new Error("Booking Request recovery confirmation is unavailable");
    const evidence = recoveryConfirmationEvidenceFrom(data, attemptId);
    await new SupabaseBookingRequestConfirmationRepository(
      this.serviceClient,
    ).finalize(evidence.bookingRequestId, evidence);
  }
}
