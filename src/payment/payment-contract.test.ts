import { describe, expect, it } from "vitest";

import { iqdToFils } from "./payment-contract";
import { createPaymentLifecycle } from "./payment-lifecycle";
import { PaymentSimulator } from "./payment-simulator";

describe("provider-neutral payment contract", () => {
  it("converts only whole IQD prices to safe integer fils", () => {
    expect(iqdToFils(125_000)).toBe(125_000_000);
    expect(() => iqdToFils(125_000.5)).toThrow("whole IQD");
    expect(() => iqdToFils(Number.MAX_SAFE_INTEGER)).toThrow(
      "safe integer fils",
    );
  });

  it("rejects a Booking Price that cannot produce an exact commission at lifecycle creation", () => {
    const simulator = new PaymentSimulator({
      now: () => "2026-08-16T09:00:00.000Z",
      outcomes: [],
    });

    expect(() =>
      createPaymentLifecycle(
        {
          paymentLifecycleId: "pay-non-fils-aligned-commission",
          bookingPriceFils: 101,
          bookingServiceFeeFils: 0,
        },
        simulator,
      ),
    ).toThrow("10% Marketplace Commission must be exact in fils");
    expect(simulator.requests).toHaveLength(0);
  });

  it("authorizes and captures only the exact full Customer Total", async () => {
    const simulator = new PaymentSimulator({
      now: () => "2026-08-16T09:00:00.000Z",
      outcomes: ["succeeded", "succeeded"],
    });
    const payment = createPaymentLifecycle(
      {
        paymentLifecycleId: "pay-life-1",
        bookingPriceFils: 200_000_000,
        bookingServiceFeeFils: 5_000_000,
      },
      simulator,
    );

    await payment.authorize();
    await expect(payment.capture(204_999_000)).rejects.toThrow(
      "exact full authorized Customer Total",
    );
    expect(simulator.requests).toHaveLength(1);

    await payment.capture(205_000_000);

    expect(payment.snapshot()).toMatchObject({
      paymentLifecycleId: "pay-life-1",
      bookingPriceFils: 200_000_000,
      bookingServiceFeeFils: 5_000_000,
      customerTotalFils: 205_000_000,
      authorization: { status: "succeeded", amountFils: 205_000_000 },
      capture: { status: "succeeded", amountFils: 205_000_000 },
    });
    expect(
      payment
        .snapshot()
        .movements.map(({ kind, amountFils }) => ({ kind, amountFils })),
    ).toEqual([
      { kind: "authorization", amountFils: 205_000_000 },
      { kind: "capture", amountFils: 205_000_000 },
    ]);
  });

  it("releases only the exact full uncaptured Customer Total", async () => {
    const simulator = new PaymentSimulator({
      now: () => "2026-08-16T09:05:00.000Z",
      outcomes: ["succeeded", "succeeded"],
    });
    const payment = createPaymentLifecycle(
      {
        paymentLifecycleId: "pay-life-release",
        bookingPriceFils: 80_000_000,
        bookingServiceFeeFils: 5_000_000,
      },
      simulator,
    );

    await payment.authorize();
    await expect(payment.release(84_000_000)).rejects.toThrow(
      "exact full uncaptured Customer Total",
    );
    expect(simulator.requests).toHaveLength(1);

    await payment.release(85_000_000);

    expect(payment.snapshot().release).toMatchObject({
      status: "succeeded",
      amountFils: 85_000_000,
    });
    await expect(payment.capture(85_000_000)).rejects.toThrow(
      "already released",
    );
  });

  it("releases a full authorization after capture definitively fails", async () => {
    const simulator = new PaymentSimulator({
      now: () => "2026-08-16T09:07:00.000Z",
      outcomes: ["succeeded", "failed", "succeeded"],
      failureRetrySafety: [false],
    });
    const payment = createPaymentLifecycle(
      {
        paymentLifecycleId: "pay-release-after-failed-capture",
        bookingPriceFils: 80_000_000,
        bookingServiceFeeFils: 5_000_000,
      },
      simulator,
    );
    await payment.authorize();
    const failedCapture = await payment.capture(85_000_000);

    const release = await payment.release(85_000_000);

    expect(failedCapture.status).toBe("failed");
    expect(release).toMatchObject({
      status: "succeeded",
      amountFils: 85_000_000,
    });
    expect(simulator.requests.map((request) => request.kind)).toEqual([
      "authorization",
      "capture",
      "release",
    ]);
  });

  it("captures a full authorization after release definitively fails", async () => {
    const simulator = new PaymentSimulator({
      now: () => "2026-08-16T09:08:00.000Z",
      outcomes: ["succeeded", "failed", "succeeded"],
      failureRetrySafety: [false],
    });
    const payment = createPaymentLifecycle(
      {
        paymentLifecycleId: "pay-capture-after-failed-release",
        bookingPriceFils: 80_000_000,
        bookingServiceFeeFils: 5_000_000,
      },
      simulator,
    );
    await payment.authorize();
    const failedRelease = await payment.release(85_000_000);

    const capture = await payment.capture(85_000_000);

    expect(failedRelease.status).toBe("failed");
    expect(capture).toMatchObject({
      status: "succeeded",
      amountFils: 85_000_000,
    });
    expect(simulator.requests.map((request) => request.kind)).toEqual([
      "authorization",
      "release",
      "capture",
    ]);
  });

  it("allocates refunds explicitly and computes commission from remaining Booking Price", async () => {
    const simulator = new PaymentSimulator({
      now: () => "2026-08-16T09:10:00.000Z",
      outcomes: ["succeeded", "succeeded", "succeeded"],
    });
    const payment = createPaymentLifecycle(
      {
        paymentLifecycleId: "pay-life-refund",
        bookingPriceFils: 123_450_000,
        bookingServiceFeeFils: 5_000_000,
      },
      simulator,
    );
    await payment.authorize();
    await payment.capture(128_450_000);

    await payment.refund({
      bookingPriceFils: 23_450_000,
      bookingServiceFeeFils: 2_000_000,
    });

    expect(payment.snapshot().financials).toEqual({
      refundedBookingPriceFils: 23_450_000,
      refundedBookingServiceFeeFils: 2_000_000,
      remainingBookingPriceFils: 100_000_000,
      remainingBookingServiceFeeFils: 3_000_000,
      marketplaceCommissionFils: 10_000_000,
      ownerEntitlementFils: 90_000_000,
    });
    expect(payment.snapshot().refunds[0]).toMatchObject({
      status: "succeeded",
      amountFils: 25_450_000,
      refundAllocation: {
        bookingPriceFils: 23_450_000,
        bookingServiceFeeFils: 2_000_000,
      },
    });

    await expect(
      payment.refund({
        bookingPriceFils: 100_000_001,
        bookingServiceFeeFils: 0,
      }),
    ).rejects.toThrow("exceeds the remaining Booking Price");
    await expect(
      payment.refund({ bookingPriceFils: 1, bookingServiceFeeFils: 0 }),
    ).rejects.toThrow("10% Marketplace Commission must be exact");
    expect(simulator.requests).toHaveLength(3);
  });

  it("settles only the owner entitlement after booking completion", async () => {
    const simulator = new PaymentSimulator({
      now: () => "2026-08-16T09:15:00.000Z",
      outcomes: ["succeeded", "succeeded", "succeeded"],
    });
    const payment = createPaymentLifecycle(
      {
        paymentLifecycleId: "pay-life-settlement",
        bookingPriceFils: 100_000_000,
        bookingServiceFeeFils: 5_000_000,
        providerFeeFils: 2_000_000,
        providerReserveFils: 3_000_000,
      },
      simulator,
    );
    await payment.authorize();
    await payment.capture(105_000_000);

    await expect(payment.settle()).rejects.toThrow("Booking Period completion");
    payment.markBookingCompleted();
    await payment.settle();

    expect(payment.snapshot().payout).toMatchObject({
      status: "paid",
      eligibleFils: 90_000_000,
      paidFils: 90_000_000,
      providerFeeFils: 2_000_000,
      providerReserveFils: 3_000_000,
      automaticOwnerDebitFils: 0,
    });
    expect(simulator.requests.at(-1)).toMatchObject({
      kind: "settlement",
      amountFils: 90_000_000,
    });
  });

  it("does not advertise payout eligibility when a full refund leaves zero owner entitlement", async () => {
    const simulator = new PaymentSimulator({
      now: () => "2026-08-16T09:17:00.000Z",
      outcomes: ["succeeded", "succeeded", "succeeded"],
    });
    const payment = createPaymentLifecycle(
      {
        paymentLifecycleId: "pay-zero-entitlement",
        bookingPriceFils: 100_000_000,
        bookingServiceFeeFils: 5_000_000,
      },
      simulator,
    );
    await payment.authorize();
    await payment.capture(105_000_000);
    await payment.refund({
      bookingPriceFils: 100_000_000,
      bookingServiceFeeFils: 5_000_000,
    });
    payment.markBookingCompleted();

    expect(payment.snapshot().payout).toMatchObject({
      status: "not_eligible",
      eligibleFils: 0,
      paidFils: 0,
    });
    await expect(payment.settle()).rejects.toThrow(
      "No positive Owner Payout remains",
    );
    expect(simulator.requests).toHaveLength(3);
  });

  it("returns immutable snapshots and money movements", async () => {
    const simulator = new PaymentSimulator({
      now: () => "2026-08-16T09:20:00.000Z",
      outcomes: ["succeeded"],
    });
    const payment = createPaymentLifecycle(
      {
        paymentLifecycleId: "pay-life-immutable",
        bookingPriceFils: 40_000_000,
        bookingServiceFeeFils: 5_000_000,
      },
      simulator,
    );
    await payment.authorize();
    const snapshot = payment.snapshot();

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.movements)).toBe(true);
    expect(Object.isFrozen(snapshot.movements[0])).toBe(true);
    expect(Object.isFrozen(snapshot.authorization)).toBe(true);
  });

  it("preserves validated lifecycle money when the caller mutates its input", async () => {
    const simulator = new PaymentSimulator({
      now: () => "2026-08-16T09:25:00.000Z",
      outcomes: ["succeeded"],
    });
    const input = {
      paymentLifecycleId: "pay-input-copy",
      bookingPriceFils: 40_000_000,
      bookingServiceFeeFils: 5_000_000,
      providerFeeFils: 1_000_000,
      providerReserveFils: 2_000_000,
    };
    const payment = createPaymentLifecycle(input, simulator);

    input.paymentLifecycleId = "mutated-lifecycle";
    input.bookingPriceFils = 1;
    input.bookingServiceFeeFils = 2;
    input.providerFeeFils = 3;
    input.providerReserveFils = 4;
    await payment.authorize();

    expect(payment.snapshot()).toMatchObject({
      paymentLifecycleId: "pay-input-copy",
      bookingPriceFils: 40_000_000,
      bookingServiceFeeFils: 5_000_000,
      customerTotalFils: 45_000_000,
      payout: { providerFeeFils: 1_000_000, providerReserveFils: 2_000_000 },
    });
    expect(simulator.requests[0]).toMatchObject({
      paymentLifecycleId: "pay-input-copy",
      amountFils: 45_000_000,
    });
  });
});
