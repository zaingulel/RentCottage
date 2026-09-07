import type {
  PaymentProviderAdapter,
  ProviderOperationBinding,
} from "@/payment/payment-contract";
import type { BookingRequestPaymentRecoveryPermit } from "@/payment/booking-request-payment-recovery-contract";

export type PaymentRecoveryStatus =
  | "processing"
  | "retryable"
  | "succeeded"
  | "late-succeeded"
  | "deadline-elapsed"
  | "blocked"
  | "unavailable";
export type PaymentRecoveryAdmission = {
  readonly status: "processing" | "retryable" | "succeeded" | "late-succeeded";
  readonly attemptId: string;
  readonly deadline: string;
};
export type PaymentRecoveryLease =
  | { readonly status: Exclude<PaymentRecoveryStatus, "processing"> }
  | {
      readonly status: "leased";
      readonly permit: BookingRequestPaymentRecoveryPermit;
      readonly binding: ProviderOperationBinding;
    }
  | {
      readonly status: "reconcile";
      readonly permit: BookingRequestPaymentRecoveryPermit;
      readonly binding: ProviderOperationBinding;
      readonly providerRequestId: string;
      readonly providerReference: string;
    };
export interface BookingRequestPaymentRecoveryRepository {
  admit(input: {
    readonly bookingRequestId: string;
    readonly commandKey: string;
  }): Promise<PaymentRecoveryAdmission>;
  lease(attemptId: string): Promise<PaymentRecoveryLease>;
  finalize(attemptId: string): Promise<void>;
  due(limit: number): Promise<readonly string[]>;
}
export function createBookingRequestPaymentRecovery({
  repository,
  provider,
}: {
  repository: BookingRequestPaymentRecoveryRepository;
  provider: PaymentProviderAdapter;
}) {
  async function resume(
    attemptId: string,
  ): Promise<{ readonly status: PaymentRecoveryStatus }> {
    for (let step = 0; step < 5; step += 1) {
      const leased = await repository.lease(attemptId);
      if (leased.status !== "leased" && leased.status !== "reconcile") {
        if (leased.status === "succeeded") await repository.finalize(attemptId);
        return { status: leased.status };
      }
      const outcome =
        leased.status === "reconcile"
          ? await provider.query({
              ...leased.binding,
              recoveryPermit: leased.permit,
              providerRequestId: leased.providerRequestId,
              providerReference: leased.providerReference,
            })
          : await provider.execute({
              ...leased.binding,
              executionPermit: leased.permit,
            });
      if (
        outcome.outcome === "not-executed" ||
        outcome.outcome === "indeterminate"
      )
        return { status: "blocked" };
    }
    return { status: "unavailable" };
  }
  return {
    async execute(input: {
      readonly bookingRequestId: string;
      readonly commandKey: string;
    }) {
      const admitted = await repository.admit(input);
      if (
        admitted.status === "retryable" ||
        admitted.status === "late-succeeded"
      )
        return { status: admitted.status };
      return resume(admitted.attemptId);
    },
    resume,
    async processDue(limit: number) {
      const results: { readonly status: PaymentRecoveryStatus }[] = [];
      for (const attemptId of await repository.due(limit)) {
        try {
          results.push(await resume(attemptId));
        } catch {
          results.push({ status: "unavailable" });
        }
      }
      return results;
    },
  };
}
