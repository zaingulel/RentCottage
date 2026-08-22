import { describe, expect, it } from "vitest";

import type {
  PaymentLifecycleSnapshot,
  PaymentProviderAdapter,
  ProviderExecutionPermit,
} from "./payment-contract";
import { createPaymentLifecycle } from "./payment-lifecycle";
import { PaymentSimulator } from "./payment-simulator";

describe("payment lifecycle reliability", () => {
  it("does not start a physical provider request at the persisted not-after boundary", async () => {
    const permit: ProviderExecutionPermit = {
      claimId: "97000000-0000-4000-8000-000000000032",
      generation: 1,
      idempotencyKey: "booking-request:97000000-0000-4000-8000-000000000032:1",
      notAfter: "2026-08-21T18:00:00.000Z",
    };
    const saved: PaymentLifecycleSnapshot[] = [];
    const simulator = new PaymentSimulator({
      now: () => "2026-08-21T18:00:00.000Z",
      outcomes: ["succeeded"],
    });
    const payment = createPaymentLifecycle(
      {
        paymentLifecycleId: "pay-provider-not-after",
        bookingPriceFils: 90_000_000,
        bookingServiceFeeFils: 5_000_000,
      },
      simulator,
      {
        save: async (snapshot) => {
          saved.push(snapshot);
          return snapshot.authorization?.status === "pending"
            ? permit
            : undefined;
        },
      },
    );

    await expect(payment.authorize()).rejects.toThrow(
      "provider_execution_not_started",
    );

    expect(simulator.requests).toHaveLength(0);
    expect(saved.at(-1)?.authorization).toMatchObject({
      status: "failed",
      providerRequestId: null,
      providerReference: null,
      movementReference: null,
      reconciliationRequired: false,
      retrySafe: false,
    });
  });

  it("uses one physical provider request for a retried durable execution permit", async () => {
    const permit: ProviderExecutionPermit = {
      claimId: "97000000-0000-4000-8000-000000000032",
      generation: 1,
      idempotencyKey: "booking-request:97000000-0000-4000-8000-000000000032:1",
      notAfter: "2026-08-21T18:01:00.000Z",
    };
    const simulator = new PaymentSimulator({
      now: () => "2026-08-21T18:00:00.000Z",
      outcomes: ["succeeded", "failed"],
    });
    const create = () =>
      createPaymentLifecycle(
        {
          paymentLifecycleId: "pay-provider-idempotency",
          bookingPriceFils: 90_000_000,
          bookingServiceFeeFils: 5_000_000,
        },
        simulator,
        {
          save: async (snapshot) =>
            snapshot.authorization?.status === "pending" ? permit : undefined,
        },
      );

    const first = await create().authorize();
    const retry = await create().authorize();

    expect(first).toEqual(retry);
    expect(simulator.requests).toHaveLength(1);
  });

  it.each([
    new DOMException("The operation was aborted.", "AbortError"),
    new TypeError("network unavailable"),
  ])(
    "normalizes a thrown provider exception into a reconcilable indeterminate attempt",
    async (providerException) => {
      const simulator = new PaymentSimulator({
        now: () => "2026-08-16T09:55:00.000Z",
        outcomes: ["succeeded"],
        reconciliationOutcomes: ["succeeded"],
      });
      const provider: PaymentProviderAdapter = {
        identity: simulator.identity,
        execute: async (request) => {
          if (request.kind === "capture") throw providerException;
          return simulator.execute(request);
        },
        query: (request) => simulator.query(request),
        verifySignedEvent: (event) => simulator.verifySignedEvent(event),
      };
      const payment = createPaymentLifecycle(
        {
          paymentLifecycleId: `pay-thrown-${providerException.name}`,
          bookingPriceFils: 90_000_000,
          bookingServiceFeeFils: 5_000_000,
        },
        provider,
      );
      await payment.authorize();

      const timedOut = await payment.capture(95_000_000);

      expect(timedOut).toMatchObject({
        kind: "capture",
        status: "pending",
        providerRequestId: null,
        providerReference: null,
        reconciliationRequired: true,
        retrySafe: false,
      });
      await expect(payment.retry(timedOut.logicalOperationId)).rejects.toThrow(
        "definitively failed operation",
      );

      const reconciled = await payment.reconcile(timedOut.logicalOperationId);

      expect(reconciled).toMatchObject({
        status: "succeeded",
        attemptId: timedOut.attemptId,
        logicalOperationId: timedOut.logicalOperationId,
      });
      expect(simulator.queries).toHaveLength(1);
      expect(simulator.queries[0]).toMatchObject({
        attemptId: timedOut.attemptId,
        providerRequestId: null,
        providerReference: null,
      });
      expect(simulator.queries[0]).not.toHaveProperty("executionPermit");
      expect(
        payment
          .snapshot()
          .movements.filter((movement) => movement.kind === "capture"),
      ).toHaveLength(1);
    },
  );

  it("reconciles an indeterminate timeout without retrying the provider request", async () => {
    const simulator = new PaymentSimulator({
      now: () => "2026-08-16T10:00:00.000Z",
      outcomes: ["succeeded", "indeterminate"],
      reconciliationOutcomes: ["succeeded"],
    });
    const payment = createPaymentLifecycle(
      {
        paymentLifecycleId: "pay-timeout",
        bookingPriceFils: 90_000_000,
        bookingServiceFeeFils: 5_000_000,
      },
      simulator,
    );
    await payment.authorize();
    const timedOut = await payment.capture(95_000_000);

    expect(timedOut).toMatchObject({
      status: "pending",
      reconciliationRequired: true,
    });
    expect(payment.snapshot().movements).toHaveLength(1);

    const reconciled = await payment.reconcile(timedOut.logicalOperationId);

    expect(reconciled).toMatchObject({
      status: "succeeded",
      reconciliationRequired: false,
      attemptId: timedOut.attemptId,
    });
    expect(simulator.requests).toHaveLength(2);
    expect(simulator.queries).toHaveLength(1);
    expect(
      payment
        .snapshot()
        .movements.filter((movement) => movement.kind === "capture"),
    ).toHaveLength(1);
    await expect(payment.retry(timedOut.logicalOperationId)).rejects.toThrow(
      "definitively failed operation",
    );
  });

  it("retries a proven-safe failure with a new attempt under the same logical operation", async () => {
    const simulator = new PaymentSimulator({
      now: () => "2026-08-16T10:05:00.000Z",
      outcomes: ["succeeded", "failed", "succeeded"],
      failureRetrySafety: [true],
    });
    const payment = createPaymentLifecycle(
      {
        paymentLifecycleId: "pay-safe-retry",
        bookingPriceFils: 70_000_000,
        bookingServiceFeeFils: 5_000_000,
      },
      simulator,
    );
    await payment.authorize();
    const failed = await payment.capture(75_000_000);
    const succeeded = await payment.retry(failed.logicalOperationId);

    expect(failed).toMatchObject({ status: "failed", retrySafe: true });
    expect(succeeded.status).toBe("succeeded");
    expect(succeeded.logicalOperationId).toBe(failed.logicalOperationId);
    expect(succeeded.attemptId).not.toBe(failed.attemptId);
    expect(succeeded.providerRequestId).not.toBe(failed.providerRequestId);
    expect(
      payment
        .snapshot()
        .movements.filter((movement) => movement.kind === "capture"),
    ).toHaveLength(1);
  });

  it("rejects retrying a failed capture after the authorization was released", async () => {
    const simulator = new PaymentSimulator({
      now: () => "2026-08-16T10:07:00.000Z",
      outcomes: ["succeeded", "failed", "succeeded"],
      failureRetrySafety: [true],
    });
    const payment = createPaymentLifecycle(
      {
        paymentLifecycleId: "pay-stale-capture-retry",
        bookingPriceFils: 70_000_000,
        bookingServiceFeeFils: 5_000_000,
      },
      simulator,
    );
    await payment.authorize();
    const failedCapture = await payment.capture(75_000_000);
    await payment.release(75_000_000);
    const beforeRetry = payment.snapshot();

    await expect(
      payment.retry(failedCapture.logicalOperationId),
    ).rejects.toThrow("no longer valid after Authorization Release");
    expect(simulator.requests).toHaveLength(3);
    expect(payment.snapshot()).toEqual(beforeRetry);
    expect(
      payment
        .snapshot()
        .movements.filter((movement) => movement.kind === "capture"),
    ).toHaveLength(0);
  });

  it("rejects retrying a stale settlement amount after a partial refund", async () => {
    const simulator = new PaymentSimulator({
      now: () => "2026-08-16T10:08:00.000Z",
      outcomes: ["succeeded", "succeeded", "failed", "succeeded"],
      failureRetrySafety: [true],
    });
    const payment = createPaymentLifecycle(
      {
        paymentLifecycleId: "pay-stale-settlement-retry",
        bookingPriceFils: 100_000_000,
        bookingServiceFeeFils: 5_000_000,
      },
      simulator,
    );
    await payment.authorize();
    await payment.capture(105_000_000);
    payment.markBookingCompleted();
    const failedSettlement = await payment.settle();
    await payment.refund({
      bookingPriceFils: 10_000_000,
      bookingServiceFeeFils: 0,
    });
    const beforeRetry = payment.snapshot();

    await expect(
      payment.retry(failedSettlement.logicalOperationId),
    ).rejects.toThrow("stored amount no longer matches Owner Entitlement");
    expect(failedSettlement.amountFils).toBe(90_000_000);
    expect(payment.snapshot().financials.ownerEntitlementFils).toBe(81_000_000);
    expect(simulator.requests).toHaveLength(4);
    expect(payment.snapshot()).toEqual(beforeRetry);
  });

  it("rejects retrying settlement after a full refund leaves zero entitlement", async () => {
    const simulator = new PaymentSimulator({
      now: () => "2026-08-16T10:09:00.000Z",
      outcomes: ["succeeded", "succeeded", "failed", "succeeded"],
      failureRetrySafety: [true],
    });
    const payment = createPaymentLifecycle(
      {
        paymentLifecycleId: "pay-zero-settlement-retry",
        bookingPriceFils: 100_000_000,
        bookingServiceFeeFils: 5_000_000,
      },
      simulator,
    );
    await payment.authorize();
    await payment.capture(105_000_000);
    payment.markBookingCompleted();
    const failedSettlement = await payment.settle();
    await payment.refund({
      bookingPriceFils: 100_000_000,
      bookingServiceFeeFils: 5_000_000,
    });
    const beforeRetry = payment.snapshot();

    await expect(
      payment.retry(failedSettlement.logicalOperationId),
    ).rejects.toThrow("No positive Owner Payout remains");
    expect(payment.snapshot().financials.ownerEntitlementFils).toBe(0);
    expect(simulator.requests).toHaveLength(4);
    expect(payment.snapshot()).toEqual(beforeRetry);
  });

  it.each([
    {
      allocationName: "Booking Price",
      failedAllocation: {
        bookingPriceFils: 60_000_000,
        bookingServiceFeeFils: 0,
      },
      successfulAllocation: {
        bookingPriceFils: 50_000_000,
        bookingServiceFeeFils: 0,
      },
    },
    {
      allocationName: "Booking Service Fee",
      failedAllocation: {
        bookingPriceFils: 0,
        bookingServiceFeeFils: 4_000_000,
      },
      successfulAllocation: {
        bookingPriceFils: 0,
        bookingServiceFeeFils: 2_000_000,
      },
    },
  ])(
    "rejects retrying a failed refund after another refund consumes $allocationName capacity",
    async ({ allocationName, failedAllocation, successfulAllocation }) => {
      const simulator = new PaymentSimulator({
        now: () => "2026-08-16T10:09:30.000Z",
        outcomes: ["succeeded", "succeeded", "failed", "succeeded"],
        failureRetrySafety: [true],
      });
      const payment = createPaymentLifecycle(
        {
          paymentLifecycleId: `pay-stale-refund-${allocationName}`,
          bookingPriceFils: 100_000_000,
          bookingServiceFeeFils: 5_000_000,
        },
        simulator,
      );
      await payment.authorize();
      await payment.capture(105_000_000);
      const failedRefund = await payment.refund(failedAllocation);
      await payment.refund(successfulAllocation);
      const beforeRetry = payment.snapshot();

      await expect(
        payment.retry(failedRefund.logicalOperationId),
      ).rejects.toThrow(`exceeds the remaining ${allocationName}`);
      expect(simulator.requests).toHaveLength(4);
      expect(payment.snapshot()).toEqual(beforeRetry);
      expect(
        payment
          .snapshot()
          .movements.filter((movement) => movement.kind === "refund"),
      ).toHaveLength(1);
    },
  );

  it("rejects unsigned or mis-correlated provider events without mutation", async () => {
    const simulator = new PaymentSimulator({
      now: () => "2026-08-16T10:10:00.000Z",
      outcomes: ["succeeded", "indeterminate"],
    });
    const payment = createPaymentLifecycle(
      {
        paymentLifecycleId: "pay-events",
        bookingPriceFils: 60_000_000,
        bookingServiceFeeFils: 5_000_000,
      },
      simulator,
    );
    await payment.authorize();
    const capture = await payment.capture(65_000_000);
    const before = payment.snapshot();
    const correct = simulator.createSignedEvent(capture, {
      eventId: "event-capture-1",
    });

    expect(
      payment.applyProviderEvent({
        ...correct,
        signature: "invalid-signature",
      }),
    ).toEqual({ status: "conflict", reason: "invalid_signature" });
    expect(payment.snapshot()).toEqual(before);

    const mismatches = [
      { provider: "another-provider" },
      { environment: "production" },
      { merchantId: "another-merchant" },
      { terminalId: "another-terminal" },
      { currency: "USD" as const },
      { amountFils: 64_999_000 },
      { paymentLifecycleId: "another-lifecycle" },
      { logicalOperationId: "another-logical-operation" },
      { attemptId: "another-attempt" },
      { providerRequestId: "another-request" },
      { providerReference: "another-provider-reference" },
      { movementReference: "another-movement" },
    ];

    for (const [index, mismatch] of mismatches.entries()) {
      const event = simulator.createSignedEvent(capture, {
        eventId: `event-mismatch-${index}`,
        ...mismatch,
      });
      expect(payment.applyProviderEvent(event)).toMatchObject({
        status: "conflict",
      });
      expect(payment.snapshot()).toEqual(before);
    }

    expect(payment.applyProviderEvent(correct)).toEqual({ status: "applied" });
    expect(payment.snapshot().capture?.status).toBe("succeeded");
    expect(
      payment
        .snapshot()
        .movements.filter((movement) => movement.kind === "capture"),
    ).toHaveLength(1);
  });

  it("rejects a correctly signed event with an unsupported outcome without mutation", async () => {
    const simulator = new PaymentSimulator({
      now: () => "2026-08-16T10:12:00.000Z",
      outcomes: ["succeeded", "indeterminate"],
    });
    const payment = createPaymentLifecycle(
      {
        paymentLifecycleId: "pay-invalid-event-outcome",
        bookingPriceFils: 60_000_000,
        bookingServiceFeeFils: 5_000_000,
      },
      simulator,
    );
    await payment.authorize();
    const capture = await payment.capture(65_000_000);
    const invalidEvent = simulator.createSignedEvent(capture, {
      eventId: "event-invalid-outcome",
      outcome: "bogus" as never,
    });
    const before = payment.snapshot();

    expect(payment.applyProviderEvent(invalidEvent)).toEqual({
      status: "conflict",
      reason: "invalid_event",
    });
    expect(payment.snapshot()).toEqual(before);
  });

  it("keeps simultaneous administrator and dispute holds independent", async () => {
    const simulator = new PaymentSimulator({
      now: () => "2026-08-16T10:15:00.000Z",
      outcomes: ["succeeded", "succeeded", "succeeded", "succeeded"],
    });
    const payment = createPaymentLifecycle(
      {
        paymentLifecycleId: "pay-simultaneous-holds",
        bookingPriceFils: 100_000_000,
        bookingServiceFeeFils: 5_000_000,
      },
      simulator,
    );
    await payment.authorize();
    await payment.capture(105_000_000);
    payment.markBookingCompleted();
    payment.placeAdministratorHold("admin-hold-1");
    payment.openDispute("dispute-1");

    expect(payment.snapshot().holds).toEqual({
      administrator: true,
      dispute: true,
    });
    await expect(payment.settle()).rejects.toThrow("blocked by an active hold");
    expect(simulator.requests).toHaveLength(2);

    await payment.resolveDispute("partial_customer_award", {
      bookingPriceFils: 10_000_000,
      bookingServiceFeeFils: 1_000_000,
    });

    expect(payment.snapshot().holds).toEqual({
      administrator: true,
      dispute: false,
    });
    expect(payment.snapshot().dispute).toMatchObject({
      disputeId: "dispute-1",
      status: "resolved",
      outcome: "partial_customer_award",
    });
    expect(payment.snapshot().financials.ownerEntitlementFils).toBe(81_000_000);
    await expect(payment.settle()).rejects.toThrow("blocked by an active hold");

    payment.clearAdministratorHold("admin-hold-1");
    await payment.settle();
    expect(payment.snapshot().payout).toMatchObject({
      status: "paid",
      paidFils: 81_000_000,
    });
  });

  it.each([
    ["owner_won" as const, 0, 90_000_000],
    ["customer_won" as const, 105_000_000, 0],
  ])(
    "applies the %s terminal dispute outcome",
    async (outcome, expectedRefundFils, expectedOwnerEntitlementFils) => {
      const simulator = new PaymentSimulator({
        now: () => "2026-08-16T10:20:00.000Z",
        outcomes: ["succeeded", "succeeded", "succeeded"],
      });
      const payment = createPaymentLifecycle(
        {
          paymentLifecycleId: `pay-dispute-${outcome}`,
          bookingPriceFils: 100_000_000,
          bookingServiceFeeFils: 5_000_000,
        },
        simulator,
      );
      await payment.authorize();
      await payment.capture(105_000_000);
      payment.openDispute(`dispute-${outcome}`);

      await payment.resolveDispute(outcome);

      const snapshot = payment.snapshot();
      expect(snapshot.dispute).toMatchObject({ status: "resolved", outcome });
      expect(snapshot.holds.dispute).toBe(false);
      expect(
        snapshot.movements
          .filter((movement) => movement.kind === "refund")
          .reduce((total, movement) => total + movement.amountFils, 0),
      ).toBe(expectedRefundFils);
      expect(snapshot.financials.ownerEntitlementFils).toBe(
        expectedOwnerEntitlementFils,
      );
    },
  );

  it("records a late settlement success once and exposes recovery without owner debit", async () => {
    const simulator = new PaymentSimulator({
      now: () => "2026-08-16T10:25:00.000Z",
      outcomes: ["succeeded", "succeeded", "indeterminate", "succeeded"],
      reconciliationOutcomes: ["succeeded"],
    });
    const payment = createPaymentLifecycle(
      {
        paymentLifecycleId: "pay-late-settlement",
        bookingPriceFils: 100_000_000,
        bookingServiceFeeFils: 5_000_000,
      },
      simulator,
    );
    await payment.authorize();
    await payment.capture(105_000_000);
    payment.markBookingCompleted();
    const pendingSettlement = await payment.settle();
    payment.placeAdministratorHold("admin-race-hold");
    payment.openDispute("dispute-race");

    expect(payment.snapshot().payout.status).toBe("blocked");
    await expect(payment.settle()).rejects.toThrow("settlement already exists");
    expect(simulator.requests).toHaveLength(3);

    await payment.reconcile(pendingSettlement.logicalOperationId);

    expect(payment.snapshot().payout).toMatchObject({
      status: "paid",
      paidFils: 90_000_000,
      paidWhileBlocked: true,
      recoveryExposureFils: 90_000_000,
      recoveryBalanceFils: 90_000_000,
      automaticOwnerDebitFils: 0,
    });
    expect(payment.snapshot().audits).toContainEqual({
      kind: "settlement_paid_while_blocked",
      amountFils: 90_000_000,
      logicalOperationId: pendingSettlement.logicalOperationId,
      recordedAt: "2026-08-16T10:25:00.000Z",
    });
    expect(
      payment
        .snapshot()
        .movements.filter((movement) => movement.kind === "settlement"),
    ).toHaveLength(1);

    await payment.resolveDispute("partial_customer_award", {
      bookingPriceFils: 10_000_000,
      bookingServiceFeeFils: 0,
    });
    expect(payment.snapshot().payout).toMatchObject({
      paidFils: 90_000_000,
      recoveryExposureFils: 90_000_000,
      recoveryBalanceFils: 9_000_000,
      automaticOwnerDebitFils: 0,
    });
  });

  it("keeps a definitively failed settlement blocked while a hold remains", async () => {
    const simulator = new PaymentSimulator({
      now: () => "2026-08-16T10:30:00.000Z",
      outcomes: ["succeeded", "succeeded", "indeterminate"],
      reconciliationOutcomes: ["failed"],
      failureRetrySafety: [true],
    });
    const payment = createPaymentLifecycle(
      {
        paymentLifecycleId: "pay-failed-settlement",
        bookingPriceFils: 100_000_000,
        bookingServiceFeeFils: 5_000_000,
      },
      simulator,
    );
    await payment.authorize();
    await payment.capture(105_000_000);
    payment.markBookingCompleted();
    const settlement = await payment.settle();
    payment.placeAdministratorHold("failed-settlement-hold");

    const failed = await payment.reconcile(settlement.logicalOperationId);

    expect(failed.status).toBe("failed");
    expect(payment.snapshot().payout).toMatchObject({
      status: "blocked",
      paidFils: 0,
    });
    expect(
      payment
        .snapshot()
        .movements.filter((movement) => movement.kind === "settlement"),
    ).toHaveLength(0);
    await expect(payment.retry(failed.logicalOperationId)).rejects.toThrow(
      "blocked by an active hold",
    );
    expect(simulator.requests).toHaveLength(3);
  });

  it("keeps lifecycle, logical, attempt, provider request, movement, and event identities distinct", async () => {
    const simulator = new PaymentSimulator({
      now: () => "2026-08-16T10:35:00.000Z",
      outcomes: ["succeeded", "indeterminate", "succeeded"],
    });
    const payment = createPaymentLifecycle(
      {
        paymentLifecycleId: "pay-identity",
        bookingPriceFils: 100_000_000,
        bookingServiceFeeFils: 5_000_000,
      },
      simulator,
    );
    const authorization = await payment.authorize();
    const capture = await payment.capture(105_000_000);
    const firstEvent = simulator.createSignedEvent(capture, {
      eventId: "provider-event-1",
    });

    expect(payment.applyProviderEvent(firstEvent)).toEqual({
      status: "applied",
    });
    expect(payment.applyProviderEvent(firstEvent)).toEqual({
      status: "duplicate",
    });
    expect(
      payment.applyProviderEvent(
        simulator.createSignedEvent(capture, {
          eventId: "provider-event-1",
          outcome: "failed",
        }),
      ),
    ).toEqual({ status: "conflict", reason: "event_id_reused" });
    expect(
      payment.applyProviderEvent(
        simulator.createSignedEvent(capture, {
          eventId: "provider-event-replay",
        }),
      ),
    ).toEqual({ status: "duplicate" });

    const refund = await payment.refund({
      bookingPriceFils: 10_000_000,
      bookingServiceFeeFils: 0,
    });
    const operations = [authorization, payment.snapshot().capture!, refund];
    expect(
      new Set(operations.map((operation) => operation.paymentLifecycleId)),
    ).toEqual(new Set(["pay-identity"]));
    expect(
      new Set(operations.map((operation) => operation.logicalOperationId)),
    ).toHaveLength(3);
    expect(
      new Set(operations.map((operation) => operation.attemptId)),
    ).toHaveLength(3);
    expect(
      new Set(operations.map((operation) => operation.providerRequestId)),
    ).toHaveLength(3);
    expect(
      new Set(
        payment
          .snapshot()
          .movements.map((movement) => movement.movementReference),
      ),
    ).toHaveLength(3);
  });

  it("rejects out-of-order prerequisites and unknown-operation evidence", async () => {
    const simulator = new PaymentSimulator({
      now: () => "2026-08-16T10:40:00.000Z",
      outcomes: ["succeeded", "indeterminate"],
    });
    const payment = createPaymentLifecycle(
      {
        paymentLifecycleId: "pay-ordering",
        bookingPriceFils: 50_000_000,
        bookingServiceFeeFils: 5_000_000,
      },
      simulator,
    );

    await expect(payment.capture(55_000_000)).rejects.toThrow("Authorization");
    await expect(payment.release(55_000_000)).rejects.toThrow("Authorization");
    await expect(
      payment.refund({ bookingPriceFils: 1_000_000, bookingServiceFeeFils: 0 }),
    ).rejects.toThrow("Capture");
    await expect(payment.settle()).rejects.toThrow("Booking Period completion");

    await payment.authorize();
    const capture = await payment.capture(55_000_000);
    const before = payment.snapshot();
    const unknown = simulator.createSignedEvent(capture, {
      eventId: "unknown-operation-event",
      logicalOperationId: "pay-ordering:unknown",
    });
    expect(payment.applyProviderEvent(unknown)).toEqual({
      status: "conflict",
      reason: "unknown_logical_operation",
    });
    expect(payment.snapshot()).toEqual(before);
  });

  it("does not race capture against release while either result is indeterminate", async () => {
    const captureSimulator = new PaymentSimulator({
      now: () => "2026-08-16T10:45:00.000Z",
      outcomes: ["succeeded", "indeterminate"],
    });
    const captureFirst = createPaymentLifecycle(
      {
        paymentLifecycleId: "pay-capture-first",
        bookingPriceFils: 50_000_000,
        bookingServiceFeeFils: 5_000_000,
      },
      captureSimulator,
    );
    await captureFirst.authorize();
    await captureFirst.capture(55_000_000);
    await expect(captureFirst.release(55_000_000)).rejects.toThrow(
      "Capture already exists",
    );
    expect(captureSimulator.requests).toHaveLength(2);

    const releaseSimulator = new PaymentSimulator({
      now: () => "2026-08-16T10:45:00.000Z",
      outcomes: ["succeeded", "indeterminate"],
    });
    const releaseFirst = createPaymentLifecycle(
      {
        paymentLifecycleId: "pay-release-first",
        bookingPriceFils: 50_000_000,
        bookingServiceFeeFils: 5_000_000,
      },
      releaseSimulator,
    );
    await releaseFirst.authorize();
    await releaseFirst.release(55_000_000);
    await expect(releaseFirst.capture(55_000_000)).rejects.toThrow(
      "Release already exists",
    );
    expect(releaseSimulator.requests).toHaveLength(2);
  });

  it("does not retry a failure without an adapter-proven safe rule", async () => {
    const simulator = new PaymentSimulator({
      now: () => "2026-08-16T10:50:00.000Z",
      outcomes: ["succeeded", "failed"],
      failureRetrySafety: [false],
    });
    const payment = createPaymentLifecycle(
      {
        paymentLifecycleId: "pay-unsafe-retry",
        bookingPriceFils: 50_000_000,
        bookingServiceFeeFils: 5_000_000,
      },
      simulator,
    );
    await payment.authorize();
    const failed = await payment.capture(55_000_000);

    expect(failed).toMatchObject({ status: "failed", retrySafe: false });
    await expect(payment.retry(failed.logicalOperationId)).rejects.toThrow(
      "not proven this operation safe to retry",
    );
    expect(simulator.requests).toHaveLength(2);
  });

  it("retries an adapter-proven failed release before allowing capture", async () => {
    const simulator = new PaymentSimulator({
      now: () => "2026-08-16T10:51:00.000Z",
      outcomes: ["succeeded", "failed", "succeeded"],
      failureRetrySafety: [true],
    });
    const payment = createPaymentLifecycle(
      {
        paymentLifecycleId: "pay-safe-release-retry",
        bookingPriceFils: 50_000_000,
        bookingServiceFeeFils: 5_000_000,
      },
      simulator,
    );
    await payment.authorize();
    const failed = await payment.release(55_000_000);

    expect(failed).toMatchObject({ status: "failed", retrySafe: true });
    await expect(payment.capture(55_000_000)).rejects.toThrow(
      "must be retried",
    );
    const retried = await payment.retry(failed.logicalOperationId);
    expect(retried).toMatchObject({
      status: "succeeded",
      attemptId: "pay-safe-release-retry:release:attempt-3",
    });
    expect(simulator.requests.map((request) => request.kind)).toEqual([
      "authorization",
      "release",
      "release",
    ]);
  });

  it("fails closed when the simulator has no configured operation outcome", async () => {
    const simulator = new PaymentSimulator({
      now: () => "2026-08-16T10:52:00.000Z",
    });
    const payment = createPaymentLifecycle(
      {
        paymentLifecycleId: "pay-missing-simulator-outcome",
        bookingPriceFils: 50_000_000,
        bookingServiceFeeFils: 5_000_000,
      },
      simulator,
    );

    const authorization = await payment.authorize();

    expect(authorization).toMatchObject({
      status: "pending",
      reconciliationRequired: true,
      retrySafe: false,
    });
    expect(payment.snapshot().movements).toHaveLength(0);
  });

  it("requires an explicit provider-safe rule for a simulator failure", async () => {
    const simulator = new PaymentSimulator({
      now: () => "2026-08-16T10:53:00.000Z",
      outcomes: ["succeeded", "failed"],
    });
    const payment = createPaymentLifecycle(
      {
        paymentLifecycleId: "pay-missing-simulator-retry-rule",
        bookingPriceFils: 50_000_000,
        bookingServiceFeeFils: 5_000_000,
      },
      simulator,
    );
    await payment.authorize();

    const capture = await payment.capture(55_000_000);

    expect(capture).toMatchObject({ status: "failed", retrySafe: false });
    await expect(payment.retry(capture.logicalOperationId)).rejects.toThrow(
      "not proven this operation safe to retry",
    );
    expect(simulator.requests).toHaveLength(2);
  });

  it("applies an indeterminate refund allocation only after reconciliation succeeds", async () => {
    const simulator = new PaymentSimulator({
      now: () => "2026-08-16T10:55:00.000Z",
      outcomes: ["succeeded", "succeeded", "indeterminate"],
      reconciliationOutcomes: ["succeeded"],
    });
    const payment = createPaymentLifecycle(
      {
        paymentLifecycleId: "pay-refund-reconciliation",
        bookingPriceFils: 100_000_000,
        bookingServiceFeeFils: 5_000_000,
      },
      simulator,
    );
    await payment.authorize();
    await payment.capture(105_000_000);
    const pendingRefund = await payment.refund({
      bookingPriceFils: 10_000_000,
      bookingServiceFeeFils: 1_000_000,
    });

    expect(payment.snapshot().refunds[0]?.status).toBe("pending");
    expect(payment.snapshot().financials.refundedBookingPriceFils).toBe(0);

    await payment.reconcile(pendingRefund.logicalOperationId);

    expect(payment.snapshot().refunds[0]?.status).toBe("succeeded");
    expect(payment.snapshot().financials).toMatchObject({
      refundedBookingPriceFils: 10_000_000,
      refundedBookingServiceFeeFils: 1_000_000,
      ownerEntitlementFils: 81_000_000,
    });
    expect(
      payment
        .snapshot()
        .movements.filter((movement) => movement.kind === "refund"),
    ).toHaveLength(1);
  });

  it("reserves full Booking Price capacity before concurrent refund provider calls", async () => {
    const simulator = new PaymentSimulator({
      now: () => "2026-08-16T10:55:30.000Z",
      outcomes: ["succeeded", "succeeded", "succeeded"],
    });
    const payment = createPaymentLifecycle(
      {
        paymentLifecycleId: "pay-concurrent-full-refund",
        bookingPriceFils: 100_000_000,
        bookingServiceFeeFils: 5_000_000,
      },
      simulator,
    );
    await payment.authorize();
    await payment.capture(105_000_000);

    const results = await Promise.allSettled([
      payment.refund({
        bookingPriceFils: 100_000_000,
        bookingServiceFeeFils: 0,
      }),
      payment.refund({
        bookingPriceFils: 100_000_000,
        bookingServiceFeeFils: 0,
      }),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(simulator.requests).toHaveLength(3);
    expect(payment.snapshot().refunds).toHaveLength(1);
    expect(payment.snapshot().financials).toMatchObject({
      refundedBookingPriceFils: 100_000_000,
      remainingBookingPriceFils: 0,
    });
    expect(
      payment
        .snapshot()
        .movements.filter((movement) => movement.kind === "refund"),
    ).toHaveLength(1);
  });

  it("assigns distinct logical identities to concurrent refunds that both fit", async () => {
    const simulator = new PaymentSimulator({
      now: () => "2026-08-16T10:55:45.000Z",
      outcomes: ["succeeded", "succeeded", "succeeded", "succeeded"],
    });
    const payment = createPaymentLifecycle(
      {
        paymentLifecycleId: "pay-concurrent-fitting-refunds",
        bookingPriceFils: 100_000_000,
        bookingServiceFeeFils: 5_000_000,
      },
      simulator,
    );
    await payment.authorize();
    await payment.capture(105_000_000);

    const refunds = await Promise.all([
      payment.refund({
        bookingPriceFils: 30_000_000,
        bookingServiceFeeFils: 0,
      }),
      payment.refund({
        bookingPriceFils: 40_000_000,
        bookingServiceFeeFils: 0,
      }),
    ]);

    expect(
      new Set(refunds.map((refund) => refund.logicalOperationId)),
    ).toHaveLength(2);
    expect(payment.snapshot().refunds).toHaveLength(2);
    expect(payment.snapshot().financials).toMatchObject({
      refundedBookingPriceFils: 70_000_000,
      remainingBookingPriceFils: 30_000_000,
    });
    expect(
      payment
        .snapshot()
        .movements.filter((movement) => movement.kind === "refund"),
    ).toHaveLength(2);
  });

  it("counts an indeterminate refund reservation before accepting another refund", async () => {
    const simulator = new PaymentSimulator({
      now: () => "2026-08-16T10:56:00.000Z",
      outcomes: ["succeeded", "succeeded", "indeterminate"],
      reconciliationOutcomes: ["succeeded"],
    });
    const payment = createPaymentLifecycle(
      {
        paymentLifecycleId: "pay-pending-refund-capacity",
        bookingPriceFils: 100_000_000,
        bookingServiceFeeFils: 5_000_000,
      },
      simulator,
    );
    await payment.authorize();
    await payment.capture(105_000_000);
    const pending = await payment.refund({
      bookingPriceFils: 60_000_000,
      bookingServiceFeeFils: 0,
    });

    await expect(
      payment.refund({
        bookingPriceFils: 50_000_000,
        bookingServiceFeeFils: 0,
      }),
    ).rejects.toThrow("exceeds the remaining Booking Price");
    expect(simulator.requests).toHaveLength(3);
    expect(payment.snapshot().financials.refundedBookingPriceFils).toBe(0);

    await payment.reconcile(pending.logicalOperationId);

    expect(payment.snapshot().financials).toMatchObject({
      refundedBookingPriceFils: 60_000_000,
      remainingBookingPriceFils: 40_000_000,
    });
    expect(
      payment
        .snapshot()
        .movements.filter((movement) => movement.kind === "refund"),
    ).toHaveLength(1);
  });

  it("reserves pending Booking Price and Service Fee capacity independently", async () => {
    const simulator = new PaymentSimulator({
      now: () => "2026-08-16T10:56:15.000Z",
      outcomes: ["succeeded", "succeeded", "indeterminate"],
    });
    const payment = createPaymentLifecycle(
      {
        paymentLifecycleId: "pay-pending-component-capacity",
        bookingPriceFils: 100_000_000,
        bookingServiceFeeFils: 5_000_000,
      },
      simulator,
    );
    await payment.authorize();
    await payment.capture(105_000_000);
    await payment.refund({
      bookingPriceFils: 60_000_000,
      bookingServiceFeeFils: 3_000_000,
    });

    await expect(
      payment.refund({
        bookingPriceFils: 50_000_000,
        bookingServiceFeeFils: 0,
      }),
    ).rejects.toThrow("exceeds the remaining Booking Price");
    await expect(
      payment.refund({
        bookingPriceFils: 0,
        bookingServiceFeeFils: 3_000_000,
      }),
    ).rejects.toThrow("exceeds the remaining Booking Service Fee");
    expect(simulator.requests).toHaveLength(3);
    expect(payment.snapshot().refunds).toHaveLength(1);
  });

  it("rejects a dispute refund that exceeds capacity reserved by a pending public refund", async () => {
    const simulator = new PaymentSimulator({
      now: () => "2026-08-16T10:56:30.000Z",
      outcomes: ["succeeded", "succeeded", "indeterminate"],
    });
    const payment = createPaymentLifecycle(
      {
        paymentLifecycleId: "pay-dispute-pending-refund-capacity",
        bookingPriceFils: 100_000_000,
        bookingServiceFeeFils: 5_000_000,
      },
      simulator,
    );
    await payment.authorize();
    await payment.capture(105_000_000);
    await payment.refund({
      bookingPriceFils: 60_000_000,
      bookingServiceFeeFils: 0,
    });
    payment.openDispute("dispute-pending-refund-capacity");

    await expect(
      payment.resolveDispute("partial_customer_award", {
        bookingPriceFils: 50_000_000,
        bookingServiceFeeFils: 0,
      }),
    ).rejects.toThrow("exceeds the remaining Booking Price");
    expect(simulator.requests).toHaveLength(3);
    expect(payment.snapshot().refunds).toHaveLength(1);
    expect(payment.snapshot().dispute).toMatchObject({
      status: "open",
      outcome: null,
      refundLogicalOperationId: null,
    });
  });

  it("binds one refund operation to a dispute through reconciliation and duplicate resolution calls", async () => {
    const simulator = new PaymentSimulator({
      now: () => "2026-08-16T10:57:00.000Z",
      outcomes: ["succeeded", "succeeded", "indeterminate"],
      reconciliationOutcomes: ["succeeded"],
    });
    const payment = createPaymentLifecycle(
      {
        paymentLifecycleId: "pay-dispute-refund-reconciliation",
        bookingPriceFils: 100_000_000,
        bookingServiceFeeFils: 5_000_000,
      },
      simulator,
    );
    const allocation = {
      bookingPriceFils: 10_000_000,
      bookingServiceFeeFils: 1_000_000,
    };
    await payment.authorize();
    await payment.capture(105_000_000);
    payment.openDispute("dispute-refund-reconciliation");

    const pending = await payment.resolveDispute(
      "partial_customer_award",
      allocation,
    );
    const duplicatePending = await payment.resolveDispute(
      "partial_customer_award",
      allocation,
    );

    expect(pending).toMatchObject({ status: "pending", kind: "refund" });
    expect(duplicatePending).toEqual(pending);
    expect(payment.snapshot().dispute).toEqual({
      disputeId: "dispute-refund-reconciliation",
      status: "resolving",
      outcome: "partial_customer_award",
      refundAllocation: allocation,
      refundLogicalOperationId: pending?.logicalOperationId,
    });
    expect(() => payment.openDispute("replacement-dispute")).toThrow(
      "already open",
    );
    expect(simulator.requests).toHaveLength(3);

    await payment.reconcile(pending!.logicalOperationId);
    const duplicateResolved = await payment.resolveDispute(
      "partial_customer_award",
      allocation,
    );

    expect(duplicateResolved).toEqual(payment.snapshot().refunds[0]);
    expect(payment.snapshot().dispute).toMatchObject({
      status: "resolved",
      outcome: "partial_customer_award",
      refundLogicalOperationId: pending?.logicalOperationId,
    });
    expect(payment.snapshot().holds.dispute).toBe(false);
    expect(simulator.requests).toHaveLength(3);
    expect(simulator.queries).toHaveLength(1);
    expect(
      payment
        .snapshot()
        .movements.filter((movement) => movement.kind === "refund"),
    ).toHaveLength(1);

    await expect(
      payment.resolveDispute("partial_customer_award", {
        ...allocation,
        bookingServiceFeeFils: 0,
      }),
    ).rejects.toThrow("does not match the bound outcome");
    expect(simulator.requests).toHaveLength(3);
  });

  it("binds concurrent identical dispute resolutions to one provider refund", async () => {
    const simulator = new PaymentSimulator({
      now: () => "2026-08-16T10:58:00.000Z",
      outcomes: ["succeeded", "succeeded", "succeeded"],
    });
    const payment = createPaymentLifecycle(
      {
        paymentLifecycleId: "pay-concurrent-dispute-refund",
        bookingPriceFils: 100_000_000,
        bookingServiceFeeFils: 5_000_000,
      },
      simulator,
    );
    const allocation = {
      bookingPriceFils: 10_000_000,
      bookingServiceFeeFils: 1_000_000,
    };
    await payment.authorize();
    await payment.capture(105_000_000);
    payment.openDispute("concurrent-dispute-refund");

    const [first, duplicate] = await Promise.all([
      payment.resolveDispute("partial_customer_award", allocation),
      payment.resolveDispute("partial_customer_award", allocation),
    ]);

    expect(first?.logicalOperationId).toBe(duplicate?.logicalOperationId);
    expect(payment.snapshot().refunds).toHaveLength(1);
    expect(
      new Set(
        payment.snapshot().refunds.map((refund) => refund.logicalOperationId),
      ),
    ).toHaveLength(1);
    expect(simulator.requests).toHaveLength(3);
    expect(
      payment
        .snapshot()
        .movements.filter((movement) => movement.kind === "refund"),
    ).toHaveLength(1);
    expect(payment.snapshot().dispute).toMatchObject({
      status: "resolved",
      refundLogicalOperationId: first?.logicalOperationId,
    });
  });

  it("fails closed when concurrent dispute resolutions conflict", async () => {
    const simulator = new PaymentSimulator({
      now: () => "2026-08-16T10:59:00.000Z",
      outcomes: ["succeeded", "succeeded", "succeeded"],
    });
    const payment = createPaymentLifecycle(
      {
        paymentLifecycleId: "pay-conflicting-concurrent-dispute",
        bookingPriceFils: 100_000_000,
        bookingServiceFeeFils: 5_000_000,
      },
      simulator,
    );
    await payment.authorize();
    await payment.capture(105_000_000);
    payment.openDispute("conflicting-concurrent-dispute");

    const firstResolution = payment.resolveDispute("partial_customer_award", {
      bookingPriceFils: 10_000_000,
      bookingServiceFeeFils: 1_000_000,
    });
    await expect(payment.resolveDispute("customer_won")).rejects.toThrow(
      "does not match the bound outcome",
    );
    await firstResolution;

    expect(payment.snapshot().refunds).toHaveLength(1);
    expect(simulator.requests).toHaveLength(3);
    expect(
      payment
        .snapshot()
        .movements.filter((movement) => movement.kind === "refund"),
    ).toHaveLength(1);
  });

  it.each([
    {
      name: "provider request",
      providerRequestIds: [
        "reused-provider-request",
        "reused-provider-request",
      ],
      movementReferences: ["movement-auth", "movement-capture"],
      expectedReason: "provider_request_identity_conflict",
    },
    {
      name: "movement",
      providerRequestIds: ["provider-request-auth", "provider-request-capture"],
      movementReferences: ["reused-movement", "reused-movement"],
      expectedReason: "movement_identity_conflict",
    },
  ])(
    "fails closed and remains reconcilable when a direct adapter result reuses a $name identity",
    async ({ providerRequestIds, movementReferences, expectedReason }) => {
      const simulator = new PaymentSimulator({
        now: () => "2026-08-16T11:00:00.000Z",
        outcomes: ["succeeded", "succeeded"],
        reconciliationOutcomes: ["succeeded"],
        providerRequestIds,
        movementReferences,
      });
      const payment = createPaymentLifecycle(
        {
          paymentLifecycleId: `pay-${expectedReason}`,
          bookingPriceFils: 50_000_000,
          bookingServiceFeeFils: 5_000_000,
        },
        simulator,
      );
      await payment.authorize();

      await expect(payment.capture(55_000_000)).rejects.toThrow(expectedReason);
      const conflictedCapture = payment.snapshot().capture!;
      expect(conflictedCapture).toMatchObject({
        status: "pending",
        providerRequestId: null,
        providerReference: null,
        movementReference: null,
        reconciliationRequired: true,
      });
      expect(
        payment
          .snapshot()
          .movements.filter((movement) => movement.kind === "capture"),
      ).toHaveLength(0);

      const reconciled = await payment.reconcile(
        conflictedCapture.logicalOperationId,
      );

      expect(reconciled).toMatchObject({
        status: "succeeded",
        attemptId: conflictedCapture.attemptId,
        reconciliationRequired: false,
      });
      expect(simulator.queries).toHaveLength(1);
      expect(
        payment
          .snapshot()
          .movements.filter((movement) => movement.kind === "capture"),
      ).toHaveLength(1);
    },
  );
});
