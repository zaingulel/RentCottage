import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { BookingRequestCaptureSnapshot } from "@/payment/payment-contract";

import { SupabaseBookingRequestConfirmationRepository } from "./supabase-booking-request-confirmation";

const bookingRequestId = "11111111-1111-4111-8111-111111111111";
const snapshot = {
  bookingRequestId,
  capturePhysicalAttemptId:
    "44444444-4444-4444-8444-444444444444:capture:attempt-2",
  capture: { movementReference: "capture-movement" },
} as BookingRequestCaptureSnapshot;
const response = {
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
};

function setup(data: unknown = response, error: unknown = null) {
  const rpc = vi.fn(async () => ({ data, error }));
  const repository = new SupabaseBookingRequestConfirmationRepository({
    rpc,
  } as unknown as SupabaseClient);
  return { repository, rpc };
}

describe("Supabase Booking Request confirmation repository", () => {
  it("passes the complete Capture snapshot and returns its bound persisted outcome", async () => {
    const { repository, rpc } = setup();

    await expect(
      repository.finalize(bookingRequestId, snapshot),
    ).resolves.toEqual(response);
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "finalize_booking_request_confirmation",
      {
        target_booking_request_id: bookingRequestId,
        target_capture_snapshot: snapshot,
      },
    );
  });

  it.each([
    [
      "another request",
      { bookingRequestId: "99999999-9999-4999-8999-999999999999" },
    ],
    [
      "another Capture identity",
      { capturePhysicalAttemptId: "replaced:capture:attempt-2" },
    ],
    [
      "another Capture movement",
      { captureMovementReference: "replaced-movement" },
    ],
  ])("rejects a well-shaped response for %s", async (_label, replacement) => {
    const { repository } = setup({ ...response, ...replacement });

    await expect(
      repository.finalize(bookingRequestId, snapshot),
    ).rejects.toThrow("invalid confirmation outcome");
  });

  it("rejects missing or malformed persisted receipt identities", async () => {
    const { repository } = setup({
      ...response,
      receipts: {
        customer: response.receipts.customer,
        cottageOwner: {
          ...response.receipts.cottageOwner,
          recipientId: "wrong",
        },
      },
    });

    await expect(
      repository.finalize(bookingRequestId, snapshot),
    ).rejects.toThrow("invalid confirmation outcome");
  });

  it("fails loudly when finalization is unavailable", async () => {
    const { repository } = setup(null, { message: "unavailable" });

    await expect(
      repository.finalize(bookingRequestId, snapshot),
    ).rejects.toThrow("confirmation is unavailable");
  });
});

it("passes distinct replacement evidence through the same confirmation boundary and binds the returned movement", async () => {
  const recoveryAttemptId = "44444444-4444-4444-8444-444444444444";
  const evidence = {
    bookingRequestId,
    purpose: "booking-request-payment-recovery" as const,
    recoveryAttemptId,
    capturePhysicalAttemptId: `${recoveryAttemptId}:replacement-capture:1`,
    capture: { movementReference: "replacement-movement" },
  };
  const outcome = {
    ...response,
    capturePhysicalAttemptId: evidence.capturePhysicalAttemptId,
    captureMovementReference: evidence.capture.movementReference,
  };
  const { repository, rpc } = setup(outcome);
  await expect(
    repository.finalize(bookingRequestId, evidence),
  ).resolves.toEqual(outcome);
  expect(rpc).toHaveBeenCalledExactlyOnceWith(
    "finalize_booking_request_confirmation",
    {
      target_booking_request_id: bookingRequestId,
      target_capture_snapshot: evidence,
    },
  );
  await expect(
    setup({
      ...outcome,
      captureMovementReference: "unrelated-movement",
    }).repository.finalize(bookingRequestId, evidence),
  ).rejects.toThrow("invalid confirmation outcome");
});
