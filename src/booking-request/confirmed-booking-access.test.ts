import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { getConfirmedBookingAccess } from "./confirmed-booking-access";

const requestReference = "RC-REQ-AAAAAAAAAAAAAAAA";
const shared = {
  receiptId: "00000000-0000-4000-8000-000000000035",
  bookingRequestReference: requestReference,
  bookingReference: "CONFIRMED-BOOKING-35",
  confirmedAt: "2099-08-21T10:00:00.000Z",
  customerName: "Ava Hassan",
  cottageName: "The Reed House",
  bookingPeriod: [
    {
      serviceDay: "2099-08-21",
      displayName: "Morning",
      startsAt: "2099-08-21T09:00:00+03:00",
      endsAt: "2099-08-21T13:00:00+03:00",
      crossesMidnight: false,
      priceIqd: 100_003,
      kind: "shift",
      position: 1,
    },
  ],
  partySize: 4,
  houseRules: "No smoking",
  bookingTermsVersion: "rentcottage-mvp-2026-08-04",
  cancellationPolicyVersion: "rentcottage-cancellation-2026-08-04",
  exactAddress: "Fictional street 35",
  privateDirections: "Turn after the fictional bridge.",
  mapPin: { latitude: 33.315241, longitude: 44.366067 },
  customerPhone: "+9647500000035",
  ownerPhone: "+9647700000035",
};

function clientReturning(data: unknown, error: unknown = null) {
  return {
    rpc: vi.fn().mockResolvedValue({ data, error }),
  } as unknown as SupabaseClient;
}

describe("Confirmed Booking access repository", () => {
  it("parses the Customer's paid confirmation and Customer pricing", async () => {
    const client = clientReturning({
      ...shared,
      actorRole: "customer",
      pricing: {
        bookingPriceIqd: 100_003,
        serviceFeeIqd: 5_000,
        customerTotalIqd: 105_003,
      },
    });

    await expect(
      getConfirmedBookingAccess(client, requestReference),
    ).resolves.toEqual({
      ...shared,
      actorRole: "customer",
      pricing: {
        bookingPriceIqd: 100_003,
        serviceFeeIqd: 5_000,
        customerTotalIqd: 105_003,
      },
    });
    expect(client.rpc).toHaveBeenCalledWith("get_confirmed_booking_access", {
      target_reference: requestReference,
    });
  });

  it("parses the Cottage Owner's paid confirmation and Owner pricing", async () => {
    await expect(
      getConfirmedBookingAccess(
        clientReturning({
          ...shared,
          actorRole: "cottage_owner",
          pricing: {
            bookingPriceIqd: 100_003,
            marketplaceCommissionFils: 10_000_300,
            ownerNetFils: 90_002_700,
          },
        }),
        requestReference,
      ),
    ).resolves.toMatchObject({
      actorRole: "cottage_owner",
      pricing: {
        bookingPriceIqd: 100_003,
        marketplaceCommissionFils: 10_000_300,
        ownerNetFils: 90_002_700,
      },
    });
  });

  it("preserves truthful missing optional access and contact details", async () => {
    await expect(
      getConfirmedBookingAccess(
        clientReturning({
          ...shared,
          actorRole: "customer",
          pricing: {
            bookingPriceIqd: 100_003,
            serviceFeeIqd: 5_000,
            customerTotalIqd: 105_003,
          },
          exactAddress: null,
          privateDirections: null,
          mapPin: null,
          ownerPhone: null,
        }),
        requestReference,
      ),
    ).resolves.toMatchObject({
      exactAddress: null,
      privateDirections: null,
      mapPin: null,
      ownerPhone: null,
    });
  });

  it.each([
    { actorRole: "administrator" },
    { customerPhone: "07500000035" },
    { mapPin: { latitude: 91, longitude: 44.366067 } },
    { providerReference: "must-not-cross-the-boundary" },
    {
      actorRole: "customer",
      pricing: {
        bookingPriceIqd: 100_003,
        marketplaceCommissionFils: 10_000_300,
        ownerNetFils: 90_002_700,
      },
    },
  ])(
    "fails closed on malformed or over-broad private data %#",
    async (change) => {
      await expect(
        getConfirmedBookingAccess(
          clientReturning({
            ...shared,
            actorRole: "customer",
            pricing: {
              bookingPriceIqd: 100_003,
              serviceFeeIqd: 5_000,
              customerTotalIqd: 105_003,
            },
            ...change,
          }),
          requestReference,
        ),
      ).rejects.toThrow("Confirmed Booking access data is invalid");
    },
  );

  it("returns null when the database denies access", async () => {
    await expect(
      getConfirmedBookingAccess(clientReturning(null), requestReference),
    ).resolves.toBeNull();
  });

  it("rejects invalid references before querying private data", async () => {
    const client = clientReturning(shared);
    await expect(
      getConfirmedBookingAccess(client, "CONFIRMED-BOOKING-35"),
    ).resolves.toBeNull();
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("reports database failures without returning partial data", async () => {
    await expect(
      getConfirmedBookingAccess(
        clientReturning(null, { message: "database unavailable" }),
        requestReference,
      ),
    ).rejects.toThrow("Confirmed Booking access is unavailable");
  });
});
