import { describe, expect, it, vi } from "vitest";
import {
  createBookingPayout,
  createBookingSettlement,
  selectBookingSettlement,
  type BookingPayoutFacts,
  type BookingSettlementFacts,
} from "./booking-payout";
const bookingRequestId = "60000000-0000-4000-8000-000000001001";
const command = {
  bookingRequestId,
  commandId: "90000000-0000-4000-8000-000000002273",
  action: "resolve_dispute" as const,
  subjectId: "90000000-0000-4000-8000-000000002271",
  reason: "Provider decision",
  outcome: "customer_won" as const,
};
describe("persisted booking payout commands", () => {
  it("selects the full remaining customer award without reducing the original paid allocation", async () => {
    const facts: BookingPayoutFacts = {
      bookingRequestId,
      commands: [],
      reserved: { bookingPriceFils: 0, bookingServiceFeeFils: 0 },
      activeHoldIds: [],
      activeDisputeIds: [],
      disputes: [],
      captured: { bookingPriceFils: 100000000, bookingServiceFeeFils: 5000000 },
      refunded: { bookingPriceFils: 10000000, bookingServiceFeeFils: 0 },
    };
    const repository = {
      facts: vi.fn().mockResolvedValue(facts),
      record: vi.fn().mockResolvedValue({ status: "recorded" }),
    };
    await createBookingPayout(repository).record(command);
    expect(repository.record).toHaveBeenCalledWith({
      ...command,
      allocation: {
        bookingPriceFils: 90000000,
        bookingServiceFeeFils: 5000000,
      },
    });
    expect(facts.captured).toEqual({
      bookingPriceFils: 100000000,
      bookingServiceFeeFils: 5000000,
    });
  });
  it("refuses to select a full award from another booking", async () => {
    const repository = {
      facts: vi.fn().mockResolvedValue({ bookingRequestId: "foreign" }),
      record: vi.fn(),
    };
    await expect(
      createBookingPayout(repository).record(command),
    ).rejects.toThrow("another booking");
    expect(repository.record).not.toHaveBeenCalled();
  });
});

const settlementFacts: BookingSettlementFacts = {
  bookingRequestId,
  revision: "a".repeat(32),
  recovery: { status: "unsettled" },
  captured: { bookingPriceFils: 100000000, bookingServiceFeeFils: 5000000 },
  refunded: { bookingPriceFils: 0, bookingServiceFeeFils: 0 },
  reserved: { bookingPriceFils: 0, bookingServiceFeeFils: 0 },
  commands: [],
  activeHoldIds: [],
  activeDisputeIds: [],
  disputes: [],
  intents: [],
  settlement: null,
  maturity: {
    status: "completed",
    effectivePeriodEnd: "2026-09-10T12:00:00Z",
    assessedAt: "2026-09-12T12:00:00Z",
    reviewExpiresAt: null,
    reviewAvailable: true,
    payoutPrerequisiteAt: "2026-09-11T12:00:00Z",
    payoutPrerequisiteAvailable: true,
  },
};
describe("settlement selection", () => {
  it("requires authoritative maturity before requesting settlement", async () => {
    const repository = {
      facts: vi.fn().mockResolvedValue({
        ...settlementFacts,
        maturity: {
          status: "unavailable",
          reviewAvailable: false,
          payoutPrerequisiteAvailable: false,
        },
      }),
      request: vi.fn(),
      claim: vi.fn(),
    };
    expect(
      await createBookingSettlement({
        repository,
        operations: { execute: vi.fn(), query: vi.fn() },
      }).settle({
        bookingRequestId,
        commandId: command.commandId,
        reason: "Review",
      }),
    ).toEqual({ status: "blocked" });
    expect(repository.request).not.toHaveBeenCalled();
  });
  it("pays 90m of a 100m booking price and preserves the 5m service fee", () => {
    expect(selectBookingSettlement(settlementFacts)).toEqual({
      action: "request",
      amountFils: 90000000,
    });
    expect(
      selectBookingSettlement({
        ...settlementFacts,
        refunded: {
          bookingPriceFils: 10000000,
          bookingServiceFeeFils: 5000000,
        },
      }),
    ).toEqual({ action: "request", amountFils: 81000000 });
  });
  it.each([
    { activeHoldIds: [command.commandId] },
    { activeDisputeIds: [command.commandId] },
    { reserved: { bookingPriceFils: 0, bookingServiceFeeFils: 1 } },
    {
      intents: [
        { id: command.commandId, automatic: false, state: "unknown" as const },
      ],
    },
  ])("blocks new settlement for unresolved facts %j", (change) => {
    expect(selectBookingSettlement({ ...settlementFacts, ...change })).toEqual({
      action: "blocked",
    });
  });
  it("requires attention for a failed refund and stale settlement amount", () => {
    expect(
      selectBookingSettlement({
        ...settlementFacts,
        intents: [{ id: command.commandId, automatic: false, state: "failed" }],
      }),
    ).toEqual({ action: "attention-required" });
    expect(
      selectBookingSettlement({
        ...settlementFacts,
        settlement: {
          id: command.commandId,
          commandId: "90000000-0000-4000-8000-000000002280",
          amountFils: 99000000,
          actorUserId: command.commandId,
          reason: "Review",
          requestedAt: "2026-09-12T12:00:00Z",
          receipt: null,
          state: "not-executed",
          retrySafe: false,
        },
      }),
    ).toEqual({ action: "attention-required" });
  });
  it("validates original command content again when a settled command is replayed", async () => {
    const repository = {
      facts: vi.fn().mockResolvedValue({
        ...settlementFacts,
        settlement: {
          id: command.commandId,
          commandId: command.commandId,
          amountFils: 90000000,
          state: "succeeded",
          retrySafe: false,
        },
      }),
      request: vi
        .fn()
        .mockRejectedValue(new Error("Settlement command identity was reused")),
      claim: vi.fn(),
    };
    await expect(
      createBookingSettlement({
        repository,
        operations: { execute: vi.fn(), query: vi.fn() },
      }).settle({
        bookingRequestId,
        commandId: command.commandId,
        reason: "Changed reason",
      }),
    ).rejects.toThrow("identity was reused");
    expect(repository.claim).not.toHaveBeenCalled();
  });
  it("queries an uncertain admitted settlement even after a hold arrives", async () => {
    const query = {
      kind: "settlement" as const,
      paymentLifecycleId: command.commandId,
      logicalOperationId: "settlement",
      attemptId: "physical",
      amountFils: 90000000,
      currency: "IQD" as const,
      providerRequestId: null,
      providerReference: null,
    };
    const repository = {
      facts: vi.fn().mockResolvedValue({
        ...settlementFacts,
        activeHoldIds: [command.commandId],
        settlement: {
          id: command.commandId,
          commandId: "90000000-0000-4000-8000-000000002280",
          amountFils: 90000000,
          state: "indeterminate",
          retrySafe: false,
        },
      }),
      request: vi.fn(),
      claim: vi.fn().mockResolvedValue({ status: "query", query }),
    };
    const operations = {
      execute: vi.fn(),
      query: vi.fn().mockResolvedValue({ status: "unavailable" }),
    };
    expect(
      await createBookingSettlement({ repository, operations }).settle({
        bookingRequestId,
        commandId: command.commandId,
        reason: "Check",
      }),
    ).toEqual({ status: "processing" });
    expect(operations.query).toHaveBeenCalledExactlyOnceWith(query);
    expect(operations.execute).not.toHaveBeenCalled();
    expect(repository.request).not.toHaveBeenCalled();
  });
});
