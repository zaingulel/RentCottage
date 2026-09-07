import type { BookingRequestCaptureSnapshot } from "@/payment/payment-contract";

export type BookingRequestRecoveryConfirmationEvidence = {
  readonly purpose: "booking-request-payment-recovery";
  readonly bookingRequestId: string;
  readonly recoveryAttemptId: string;
  readonly capturePhysicalAttemptId: string;
  readonly capture: { readonly movementReference: string };
};
export type BookingRequestConfirmationEvidence =
  | BookingRequestCaptureSnapshot
  | BookingRequestRecoveryConfirmationEvidence;

export type BookingConfirmationReceipt = {
  readonly id: string;
  readonly recipientId: string;
};

export type BookingRequestConfirmationResult = {
  readonly bookingRequestId: string;
  readonly commitmentId: string;
  readonly bookingReference: string;
  readonly confirmedAt: string;
  readonly capturePhysicalAttemptId: string;
  readonly captureMovementReference: string;
  readonly receipts: {
    readonly customer: BookingConfirmationReceipt;
    readonly cottageOwner: BookingConfirmationReceipt;
  };
};

export interface BookingRequestConfirmationRepository {
  finalize(
    bookingRequestId: string,
    captureSnapshot: BookingRequestConfirmationEvidence,
  ): Promise<BookingRequestConfirmationResult>;
}

export interface BookingRequestConfirmation {
  execute(
    bookingRequestId: string,
    captureSnapshot: BookingRequestConfirmationEvidence,
  ): Promise<BookingRequestConfirmationResult>;
}

export function createBookingRequestConfirmation({
  repository,
}: {
  repository: BookingRequestConfirmationRepository;
}): BookingRequestConfirmation {
  return {
    async execute(bookingRequestId, captureSnapshot) {
      if (captureSnapshot.bookingRequestId !== bookingRequestId) {
        throw new Error(
          "Capture evidence does not match the Booking Request being confirmed",
        );
      }
      return repository.finalize(bookingRequestId, captureSnapshot);
    },
  };
}
