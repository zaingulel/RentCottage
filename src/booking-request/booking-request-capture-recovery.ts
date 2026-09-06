import type {
  BookingRequestCapturePermitExpectation,
  BookingRequestCaptureProviderResultIdentity,
  PaymentProviderAdapter,
  PaymentProviderIdentity,
  ProviderOperationResult,
} from "@/payment/payment-contract";
import type { BookingRequestCaptureResult } from "./booking-request-capture";
import type {
  BookingRequestConfirmation,
  BookingRequestConfirmationResult,
} from "./booking-request-confirmation";

export type BookingRequestCaptureRecoveryLease =
  BookingRequestCapturePermitExpectation & {
    readonly recoveryOperationId: string;
    readonly providerResult: BookingRequestCaptureProviderResultIdentity;
  };
export type BookingRequestCaptureRecoveryWork =
  | {
      readonly status: "reconcile";
      readonly lease: BookingRequestCaptureRecoveryLease;
    }
  | Extract<BookingRequestCaptureResult, { status: "complete" }>
  | { readonly status: "unavailable" };
export interface BookingRequestCaptureRecoveryRepository {
  claimDue(
    limit: number,
    providerIdentity: PaymentProviderIdentity,
  ): Promise<readonly BookingRequestCaptureRecoveryWork[]>;
  complete(
    lease: BookingRequestCapturePermitExpectation,
    result: Extract<ProviderOperationResult, { outcome: "succeeded" }>,
  ): Promise<Extract<BookingRequestCaptureResult, { status: "complete" }>>;
}
export type BookingRequestCaptureRecoveryResult =
  | { readonly status: "invalid" | "processing" | "unavailable" }
  | {
      readonly status: "confirmed";
      readonly confirmation: BookingRequestConfirmationResult;
    };

export function createBookingRequestCaptureRecovery({
  repository,
  provider,
  confirmation,
}: {
  repository: BookingRequestCaptureRecoveryRepository;
  provider: PaymentProviderAdapter;
  confirmation: BookingRequestConfirmation;
}) {
  return {
    async processDue(
      limit = 20,
    ): Promise<readonly BookingRequestCaptureRecoveryResult[]> {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
        return [{ status: "invalid" }];
      const results: BookingRequestCaptureRecoveryResult[] = [];
      for (const work of await repository.claimDue(limit, provider.identity)) {
        if (work.status === "unavailable") {
          results.push(work);
          continue;
        }
        let completed;
        if (work.status === "reconcile") {
          const { lease } = work;
          if (
            Object.entries(provider.identity).some(
              ([key, value]) =>
                lease.providerIdentity[key as keyof PaymentProviderIdentity] !==
                value,
            )
          )
            throw new Error("Capture recovery provider does not match");
          const result = await provider.query({
            kind: "capture",
            paymentLifecycleId: lease.paymentLifecycleId,
            logicalOperationId: lease.captureLogicalOperationId,
            attemptId: lease.capturePhysicalAttemptId,
            amountFils: lease.amountFils,
            currency: lease.currency,
            providerRequestId: lease.providerResult.providerRequestId,
            providerReference: lease.providerResult.providerReference,
          });
          if (result.outcome === "indeterminate") {
            results.push({ status: "processing" });
            continue;
          }
          if (result.outcome !== "succeeded")
            throw new Error(
              "Capture recovery did not return successful provider evidence",
            );
          if (
            Object.entries(lease.providerResult).some(
              ([key, value]) =>
                result[
                  key as keyof BookingRequestCaptureProviderResultIdentity
                ] !== value,
            )
          )
            throw new Error(
              "Capture recovery provider evidence does not match",
            );
          completed = await repository.complete(lease, result);
        } else completed = work;
        results.push({
          status: "confirmed",
          confirmation: await confirmation.execute(
            completed.snapshot.bookingRequestId,
            completed.snapshot,
          ),
        });
      }
      return results;
    },
  };
}
