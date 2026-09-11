import { describe, expect, it, vi } from "vitest";
import {
  createBookingRefund,
  selectBookingRefund,
  type BookingRefundFacts,
} from "./booking-refund";

const facts: BookingRefundFacts = {
  bookingRequestId: "booking",
  revision: "revision",
  captured: { bookingPriceFils: 100_000, bookingServiceFeeFils: 5_000 },
  obligation: { bookingPriceFils: 100_000, bookingServiceFeeFils: 5_000 },
  refunded: { bookingPriceFils: 0, bookingServiceFeeFils: 0 },
  reserved: { bookingPriceFils: 0, bookingServiceFeeFils: 0 },
  intents: [],
};
describe("booking refund selection", () => {
  it("tops up the full original obligation after an explicitly allocated partial refund", () => {
    expect(
      selectBookingRefund({
        ...facts,
        refunded: { bookingPriceFils: 25_000, bookingServiceFeeFils: 1_000 },
      }),
    ).toEqual({
      action: "request",
      allocation: { bookingPriceFils: 75_000, bookingServiceFeeFils: 4_000 },
    });
  });
  it("reconciles an unknown partial refund before deciding a full top-up", () => {
    expect(
      selectBookingRefund({
        ...facts,
        reserved: { bookingPriceFils: 25_000, bookingServiceFeeFils: 1_000 },
        intents: [{ id: "partial", automatic: false, state: "unknown" }],
      }),
    ).toEqual({ action: "process", intentId: "partial" });
  });
  it("preserves the independent full obligation while prior partial uncertainty resolves", () => {
    const original = {
      bookingPriceFils: 110_000_000,
      bookingServiceFeeFils: 5_000_000,
    };
    const partial = {
      ...facts,
      captured: original,
      obligation: original,
      refunded: {
        bookingPriceFils: 30_000_000,
        bookingServiceFeeFils: 1_000_000,
      },
      reserved: {
        bookingPriceFils: 20_000_000,
        bookingServiceFeeFils: 1_000_000,
      },
      intents: [{ id: "partial", automatic: false, state: "unknown" as const }],
    };
    expect(selectBookingRefund(partial)).toEqual({
      action: "process",
      intentId: "partial",
    });
    expect(
      selectBookingRefund({
        ...partial,
        reserved: facts.reserved,
        refunded: {
          bookingPriceFils: 50_000_000,
          bookingServiceFeeFils: 2_000_000,
        },
        intents: [{ id: "partial", automatic: false, state: "succeeded" }],
      }),
    ).toEqual({
      action: "request",
      allocation: {
        bookingPriceFils: 60_000_000,
        bookingServiceFeeFils: 3_000_000,
      },
    });
    expect(
      selectBookingRefund({
        ...partial,
        reserved: facts.reserved,
        intents: [{ id: "partial", automatic: false, state: "failed" }],
      }),
    ).toEqual({
      action: "request",
      allocation: {
        bookingPriceFils: 80_000_000,
        bookingServiceFeeFils: 4_000_000,
      },
    });
    expect(partial.obligation).toEqual(original);
    expect(partial.captured).toEqual(original);
  });
  it("processes an administrator exception even when automatic policy owes zero", () => {
    expect(
      selectBookingRefund({
        ...facts,
        obligation: { bookingPriceFils: 0, bookingServiceFeeFils: 0 },
        intents: [{ id: "exception", automatic: false, state: "requested" }],
      }),
    ).toEqual({ action: "process", intentId: "exception" });
  });
  it("reports verified returned components separately from the original obligation", () => {
    expect(selectBookingRefund({ ...facts, refunded: facts.captured })).toEqual(
      { action: "settled" },
    );
  });
  it("retains failed audit without marking a fully returned capture unsettled", () => {
    expect(
      selectBookingRefund({
        ...facts,
        obligation: facts.reserved,
        refunded: facts.captured,
        intents: [{ id: "prior", state: "failed", automatic: false }],
      }),
    ).toEqual({ action: "settled" });
  });
  it("requires attention after a failed attempt without pretending that the obligation vanished", () => {
    expect(
      selectBookingRefund({
        ...facts,
        intents: [{ id: "failed", state: "failed", automatic: true }],
      }),
    ).toEqual({ action: "attention-required" });
  });
  it("does not treat an unexplained reservation as available money", () => {
    expect(
      selectBookingRefund({
        ...facts,
        reserved: { bookingPriceFils: 25_000, bookingServiceFeeFils: 1_000 },
      }),
    ).toEqual({ action: "attention-required" });
  });
});
describe("booking refund application", () => {
  it("re-reads authoritative facts after a concurrent reservation invalidates the selected top-up", async () => {
    const repository = {
      facts: vi
        .fn()
        .mockResolvedValueOnce(facts)
        .mockResolvedValue({ ...facts, refunded: facts.captured }),
      requestAutomatic: vi.fn().mockResolvedValue({ status: "stale" }),
      claim: vi.fn(),
      due: vi.fn(),
    };
    const operations = { execute: vi.fn(), query: vi.fn() };
    expect(
      await createBookingRefund({ repository, operations }).resume("booking"),
    ).toEqual({ status: "settled" });
    expect(repository.requestAutomatic).toHaveBeenCalledWith(
      "booking",
      "revision",
      facts.captured,
    );
    expect(operations.execute).not.toHaveBeenCalled();
  });
  it("queries an already admitted attempt after interruption and never executes a fresh identity", async () => {
    const query = {
      kind: "refund" as const,
      paymentLifecycleId: "capture-lifecycle",
      logicalOperationId: "refund",
      attemptId: "refund:1",
      amountFils: 26_000,
      currency: "IQD" as const,
      providerRequestId: null,
      providerReference: null,
    };
    const repository = {
      facts: vi.fn().mockResolvedValue({
        ...facts,
        intents: [{ id: "partial", automatic: false, state: "unknown" }],
        reserved: { bookingPriceFils: 25_000, bookingServiceFeeFils: 1_000 },
      }),
      requestAutomatic: vi.fn(),
      claim: vi.fn().mockResolvedValue({ status: "query", query }),
      due: vi.fn(),
    };
    const operations = {
      execute: vi.fn(),
      query: vi.fn().mockResolvedValue({ status: "unavailable" }),
    };
    expect(
      await createBookingRefund({ repository, operations }).resume("booking"),
    ).toEqual({ status: "processing" });
    expect(operations.query).toHaveBeenCalledWith(query);
    expect(operations.execute).not.toHaveBeenCalled();
    expect(repository.requestAutomatic).not.toHaveBeenCalled();
  });
  it("rejects misbound facts before selecting any refund", async () => {
    const repository = {
      facts: vi.fn().mockResolvedValue({ ...facts, bookingRequestId: "other" }),
      requestAutomatic: vi.fn(),
      claim: vi.fn(),
      due: vi.fn(),
    };
    await expect(
      createBookingRefund({
        repository,
        operations: { execute: vi.fn(), query: vi.fn() },
      }).resume("booking"),
    ).rejects.toThrow("another booking");
    expect(repository.requestAutomatic).not.toHaveBeenCalled();
  });
});
