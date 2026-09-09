import { recordedPaymentResult } from "@/payment/payment-operation-execution";
import type { PaymentOperationExecution } from "@/payment/payment-operation-execution";
import type {
  BookingRequestCaptureExecutionPermit,
  BookingRequestCaptureSnapshot,
  PaymentProviderAdapter,
  PaymentProviderIdentity,
  ProviderOperationResult,
} from "@/payment/payment-contract";

export type BookingRequestCaptureResult =
  | { readonly status: "processing" | "expired" | "unavailable" }
  | {
      readonly status: "payment-required";
      readonly window: BookingRequestPaymentRequiredWindow;
    }
  | {
      readonly status: "complete";
      readonly snapshot: BookingRequestCaptureSnapshot;
    };

export type BookingRequestCaptureLeasedWork = {
  readonly status: "leased";
  readonly permit: BookingRequestCaptureExecutionPermit;
};

export type BookingRequestPaymentRequiredWindow = {
  readonly recordedAt: string;
  readonly deadline: string;
};

export interface BookingRequestCaptureRepository {
  lease(
    bookingRequestId: string,
    providerIdentity: PaymentProviderIdentity,
  ): Promise<BookingRequestCaptureResult | BookingRequestCaptureLeasedWork>;
  complete(
    permit: BookingRequestCaptureExecutionPermit,
    result: Extract<ProviderOperationResult, { outcome: "succeeded" }>,
  ): Promise<Extract<BookingRequestCaptureResult, { status: "complete" }>>;
  recordFailure(
    permit: BookingRequestCaptureExecutionPermit,
    result: Extract<ProviderOperationResult, { outcome: "failed" }>,
  ): Promise<
    Extract<BookingRequestCaptureResult, { status: "payment-required" }>
  >;
}

export interface BookingRequestCapture {
  execute(bookingRequestId: string): Promise<BookingRequestCaptureResult>;
}

export function createBookingRequestCapture({
  repository,
  operations,
  provider,
}: {
  repository: BookingRequestCaptureRepository;
  provider: PaymentProviderAdapter;
  operations: PaymentOperationExecution;
}): BookingRequestCapture {
  return {
    async execute(bookingRequestId) {
      const work = await repository.lease(bookingRequestId, provider.identity);
      if (work.status !== "leased") return work;
      const { permit } = work;
      if (
        permit.bookingRequestId !== bookingRequestId ||
        permit.workId !== bookingRequestId ||
        permit.providerIdentity.provider !== provider.identity.provider ||
        permit.providerIdentity.environment !== provider.identity.environment ||
        permit.providerIdentity.merchantId !== provider.identity.merchantId ||
        permit.providerIdentity.terminalId !== provider.identity.terminalId
      ) {
        throw new Error(
          "Capture permit does not match the Booking Request or provider",
        );
      }
      const result = recordedPaymentResult(
        await operations.execute({
          kind: "capture",
          paymentLifecycleId: permit.paymentLifecycleId,
          logicalOperationId: permit.captureLogicalOperationId,
          attemptId: permit.capturePhysicalAttemptId,
          amountFils: permit.amountFils,
          currency: permit.currency,
          executionPermit: permit,
        }),
      );
      if (result.outcome === "failed") {
        return repository.recordFailure(permit, result);
      }
      if (result.outcome !== "succeeded") {
        throw new Error(
          "Booking Request Capture did not return successful provider evidence",
        );
      }
      return repository.complete(permit, result);
    },
  };
}
