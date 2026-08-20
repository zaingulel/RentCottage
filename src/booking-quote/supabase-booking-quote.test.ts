import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SupabaseBookingQuote } from "./supabase-booking-quote";

const query = {
  from: "2026-08-21",
  to: "2026-08-21",
  guests: 4,
  amenities: [],
  selections: [
    { serviceDay: "2026-08-21", kind: "shift" as const, position: 2 as const },
  ],
};
const slug = "cottage-00000000000040008000000000000029";
const response = {
  status: "quoted",
  slug,
  cottageName: "Quiet Garden",
  contentVersion: 2,
  houseRules: "No smoking",
  termsVersion: "rentcottage-mvp-2026-08-04",
  items: [
    {
      serviceDay: "2026-08-21",
      kind: "shift",
      position: 2,
      displayName: "Night",
      startsAt: "2026-08-21T20:00:00+03:00",
      endsAt: "2026-08-22T02:00:00+03:00",
      crossesMidnight: true,
      priceIqd: 100_003,
    },
  ],
  bookingPriceIqd: 100_003,
  serviceFeeIqd: 5_000,
  customerTotalIqd: 105_003,
};

function clientReturning(data: unknown, error: unknown = null) {
  return {
    rpc: vi.fn().mockResolvedValue({ data, error }),
  } as unknown as SupabaseClient;
}

afterEach(() => vi.restoreAllMocks());

describe("Supabase Booking Quote", () => {
  it("loads a strict quote bound to the requested selection", async () => {
    const client = clientReturning(response);
    await expect(
      new SupabaseBookingQuote(client).load("en", slug, query),
    ).resolves.toEqual({
      status: "quoted",
      quote: expect.objectContaining({
        slug,
        bookingPriceIqd: 100_003,
        serviceFeeIqd: 5_000,
        customerTotalIqd: 105_003,
      }),
    });
    expect(client.rpc).toHaveBeenCalledWith("get_public_booking_quote", {
      target_locale: "en",
      target_slug: slug,
      requested_search: query,
    });
  });

  it.each([
    { ...response, exactAddress: "private" },
    { ...response, bookingPriceIqd: 1 },
    { ...response, commissionRateBasisPoints: 1_000 },
    { ...response, commissionAmountFils: 10_000_300 },
    {
      ...response,
      items: [{ ...response.items[0], position: 1 }],
    },
    {
      ...response,
      items: [{ ...response.items[0], crossesMidnight: false }],
    },
  ])(
    "fails closed for unsafe or inconsistent provider output",
    async (data) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      await expect(
        new SupabaseBookingQuote(clientReturning(data)).load("en", slug, query),
      ).resolves.toEqual({ status: "unavailable" });
    },
  );

  it("passes through only exact non-quote states without partial money", async () => {
    for (const status of ["selection-unavailable", "not-found"] as const) {
      await expect(
        new SupabaseBookingQuote(clientReturning({ status })).load(
          "ckb",
          slug,
          query,
        ),
      ).resolves.toEqual({ status });
      vi.spyOn(console, "error").mockImplementation(() => {});
      await expect(
        new SupabaseBookingQuote(
          clientReturning({ status, bookingPriceIqd: 10 }),
        ).load("ckb", slug, query),
      ).resolves.toEqual({ status: "unavailable" });
    }
  });

  it("loads separately priced consecutive Full-Day Bundles in request order", async () => {
    const fullDayQuery = {
      from: "2026-08-21",
      to: "2026-08-22",
      guests: 4,
      amenities: [],
      selections: [
        { serviceDay: "2026-08-21", kind: "full-day" as const },
        { serviceDay: "2026-08-22", kind: "full-day" as const },
      ],
    };
    const fullDayResponse = {
      ...response,
      items: [
        {
          serviceDay: "2026-08-21",
          kind: "full-day",
          displayName: "Full-day bundle",
          startsAt: "2026-08-21T08:00:00+03:00",
          endsAt: "2026-08-21T23:00:00+03:00",
          crossesMidnight: false,
          priceIqd: 250_000,
        },
        {
          serviceDay: "2026-08-22",
          kind: "full-day",
          displayName: "Full-day bundle",
          startsAt: "2026-08-22T08:00:00+03:00",
          endsAt: "2026-08-22T23:00:00+03:00",
          crossesMidnight: false,
          priceIqd: 260_000,
        },
      ],
      bookingPriceIqd: 510_000,
      customerTotalIqd: 515_000,
    };

    await expect(
      new SupabaseBookingQuote(clientReturning(fullDayResponse)).load(
        "en",
        slug,
        fullDayQuery,
      ),
    ).resolves.toEqual({
      status: "quoted",
      quote: expect.objectContaining({
        items: fullDayResponse.items,
        bookingPriceIqd: 510_000,
        serviceFeeIqd: 5_000,
        customerTotalIqd: 515_000,
      }),
    });
  });

  it.each([
    "garden-house",
    `${slug}0`,
    "cottage-ABCDEF00000000000000000000000000",
  ])(
    "rejects an invalid public slug before provider access",
    async (invalidSlug) => {
      const client = clientReturning(response);
      await expect(
        new SupabaseBookingQuote(client).load("en", invalidSlug, query),
      ).resolves.toEqual({ status: "not-found" });
      expect(client.rpc).not.toHaveBeenCalled();
    },
  );
});
