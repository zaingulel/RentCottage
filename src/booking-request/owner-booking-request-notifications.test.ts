import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { listOwnerBookingRequestNotifications } from "./owner-booking-request-notifications";

const notification = {
  id: "00000000-0000-4000-8000-000000000033",
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
  bookingPriceIqd: 100_003,
  marketplaceCommissionFils: 10_000_300,
  ownerNetFils: 90_002_700,
  houseRules: "No smoking",
  bookingTermsVersion: "rentcottage-mvp-2026-08-04",
  cancellationPolicyVersion: "rentcottage-cancellation-2026-08-04",
  statusNotifications: [],
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
    { id: "not-a-uuid" },
    {
      statusNotifications: [
        {
          id: "not-a-uuid",
          status: "accepted",
          createdAt: "2099-08-21T18:00:00.000Z",
        },
      ],
    },
  ])("fails closed on malformed owner projection UUIDs %#", async (invalid) => {
    await expect(
      listOwnerBookingRequestNotifications(
        clientReturning([{ ...notification, ...invalid }]),
      ),
    ).rejects.toThrow("data is invalid");
  });

  it("allocates exact booking item and receipt projections", async () => {
    const raw = {
      ...notification,
      bookingPeriod: [
        { ...notification.bookingPeriod[0], privateUnitId: "private-unit" },
      ],
      statusNotifications: [
        {
          id: "00000000-0000-4000-8000-000000000034",
          status: "accepted",
          createdAt: "2099-08-21T18:00:00.000Z",
          recipientUserId: "private-recipient",
          paymentProviderReference: "private-provider-reference",
        },
      ],
    };
    const expected = {
      ...notification,
      statusNotifications: [
        {
          id: "00000000-0000-4000-8000-000000000034",
          status: "accepted",
          createdAt: "2099-08-21T18:00:00.000Z",
        },
      ],
    };

    const result = await listOwnerBookingRequestNotifications(
      clientReturning([raw]),
    );

    expect(result).toEqual([expected]);
    expect(result[0]).not.toBe(raw);
    expect(result[0].bookingPeriod[0]).not.toBe(raw.bookingPeriod[0]);
    expect(result[0].statusNotifications[0]).not.toBe(
      raw.statusNotifications[0],
    );
  });

  it.each([
    { bookingPriceIqd: 0 },
    { marketplaceCommissionFils: -1 },
    { ownerNetFils: -1 },
    { marketplaceCommissionFils: 10_000_299 },
    { ownerNetFils: 90_002_699 },
  ])("fails closed on invalid owner money %#", async (invalidMoney) => {
    await expect(
      listOwnerBookingRequestNotifications(
        clientReturning([{ ...notification, ...invalidMoney }]),
      ),
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

  it.each([
    { customerName: " " },
    { customerName: " Ava Hassan" },
    { customerName: "Ava Hassan " },
    { customerName: "x".repeat(121) },
    { bookingNote: "" },
    { bookingNote: "   " },
    { bookingNote: " Garden seating, please." },
    { bookingNote: "Garden seating, please. " },
    { bookingNote: "x".repeat(501) },
  ])("fails closed on malformed owner text %#", async (malformed) => {
    await expect(
      listOwnerBookingRequestNotifications(
        clientReturning([{ ...notification, ...malformed }]),
      ),
    ).rejects.toThrow("data is invalid");
  });
});

function clientReturning(data: unknown) {
  return {
    rpc: vi.fn().mockResolvedValue({ data, error: null }),
  } as unknown as SupabaseClient;
}
