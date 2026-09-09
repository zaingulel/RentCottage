import { recordedPaymentResult } from "@/payment/payment-operation-execution";
import type { PaymentOperationExecution } from "@/payment/payment-operation-execution";
import type { BookingRequestPaymentRecoveryPermit } from "@/payment/booking-request-payment-recovery-contract";
import type { BookingRequestPaymentRequiredExpiryPermit } from "@/payment/booking-request-payment-required-expiry-contract";
import type {
  PaymentProviderAdapter,
  PaymentProviderIdentity,
  ProviderOperationBinding,
} from "@/payment/payment-contract";

export type PaymentRequiredExpiryResult = {
  readonly status:
    | "processing"
    | "attention-required"
    | "quarantined"
    | "expired"
    | "confirmed"
    | "not-due"
    | "unavailable"
    | "invalid";
};
export type PaymentRequiredExpiryPreparation =
  | PaymentRequiredExpiryResult
  | { readonly status: "ready" }
  | {
      readonly status: "release";
      readonly permit: BookingRequestPaymentRequiredExpiryPermit;
      readonly binding: ProviderOperationBinding;
    }
  | {
      readonly status: "refund";
      readonly permit: BookingRequestPaymentRequiredExpiryPermit;
      readonly binding: ProviderOperationBinding;
    }
  | {
      readonly status: "reconcile-expiry";
      readonly permit: BookingRequestPaymentRequiredExpiryPermit;
      readonly binding: ProviderOperationBinding;
      readonly providerRequestId: string | null;
      readonly providerReference: string | null;
    }
  | {
      readonly status: "reconcile-recovery";
      readonly permit: BookingRequestPaymentRecoveryPermit;
      readonly binding: ProviderOperationBinding;
      readonly providerRequestId: string | null;
      readonly providerReference: string | null;
    };

export interface BookingRequestPaymentRequiredExpiryRepository {
  due(
    limit: number,
    providerIdentity: PaymentProviderIdentity,
  ): Promise<readonly string[]>;
  prepare(
    bookingRequestId: string,
    providerIdentity: PaymentProviderIdentity,
  ): Promise<PaymentRequiredExpiryPreparation>;
  finalize(bookingRequestId: string): Promise<PaymentRequiredExpiryResult>;
}

export function createBookingRequestPaymentRequiredExpiry({
  repository,
  operations,
  provider,
}: {
  repository: BookingRequestPaymentRequiredExpiryRepository;
  provider: PaymentProviderAdapter;
  operations: PaymentOperationExecution;
}) {
  return {
    async processDue(
      limit: number,
    ): Promise<readonly PaymentRequiredExpiryResult[]> {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
        return [{ status: "invalid" }];
      let due: readonly string[];
      try {
        due = await repository.due(limit, provider.identity);
      } catch {
        return [{ status: "unavailable" }];
      }
      const results: PaymentRequiredExpiryResult[] = [];
      for (const bookingRequestId of due) {
        try {
          const preparation = await repository.prepare(
            bookingRequestId,
            provider.identity,
          );
          if (
            preparation.status === "release" ||
            preparation.status === "refund" ||
            preparation.status === "reconcile-expiry" ||
            preparation.status === "reconcile-recovery"
          ) {
            const execution =
              preparation.status === "release" ||
              preparation.status === "refund"
                ? await operations.execute({
                    ...preparation.binding,
                    executionPermit: preparation.permit,
                  })
                : await operations.query({
                    ...preparation.binding,
                    ...(preparation.status === "reconcile-expiry"
                      ? { expiryPermit: preparation.permit }
                      : { recoveryPermit: preparation.permit }),
                    providerRequestId: preparation.providerRequestId,
                    providerReference: preparation.providerReference,
                  });
            if (execution.status !== "not-admitted")
              recordedPaymentResult(execution);
            results.push(await repository.finalize(bookingRequestId));
          } else if (preparation.status === "ready") {
            results.push(await repository.finalize(bookingRequestId));
          } else results.push(preparation);
        } catch {
          results.push({ status: "unavailable" });
        }
      }
      return results;
    },
  };
}
