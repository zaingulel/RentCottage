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
  it("accepts an exact preparation reminder without a refund allocation", async () => {
    const reminder = {
      id: "00000000-0000-4000-8000-000000000083",
      kind: "preparation_reminder" as const,
      dueAt: "2100-12-31T21:30:00Z",
      firstStartsAt: "2101-01-01T21:30:00Z",
    };
    const reminderLease = {
      ...validLease,
      event: reminder,
      logicalId: `booking-event:${reminder.id}`,
      templateVersion: "booking-event-v1",
      payload: bookingEventNotice({
        ...validLease,
        locale: "en" as const,
        recipientRole: "customer" as const,
        event: reminder,
      }),
    };
    await expect(read(reminderLease, reminder.id)).resolves.toEqual(
      reminderLease,
    );
    await expect(
      read(
        {
          ...reminderLease,
          event: {
            ...reminder,
            dueAt: "2100-12-31T22:30:00Z",
          },
        },
        reminder.id,
      ),
    ).rejects.toThrow("invalid notification event");
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

describe("receiptless request notice binding", () => {
  const candidate = {
    receiptId: null,
    bookingReference: null,
    recipientUserId: "10000000-0000-4000-8000-000000001001",
    recipientRole: "cottage_owner" as const,
    bookingRequestReference: "RC-REQ-0000000000001001",
    locale: "ar" as const,
    event: {
      id: "00000000-0000-4000-8000-000000000228",
      sourceId: "00000000-0000-4000-8000-000000000229",
      kind: "request_new" as const,
      deadlineAt: "2101-01-01T08:00:00+00:00",
    },
  };
  it("parses the selected source, role and language without a paid reference", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [candidate], error: null });
    await expect(
      new SupabaseNotificationDeliveryRepository({
        rpc,
      } as never).listCandidates(10),
    ).resolves.toEqual([candidate]);
  });
  it.each([
    {
      ...candidate,
      receiptId: "00000000-0000-4000-8000-000000000230",
      bookingReference: "paid",
    },
    { ...candidate, recipientRole: "customer" },
    { ...candidate, event: { ...candidate.event, sourceId: null } },
    { ...candidate, event: { ...candidate.event, deadlineAt: null } },
    { ...candidate, event: { ...candidate.event, phone: "private" } },
  ])("rejects mismatched source/recipient/privacy %#", async (value) => {
    const rpc = vi.fn().mockResolvedValue({ data: [value], error: null });
    await expect(
      new SupabaseNotificationDeliveryRepository({
        rpc,
      } as never).listCandidates(10),
    ).rejects.toThrow(/invalid/);
  });
});
