import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { listOwnerBookingRequestNotifications } from "./owner-booking-request-notifications";

const notification = {
  bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
  status: "pending",
  customerName: "Ava Hassan",
  partySize: 4,
  bookingNote: "Garden seating, please.",
  cottageName: "Quiet Garden",
  bookingPeriod: [
    {
      serviceDay: "2099-08-21",
      kind: "shift",
      position: 2,
      displayName: "Evening",
      startsAt: "2099-08-21T20:00:00+03:00",
      endsAt: "2099-08-21T23:00:00+03:00",
      crossesMidnight: false,
      priceIqd: 100_003,
    },
  ],
  responseDeadline: "2099-08-21T21:00:00.000Z",
  createdAt: "2099-08-21T17:00:00.000Z",
};

describe("Owner Booking Request notifications", () => {
  it("loads the complete minimal owner projection", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: [notification], error: null });

    await expect(
      listOwnerBookingRequestNotifications({
        rpc,
      } as unknown as SupabaseClient),
    ).resolves.toEqual([notification]);
    expect(rpc).toHaveBeenCalledWith(
      "list_owner_booking_request_notifications",
    );
  });

  it("fails closed if provider or contact metadata leaks into the projection", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ ...notification, customerPhone: "+9647000000000" }],
      error: null,
    });

    await expect(
      listOwnerBookingRequestNotifications({
        rpc,
      } as unknown as SupabaseClient),
    ).rejects.toThrow("data is invalid");
  });

  it.each([
    { customerName: "name @ example . com" },
    { customerName: "name @ example . uk" },
    { bookingNote: "Email name at example dot uk" },
    { bookingNote: "Visit example.dev" },
    { bookingNote: "Call 0a7a5a0a1a2a3a4a5a6" },
    { bookingNote: "Call 0a7b5c0d1e2f3g4h5i6" },
  ])(
    "fails closed if contact-bearing content reaches the owner projection",
    async (unsafe) => {
      const rpc = vi.fn().mockResolvedValue({
        data: [{ ...notification, ...unsafe }],
        error: null,
      });

      await expect(
        listOwnerBookingRequestNotifications({
          rpc,
        } as unknown as SupabaseClient),
      ).rejects.toThrow("data is invalid");
    },
  );
});
