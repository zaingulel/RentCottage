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
