import { bookingEventNotice } from "./booking-event-notice";
import { describe, expect, it, vi } from "vitest";
import { SupabaseNotificationDeliveryRepository } from "./supabase-notification-delivery";

const validLease = {
  receiptId: "00000000-0000-4000-8000-000000000035",
  recipientUserId: "00000000-0000-4000-8000-000000000036",
  recipientRole: "customer",
  bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
  bookingReference: "CONFIRMED-BOOKING-35",
  locale: "en",
  logicalId: "paid-confirmation:00000000-0000-4000-8000-000000000035",
  templateVersion: "paid-confirmation-v1",
  payload: {
    kind: "paid-confirmation",
    title: "Booking confirmed",
    body: "Your booking CONFIRMED-BOOKING-35 is confirmed and paid.",
    bookingReference: "CONFIRMED-BOOKING-35",
    detailsPath: "/en/booking-requests/RC-REQ-AAAAAAAAAAAAAAAA",
    linkLabel: "View confirmed booking",
    fictional: true,
  },
  payloadSha256: "a".repeat(64),
  leaseGeneration: 1,
  leaseToken: "00000000-0000-4000-8000-000000000037",
  leaseExpiresAt: "2099-01-01T00:05:00Z",
};

async function leaseFrom(data: unknown) {
  const rpc = vi.fn().mockResolvedValue({ data, error: null });
  return new SupabaseNotificationDeliveryRepository({ rpc } as never).lease(
    validLease.receiptId,
  );
}

describe("Supabase notification delivery repository", () => {
  it("accepts the complete frozen lease binding", async () => {
    await expect(leaseFrom(validLease)).resolves.toEqual(validLease);
  });

  it.each([
    { payload: { ...validLease.payload, title: "" } },
    { payload: { ...validLease.payload, unexpected: "field" } },
    {
      payload: {
        ...validLease.payload,
        bookingReference: "A-DIFFERENT-BOOKING",
      },
    },
    { payload: { ...validLease.payload, detailsPath: "/en/bookings" } },
    { payloadSha256: "not-a-sha256" },
  ])("rejects an incomplete or conflicting frozen lease %#", async (change) => {
    await expect(leaseFrom({ ...validLease, ...change })).rejects.toThrow(
      "invalid notification lease",
    );
  });
});

describe("event notification binding", () => {
  const event = {
    id: "00000000-0000-4000-8000-000000000081",
    kind: "refund_requested" as const,
    allocation: { bookingPriceFils: 30000000, bookingServiceFeeFils: 1000000 },
  };
  const eventLease = {
    ...validLease,
    event,
    logicalId: `booking-event:${event.id}`,
    templateVersion: "booking-event-v1",
    payload: bookingEventNotice({
      ...validLease,
      locale: "en",
      recipientRole: "customer",
      event,
    }),
  };
  const read = async (data: unknown, eventId = event.id) => {
    const rpc = vi.fn().mockResolvedValue({ data, error: null });
    const repository = new SupabaseNotificationDeliveryRepository({
      rpc,
    } as never);
    const lease = await repository.lease(validLease.receiptId, eventId);
    expect(rpc).toHaveBeenCalledWith(
      "lease_booking_confirmation_notification_work",
      { target_receipt_id: validLease.receiptId, target_event_id: eventId },
    );
    return lease;
  };
  it("accepts the separately bound event for an existing receipt", async () => {
    await expect(read(eventLease)).resolves.toEqual(eventLease);
  });
  it.each([
    { event: { ...event, id: "00000000-0000-4000-8000-000000000082" } },
    { locale: "ar" },
    { payload: { ...eventLease.payload, title: "PRIVATE reason" } },
    {
      payload: {
        ...eventLease.payload,
        allocation: { bookingPriceFils: 31000000, bookingServiceFeeFils: 0 },
      },
    },
    { payload: { ...eventLease.payload, administratorReason: "PRIVATE" } },
  ])(
    "rejects changed event, locale, allocation or private payload %#",
    async (change) => {
      await expect(read({ ...eventLease, ...change })).rejects.toThrow(
        "invalid notification",
      );
    },
  );
  it("passes event identity to preparation without changing the receipt", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    await new SupabaseNotificationDeliveryRepository({ rpc } as never).prepare(
      eventLease as never,
    );
    expect(rpc).toHaveBeenCalledWith(
      "ensure_booking_confirmation_notification_work",
      {
        target_receipt_id: validLease.receiptId,
        target_event_id: event.id,
        target_locale: "en",
        target_template: "booking-event-v1",
        target_payload: eventLease.payload,
      },
    );
  });
});
