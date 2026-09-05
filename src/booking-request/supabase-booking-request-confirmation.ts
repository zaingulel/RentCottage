import type { SupabaseClient } from "@supabase/supabase-js";

import type { BookingRequestCaptureSnapshot } from "@/payment/payment-contract";

import type {
  BookingConfirmationReceipt,
  BookingRequestConfirmationRepository,
  BookingRequestConfirmationResult,
} from "./booking-request-confirmation";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return (
    Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuid.test(value);
}

function receipt(value: unknown): BookingConfirmationReceipt | undefined {
  const candidate = record(value);
  if (
    !candidate ||
    !exactKeys(candidate, ["id", "recipientId"]) ||
    !isUuid(candidate.id) ||
    !isUuid(candidate.recipientId)
  ) {
    return undefined;
  }
  return { id: candidate.id, recipientId: candidate.recipientId };
}

function confirmationFrom(
  value: unknown,
  bookingRequestId: string,
  captureSnapshot: BookingRequestCaptureSnapshot,
): BookingRequestConfirmationResult {
  const candidate = record(value);
  const receipts = record(candidate?.receipts);
  const customer = receipt(receipts?.customer);
  const cottageOwner = receipt(receipts?.cottageOwner);
  if (
    !candidate ||
    !exactKeys(candidate, [
      "bookingRequestId",
      "commitmentId",
      "bookingReference",
      "confirmedAt",
      "capturePhysicalAttemptId",
      "captureMovementReference",
      "receipts",
    ]) ||
    candidate.bookingRequestId !== bookingRequestId ||
    !isUuid(candidate.bookingRequestId) ||
    !isUuid(candidate.commitmentId) ||
    typeof candidate.bookingReference !== "string" ||
    candidate.bookingReference.length === 0 ||
    typeof candidate.confirmedAt !== "string" ||
    Number.isNaN(Date.parse(candidate.confirmedAt)) ||
    candidate.capturePhysicalAttemptId !==
      captureSnapshot.capturePhysicalAttemptId ||
    candidate.captureMovementReference !==
      captureSnapshot.capture.movementReference ||
    !receipts ||
    !exactKeys(receipts, ["customer", "cottageOwner"]) ||
    !customer ||
    !cottageOwner ||
    customer.id === cottageOwner.id
  ) {
    throw new Error("Database returned an invalid confirmation outcome");
  }
  return {
    bookingRequestId: candidate.bookingRequestId,
    commitmentId: candidate.commitmentId,
    bookingReference: candidate.bookingReference,
    confirmedAt: candidate.confirmedAt,
    capturePhysicalAttemptId: candidate.capturePhysicalAttemptId as string,
    captureMovementReference: candidate.captureMovementReference as string,
    receipts: { customer, cottageOwner },
  };
}

export class SupabaseBookingRequestConfirmationRepository implements BookingRequestConfirmationRepository {
  constructor(private readonly client: SupabaseClient) {}

  async finalize(
    bookingRequestId: string,
    captureSnapshot: BookingRequestCaptureSnapshot,
  ): Promise<BookingRequestConfirmationResult> {
    const { data, error } = await this.client.rpc(
      "finalize_booking_request_confirmation",
      {
        target_booking_request_id: bookingRequestId,
        target_capture_snapshot: captureSnapshot,
      },
    );
    if (error) throw new Error("Booking Request confirmation is unavailable");
    return confirmationFrom(data, bookingRequestId, captureSnapshot);
  }
}
