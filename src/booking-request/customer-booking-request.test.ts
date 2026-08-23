import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getCustomerBookingRequest } from "./customer-booking-request";

const reference = "RC-REQ-AAAAAAAAAAAAAAAA";
const baseRequest = {
  id: "00000000-0000-4000-8000-000000000033",
  bookingRequestReference: reference,
  status: "declined",
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
  partySize: 2,
  bookingPriceIqd: 100_003,
  serviceFeeIqd: 5_000,
  customerTotalIqd: 105_003,
  responseDeadline: "2099-08-21T12:00:00.000Z",
  declineReason: "cottage_unavailable",
  declineNote: "Fictional maintenance is required.",
  statusNotifications: [
    {
      id: "00000000-0000-4000-8000-000000000034",
      status: "declined",
      createdAt: "2099-08-21T10:00:00.000Z",
    },
  ],
};

function clientReturning(data: unknown) {
  return {
    rpc: vi.fn().mockResolvedValue({ data, error: null }),
  } as unknown as SupabaseClient;
}

describe("Customer Booking Request database projection", () => {
  it.each([
    { id: "not-a-uuid" },
    {
      statusNotifications: [
        { ...baseRequest.statusNotifications[0], id: "not-a-uuid" },
      ],
    },
  ])(
    "fails closed on malformed customer projection UUIDs %#",
    async (invalid) => {
      await expect(
        getCustomerBookingRequest(
          clientReturning({ ...baseRequest, ...invalid }),
          reference,
        ),
      ).rejects.toThrow("Booking Request status data is invalid");
    },
  );

  it("rejects an unknown decline reason", async () => {
    await expect(
      getCustomerBookingRequest(
        clientReturning({
          ...baseRequest,
          declineReason: "plausible_but_unknown",
        }),
        reference,
      ),
    ).rejects.toThrow("Booking Request status data is invalid");
  });

  it("rejects a non-terminal notification status", async () => {
    await expect(
      getCustomerBookingRequest(
        clientReturning({
          ...baseRequest,
          statusNotifications: [
            { ...baseRequest.statusNotifications[0], status: "processing" },
          ],
        }),
        reference,
      ),
    ).rejects.toThrow("Booking Request status data is invalid");
  });

  it("allocates an exact request, booking item and receipt projection", async () => {
    const raw = {
      ...baseRequest,
      customerPhone: "+9647000000000",
      paymentSnapshot: { private: true },
      bookingPeriod: [
        { ...baseRequest.bookingPeriod[0], privateUnitId: "private-unit" },
      ],
      statusNotifications: [
        {
          ...baseRequest.statusNotifications[0],
          recipientUserId: "private-recipient",
        },
      ],
    };

    const result = await getCustomerBookingRequest(
      clientReturning(raw),
      reference,
    );

    expect(result).toEqual(baseRequest);
    expect(result).not.toBe(raw);
    expect(result?.bookingPeriod[0]).not.toBe(raw.bookingPeriod[0]);
    expect(result?.statusNotifications[0]).not.toBe(raw.statusNotifications[0]);
  });

  it.each([
    { bookingPriceIqd: 0 },
    { bookingPriceIqd: -1 },
    { serviceFeeIqd: -1 },
    { customerTotalIqd: 105_002 },
    { customerTotalIqd: 105_004 },
  ])("fails closed on invalid customer money %#", async (invalidMoney) => {
    await expect(
      getCustomerBookingRequest(
        clientReturning({ ...baseRequest, ...invalidMoney }),
        reference,
      ),
    ).rejects.toThrow("Booking Request status data is invalid");
  });

  it("allows a zero service fee when the total remains exact", async () => {
    await expect(
      getCustomerBookingRequest(
        clientReturning({
          ...baseRequest,
          serviceFeeIqd: 0,
          customerTotalIqd: baseRequest.bookingPriceIqd,
        }),
        reference,
      ),
    ).resolves.toMatchObject({
      serviceFeeIqd: 0,
      customerTotalIqd: baseRequest.bookingPriceIqd,
    });
  });

  it.each(["", "   ", " padded", "padded ", "x".repeat(501)])(
    "fails closed on a malformed decline note %#",
    async (declineNote) => {
      await expect(
        getCustomerBookingRequest(
          clientReturning({ ...baseRequest, declineNote }),
          reference,
        ),
      ).rejects.toThrow("Booking Request status data is invalid");
    },
  );
});
