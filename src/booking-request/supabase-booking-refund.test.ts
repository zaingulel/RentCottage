import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseBookingRefundRepository } from "./supabase-booking-refund";
const bookingRequestId = "60000000-0000-4000-8000-000000001001";
const intentId = "90000000-0000-4000-8000-000000003810";
const facts = {
  bookingRequestId,
  captureOperationId: "80000000-0000-4000-8000-000000001001",
  revision: "a".repeat(32),
  captured: { bookingPriceFils: 110000000, bookingServiceFeeFils: 5000000 },
  obligation: { bookingPriceFils: 110000000, bookingServiceFeeFils: 5000000 },
  refunded: { bookingPriceFils: 30000000, bookingServiceFeeFils: 1000000 },
  reserved: { bookingPriceFils: 20000000, bookingServiceFeeFils: 1000000 },
  intents: [{ id: intentId, automatic: false, state: "unknown" }],
};
function fixture(data: unknown) {
  const rpc = vi.fn().mockResolvedValue({ data, error: null });
  return {
    rpc,
    repository: new SupabaseBookingRefundRepository({
      rpc,
    } as unknown as SupabaseClient),
  };
}
describe("durable refund repository", () => {
  it("retains explicit original, returned and reserved components", async () => {
    const test = fixture(facts);
    expect(await test.repository.facts(bookingRequestId)).toEqual(facts);
    expect(test.rpc).toHaveBeenCalledWith("get_booking_refund_facts", {
      target_booking_request_id: bookingRequestId,
    });
  });
  it.each([
    { ...facts, bookingRequestId: intentId },
    { ...facts, refunded: facts.captured },
    { ...facts, intents: [...facts.intents, ...facts.intents] },
    { ...facts, intents: [{ ...facts.intents[0], state: "returned-maybe" }] },
  ])("rejects malformed or misbound refund facts", async (value) => {
    await expect(
      fixture(value).repository.facts(bookingRequestId),
    ).rejects.toThrow();
  });
  it("sends a reason and explicit components with the administrator command identity", async () => {
    const test = fixture({ status: "requested", intentId });
    const command = {
      bookingRequestId,
      commandId: intentId,
      reason: "Partial service compensation",
      allocation: {
        bookingPriceFils: 30000000,
        bookingServiceFeeFils: 1000000,
      },
    };
    expect(await test.repository.requestException(command)).toEqual({
      status: "requested",
      intentId,
    });
    expect(test.rpc).toHaveBeenCalledWith("request_booking_refund_exception", {
      target_booking_request_id: bookingRequestId,
      target_command_id: intentId,
      target_reason: command.reason,
      target_allocation: command.allocation,
    });
  });
  it("preserves stale automatic selection instead of implying a reservation", async () => {
    expect(
      await fixture({ status: "stale" }).repository.requestAutomatic(
        bookingRequestId,
        "revision",
        facts.obligation,
      ),
    ).toEqual({ status: "stale" });
  });
  it("rejects an unbound claimed operation", async () => {
    await expect(
      fixture({
        status: "execute",
        request: { kind: "refund", amountFils: 1 },
      }).repository.claim(intentId),
    ).rejects.toThrow();
  });
});

it("claims a bounded due batch through the explicit scheduling RPC", async () => {
  const test = fixture([bookingRequestId]);
  expect(await test.repository.claimDue(50)).toEqual([bookingRequestId]);
  expect(test.rpc).toHaveBeenCalledExactlyOnceWith(
    "claim_due_booking_refunds",
    { target_limit: 50 },
  );
});
it.each([
  { data: [bookingRequestId, bookingRequestId] },
  { data: ["invalid"] },
  { data: null },
])("rejects malformed claimed batches %j", async ({ data }) => {
  await expect(fixture(data).repository.claimDue(1)).rejects.toThrow();
});
