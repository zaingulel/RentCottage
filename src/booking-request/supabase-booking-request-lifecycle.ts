import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  PaymentLifecycleSnapshot,
  PaymentProviderIdentity,
  ProviderExecutionPermit,
} from "@/payment/payment-contract";
import { isAuthorizationPhasePaymentSnapshot } from "@/payment/payment-lifecycle";

import type {
  BookingRequestAction,
  BookingRequestLifecycleRepository,
  BookingRequestLifecycleResult,
  BookingRequestReleaseWork,
} from "./booking-request-lifecycle";
import { isBookingRequestStatus } from "./booking-request-status";

const bookingRequestReference = /^RC-REQ-[A-F0-9]{16}$/;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function providerIdentity(value: unknown): PaymentProviderIdentity | undefined {
  const identity = record(value);
  return identity &&
    typeof identity.provider === "string" &&
    typeof identity.environment === "string" &&
    typeof identity.merchantId === "string" &&
    typeof identity.terminalId === "string"
    ? {
        provider: identity.provider,
        environment: identity.environment,
        merchantId: identity.merchantId,
        terminalId: identity.terminalId,
      }
    : undefined;
}

function resultFrom(
  value: unknown,
): BookingRequestLifecycleResult | BookingRequestReleaseWork | undefined {
  const result = record(value);
  if (!result || typeof result.status !== "string") return undefined;
  if (
    isBookingRequestStatus(result.status) &&
    typeof result.bookingRequestReference === "string" &&
    bookingRequestReference.test(result.bookingRequestReference)
  ) {
    return {
      status: result.status,
      bookingRequestReference: result.bookingRequestReference,
    };
  }
  if (["access-required", "invalid", "unavailable"].includes(result.status)) {
    return { status: result.status } as BookingRequestLifecycleResult;
  }
  if (
    result.status === "release-required" &&
    typeof result.workId === "string" &&
    uuid.test(result.workId) &&
    typeof result.attemptId === "string" &&
    uuid.test(result.attemptId) &&
    Number.isSafeInteger(result.leaseGeneration) &&
    (result.leaseGeneration as number) > 0 &&
    typeof result.leaseToken === "string" &&
    uuid.test(result.leaseToken) &&
    typeof result.leaseExpiresAt === "string" &&
    !Number.isNaN(Date.parse(result.leaseExpiresAt)) &&
    typeof result.bookingRequestReference === "string" &&
    bookingRequestReference.test(result.bookingRequestReference) &&
    typeof result.paymentLifecycleId === "string" &&
    uuid.test(result.paymentLifecycleId) &&
    Number.isSafeInteger(result.authorizedAmountFils) &&
    (result.authorizedAmountFils as number) > 0
  ) {
    const identity = providerIdentity(result.paymentProviderIdentity);
    const snapshot = result.paymentSnapshot;
    if (
      identity &&
      isAuthorizationPhasePaymentSnapshot(snapshot, {
        paymentLifecycleId: result.paymentLifecycleId,
        bookingPriceFils: record(snapshot)?.bookingPriceFils as number,
        bookingServiceFeeFils: record(snapshot)
          ?.bookingServiceFeeFils as number,
      })
    ) {
      return {
        status: "release-required",
        workId: result.workId,
        attemptId: result.attemptId,
        leaseGeneration: result.leaseGeneration as number,
        leaseToken: result.leaseToken,
        leaseExpiresAt: result.leaseExpiresAt,
        bookingRequestReference: result.bookingRequestReference,
        paymentLifecycleId: result.paymentLifecycleId,
        authorizedAmountFils: result.authorizedAmountFils as number,
        paymentSnapshot: snapshot,
        paymentProviderIdentity: identity,
      };
    }
  }
  return undefined;
}

export class SupabaseBookingRequestLifecycleRepository implements BookingRequestLifecycleRepository {
  constructor(
    private readonly client: SupabaseClient,
    private readonly providerIdentity: PaymentProviderIdentity,
  ) {}

  async claim(input: BookingRequestAction) {
    const { data, error } = await this.client.rpc(
      "claim_booking_request_action",
      {
        target_actor_user_id: input.actorUserId,
        target_booking_request_id: input.bookingRequestId,
        target_action: input.action,
        target_decline_reason:
          input.action === "decline" ? input.declineReason : null,
        target_decline_note:
          input.action === "decline" ? input.declineNote : null,
      },
    );
    const result = resultFrom(data);
    if (error || !result)
      throw new Error("Booking Request action is unavailable");
    return result;
  }

  async claimDue(limit: number) {
    const { data, error } = await this.client.rpc(
      "claim_due_booking_request_releases",
      { target_limit: limit },
    );
    if (error || !Array.isArray(data)) {
      throw new Error("Booking Request expiry processing is unavailable");
    }
    const results = data.map(resultFrom);
    if (results.some((result) => !result)) {
      throw new Error("Booking Request expiry data is invalid");
    }
    return results as (
      | BookingRequestLifecycleResult
      | BookingRequestReleaseWork
    )[];
  }

  async savePaymentSnapshot(
    work: BookingRequestReleaseWork,
    snapshot: PaymentLifecycleSnapshot,
  ) {
    const { data, error } = await this.client.rpc(
      "save_booking_request_release_snapshot",
      {
        target_work_id: work.workId,
        target_lease_generation: work.leaseGeneration,
        target_lease_token: work.leaseToken,
        target_payment_snapshot: snapshot,
        target_provider_identity: this.providerIdentity,
      },
    );
    if (error) throw new Error("Payment release evidence could not be saved");
    if (data === null) return;
    const permit = record(data);
    if (
      !permit ||
      permit.purpose !== "booking-request-release" ||
      permit.workId !== work.workId ||
      permit.leaseGeneration !== work.leaseGeneration ||
      permit.leaseToken !== work.leaseToken ||
      typeof permit.operationId !== "string" ||
      !uuid.test(permit.operationId) ||
      !Number.isSafeInteger(permit.operationGeneration) ||
      (permit.operationGeneration as number) < 1 ||
      typeof permit.idempotencyKey !== "string" ||
      typeof permit.requestFingerprint !== "string" ||
      !/^[0-9a-f]{64}$/.test(permit.requestFingerprint) ||
      typeof permit.notAfter !== "string" ||
      Number.isNaN(Date.parse(permit.notAfter))
    ) {
      throw new Error("Payment release permit is invalid");
    }
    return permit as unknown as ProviderExecutionPermit;
  }

  async finalize(work: BookingRequestReleaseWork) {
    const { data, error } = await this.client.rpc(
      "finalize_booking_request_release",
      {
        target_work_id: work.workId,
        target_lease_generation: work.leaseGeneration,
        target_lease_token: work.leaseToken,
      },
    );
    const result = resultFrom(data);
    if (error || !result || result.status === "release-required") {
      throw new Error("Booking Request release could not be finalized");
    }
    return result;
  }
}
