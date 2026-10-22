import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getCustomerBookingRequest } from "./customer-booking-request";

const reference = "RC-REQ-AAAAAAAAAAAAAAAA";
const baseRequest = {
  periodPresentation: "original-names",
  id: "00000000-0000-4000-8000-000000000033",
  bookingRequestReference: reference,
  status: "declined",
  paymentStatus: null,
  paymentRequiredWindow: null,
  paymentRequiredExpiry: null,
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

const rawRequest = { ...baseRequest, coverMediaId: null };
const expectedRequest = { ...baseRequest, coverMediaUrl: null };

function clientReturning(data: unknown) {
  return {
    rpc: vi.fn().mockResolvedValue({ data, error: null }),
  } as unknown as SupabaseClient;
}

describe("Customer Booking Request database projection", () => {
  it("retains historical identity and rejects unsupported presentation metadata", async () => {
    for (const periodPresentation of [
      undefined,
      null,
      "original-names",
      "morning-evening-v1",
    ]) {
      const raw = {
        ...rawRequest,
        periodPresentation,
        customerPhone: "private",
      };
      const client = clientReturning(raw);
      const result = await getCustomerBookingRequest(client, reference);
      expect(result).toEqual({
        ...expectedRequest,
        periodPresentation: periodPresentation ?? "original-names",
      });
      expect(result?.bookingPeriod).toEqual(baseRequest.bookingPeriod);
      expect(result?.bookingPeriod[0]).not.toBe(raw.bookingPeriod[0]);
      expect(client.rpc).toHaveBeenCalledWith(
        "get_customer_booking_request_presentation",
        { target_reference: reference },
      );
    }
    const missingMarker: Record<string, unknown> = { ...rawRequest };
    delete missingMarker.periodPresentation;
    await expect(
      getCustomerBookingRequest(clientReturning(missingMarker), reference),
    ).resolves.toEqual(expectedRequest);
    const historical = [
      {
        ...baseRequest.bookingPeriod[0],
        position: 3,
        displayName: "Original third shift",
      },
    ];
    for (const periodPresentation of [undefined, null, "original-names"]) {
      await expect(
        getCustomerBookingRequest(
          clientReturning({
            ...rawRequest,
            periodPresentation,
            bookingPeriod: historical,
          }),
          reference,
        ),
      ).resolves.toMatchObject({
        periodPresentation: "original-names",
        bookingPeriod: historical,
      });
    }
    for (const periodPresentation of [
      "",
      "morning-evening-v2",
      1,
      true,
      false,
      {},
      [],
      { periodPresentation: "original-names" },
    ]) {
      await expect(
        getCustomerBookingRequest(
          clientReturning({ ...rawRequest, periodPresentation }),
          reference,
        ),
      ).rejects.toThrow("Booking Request status data is invalid");
    }
    await expect(
      getCustomerBookingRequest(
        clientReturning({
          ...rawRequest,
          periodPresentation: "morning-evening-v1",
          bookingPeriod: historical,
        }),
        reference,
      ),
    ).rejects.toThrow("Booking Request status data is invalid");
  });

  it.each([
    ["2099-08-21T09:19:59.999Z", "open"],
    ["2099-08-21T09:20:00.000Z", "elapsed"],
  ] as const)(
    "validates the fixed Payment Required window as %s database time",
    async (databaseNow, phase) => {
      await expect(
        getCustomerBookingRequest(
          clientReturning({
            ...rawRequest,
            status: "accepted",
            paymentStatus: "payment-required",
            paymentRequiredWindow: {
              recordedAt: "2099-08-21T09:00:00.000Z",
              deadline: "2099-08-21T09:20:00.000Z",
              databaseNow,
            },
          }),
          reference,
        ),
      ).resolves.toMatchObject({
        paymentRequiredWindow: {
          recordedAt: "2099-08-21T09:00:00.000Z",
          deadline: "2099-08-21T09:20:00.000Z",
          phase,
        },
      });
    },
  );

  it.each([
    null,
    {
      recordedAt: "2099-08-21T09:00:00.000Z",
      deadline: "2099-08-21T09:20:00.001Z",
      databaseNow: "2099-08-21T09:10:00.000Z",
    },
  ])(
    "rejects Payment Required without an exact fixed window %#",
    async (paymentRequiredWindow) => {
      await expect(
        getCustomerBookingRequest(
          clientReturning({
            ...rawRequest,
            status: "accepted",
            paymentStatus: "payment-required",
            paymentRequiredWindow,
          }),
          reference,
        ),
      ).rejects.toThrow("invalid");
    },
  );
  it.each(["capture-processing", "paid-confirmed"] as const)(
    "retains authoritative %s evidence",
    async (paymentStatus) => {
      const result = await getCustomerBookingRequest(
        clientReturning({ ...rawRequest, status: "accepted", paymentStatus }),
        reference,
      );
      expect(result).toMatchObject({ status: "accepted", paymentStatus });
    },
  );
  it.each([undefined, "paid", 1, { status: "paid-confirmed" }])(
    "rejects malformed payment projection %s",
    async (paymentStatus) => {
      await expect(
        getCustomerBookingRequest(
          clientReturning({ ...rawRequest, paymentStatus }),
          reference,
        ),
      ).rejects.toThrow("invalid");
    },
  );
  it("rejects paid evidence attached to a pending request", async () => {
    await expect(
      getCustomerBookingRequest(
        clientReturning({
          ...rawRequest,
          status: "pending",
          paymentStatus: "paid-confirmed",
        }),
        reference,
      ),
    ).rejects.toThrow("invalid");
  });
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
          clientReturning({ ...rawRequest, ...invalid }),
          reference,
        ),
      ).rejects.toThrow("Booking Request status data is invalid");
    },
  );

  it("rejects an unknown decline reason", async () => {
    await expect(
      getCustomerBookingRequest(
        clientReturning({
          ...rawRequest,
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
          ...rawRequest,
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
      ...rawRequest,
      customerPhone: "+9647000000000",
      paymentSnapshot: { private: true },
      responseDeadline: "2099-08-21T12:00:00",
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

    expect(result).toEqual({
      ...expectedRequest,
      responseDeadline: "2099-08-21T12:00:00",
    });
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
        clientReturning({ ...rawRequest, ...invalidMoney }),
        reference,
      ),
    ).rejects.toThrow("Booking Request status data is invalid");
  });

  it("allows a zero service fee when the total remains exact", async () => {
    await expect(
      getCustomerBookingRequest(
        clientReturning({
          ...rawRequest,
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
          clientReturning({ ...rawRequest, declineNote }),
          reference,
        ),
      ).rejects.toThrow("Booking Request status data is invalid");
    },
  );
});

it.each([
  "available",
  "processing",
  "retryable",
  "deadline-elapsed",
  "confirmed",
])(
  "rejects a recovery projection on a declined request: %s",
  async (status) => {
    await expect(
      getCustomerBookingRequest(
        clientReturning({ ...rawRequest, paymentRecovery: { status } }),
        reference,
      ),
    ).rejects.toThrow("data is invalid");
  },
);

it.each([
  { status: ["available"] },
  { status: {} },
  { status: null },
  { status: 1 },
])(
  "rejects a non-string recovery status without coercion: %j",
  async ({ status }) => {
    await expect(
      getCustomerBookingRequest(
        clientReturning({
          ...rawRequest,
          status: "accepted",
          paymentStatus: "payment-required",
          paymentRequiredWindow: {
            recordedAt: "2099-08-21T09:00:00.000Z",
            deadline: "2099-08-21T09:20:00.000Z",
            databaseNow: "2099-08-21T09:10:00.000Z",
          },
          paymentRecovery: { status },
        }),
        reference,
      ),
    ).rejects.toThrow("data is invalid");
  },
);

describe("Payment Required expiry projection", () => {
  const window = {
    recordedAt: "2099-08-21T09:00:00.000Z",
    deadline: "2099-08-21T09:20:00.000Z",
    databaseNow: "2099-08-21T09:20:00.000Z",
  };
  it.each(["processing", "attention-required", "expired"] as const)(
    "retains the minimal %s state",
    async (status) => {
      const expiry = { status, deadline: window.deadline };
      const raw = {
        ...rawRequest,
        status: status === "expired" ? "expired" : "accepted",
        paymentStatus: status === "expired" ? null : "payment-required",
        paymentRequiredWindow: status === "expired" ? null : window,
        paymentRequiredExpiry: expiry,
      };
      const result = await getCustomerBookingRequest(
        clientReturning(raw),
        reference,
      );
      expect(result?.paymentRequiredExpiry).toEqual(expiry);
      expect(result?.paymentRequiredExpiry).not.toBe(expiry);
    },
  );
  it.each([
    undefined,
    { status: "expired", deadline: "2099-08-21T09:20:00.000Z" },
    { status: "processing", deadline: "invalid" },
    { status: "processing", deadline: "2099-08-21T09:21:00.000Z" },
    {
      status: "processing",
      deadline: "2099-08-21T09:20:00.000Z",
      providerReference: "private",
    },
    { status: "unknown", deadline: "2099-08-21T09:20:00.000Z" },
  ])(
    "rejects malformed or contradictory expiry evidence %#",
    async (paymentRequiredExpiry) => {
      const raw = {
        ...rawRequest,
        status: "accepted",
        paymentStatus: "payment-required",
        paymentRequiredWindow: window,
        paymentRequiredExpiry,
      };
      await expect(
        getCustomerBookingRequest(clientReturning(raw), reference),
      ).rejects.toThrow("invalid");
    },
  );
  it("requires confirmed payment to have no residual expiry projection", async () => {
    const raw = {
      ...rawRequest,
      status: "accepted",
      paymentStatus: "paid-confirmed",
      paymentRequiredExpiry: {
        status: "attention-required",
        deadline: window.deadline,
      },
    };
    await expect(
      getCustomerBookingRequest(clientReturning(raw), reference),
    ).rejects.toThrow("invalid");
  });
});

it("normalizes only a valid current public cover identifier", async () => {
  const raw = baseRequest;
  for (const [coverMediaId, coverMediaUrl] of [
    [
      "41000000-0000-4000-8000-000000003202",
      "/api/cottage-media/41000000-0000-4000-8000-000000003202",
    ],
    [null, null],
  ] as const) {
    await expect
      .soft(
        getCustomerBookingRequest(
          clientReturning({ ...raw, coverMediaId }),
          reference,
        ),
        `valid current public cover ${coverMediaId}`,
      )
      .resolves.toEqual({ ...raw, coverMediaUrl });
  }
  for (const coverMediaId of [
    undefined,
    "",
    "not-a-uuid",
    "https://example.com/photo.jpg",
    "javascript:alert(1)",
    "../private/photo",
    42,
    [],
    {},
  ]) {
    await expect
      .soft(
        getCustomerBookingRequest(
          clientReturning({ ...raw, coverMediaId }),
          reference,
        ),
        `malformed current public cover ${JSON.stringify(coverMediaId)}`,
      )
      .rejects.toThrow("Booking Request status data is invalid");
  }
  await expect
    .soft(
      getCustomerBookingRequest(clientReturning(raw), reference),
      "missing current public cover field",
    )
    .rejects.toThrow("Booking Request status data is invalid");
});
