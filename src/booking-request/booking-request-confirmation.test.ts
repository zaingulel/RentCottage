import { describe, expect, it, vi } from "vitest";

import type { BookingRequestCaptureSnapshot } from "@/payment/payment-contract";

import {
  createBookingRequestConfirmation,
  type BookingRequestConfirmationRepository,
} from "./booking-request-confirmation";

const bookingRequestId = "11111111-1111-4111-8111-111111111111";
const snapshot = {
  bookingRequestId,
  capturePhysicalAttemptId:
    "44444444-4444-4444-8444-444444444444:capture:attempt-2",
  capture: { movementReference: "capture-movement" },
} as BookingRequestCaptureSnapshot;
const confirmation = {
  bookingRequestId,
  commitmentId: "22222222-2222-4222-8222-222222222222",
  bookingReference: "RC-HOLD-ABC123",
  confirmedAt: "2099-01-01T00:00:02.000Z",
  capturePhysicalAttemptId: snapshot.capturePhysicalAttemptId,
  captureMovementReference: snapshot.capture.movementReference,
  receipts: {
    customer: {
      id: "33333333-3333-4333-8333-333333333333",
      recipientId: "55555555-5555-4555-8555-555555555555",
    },
    cottageOwner: {
      id: "66666666-6666-4666-8666-666666666666",
      recipientId: "77777777-7777-4777-8777-777777777777",
    },
  },
} as const;

describe("Booking Request confirmation", () => {
  it("finalizes the exact Booking Request from its completed Capture snapshot", async () => {
    const repository = {
      finalize: vi.fn<BookingRequestConfirmationRepository["finalize"]>(
        async () => confirmation,
      ),
    };
    const service = createBookingRequestConfirmation({ repository });

    await expect(service.execute(bookingRequestId, snapshot)).resolves.toBe(
      confirmation,
    );
    expect(repository.finalize).toHaveBeenCalledExactlyOnceWith(
      bookingRequestId,
      snapshot,
    );
  });

  it("rejects Capture evidence for another Booking Request before persistence", async () => {
    const repository = {
      finalize: vi.fn<BookingRequestConfirmationRepository["finalize"]>(),
    };
    const service = createBookingRequestConfirmation({ repository });

    await expect(
      service.execute("99999999-9999-4999-8999-999999999999", snapshot),
    ).rejects.toThrow("does not match");
    expect(repository.finalize).not.toHaveBeenCalled();
  });
});
