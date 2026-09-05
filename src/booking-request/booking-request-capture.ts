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
      readonly status: "complete";
      readonly snapshot: BookingRequestCaptureSnapshot;
    };

export type BookingRequestCaptureLeasedWork = {
  readonly status: "leased";
  readonly permit: BookingRequestCaptureExecutionPermit;
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
}

export interface BookingRequestCapture {
  execute(bookingRequestId: string): Promise<BookingRequestCaptureResult>;
}

export function createBookingRequestCapture({
  repository,
  provider,
}: {
  repository: BookingRequestCaptureRepository;
  provider: PaymentProviderAdapter;
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
      const result = await provider.execute({
        kind: "capture",
        paymentLifecycleId: permit.paymentLifecycleId,
        logicalOperationId: permit.captureLogicalOperationId,
        attemptId: permit.capturePhysicalAttemptId,
        amountFils: permit.amountFils,
        currency: permit.currency,
        executionPermit: permit,
      });
      if (result.outcome !== "succeeded") {
        throw new Error(
          "Booking Request Capture did not return successful provider evidence",
        );
      }
      return repository.complete(permit, result);
    },
  };
}
