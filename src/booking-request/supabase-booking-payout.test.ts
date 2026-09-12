import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  parseBookingPayoutFacts,
  SupabaseBookingPayoutRepository,
} from "./supabase-booking-payout";
const bookingRequestId = "60000000-0000-4000-8000-000000001001";
const hold = "90000000-0000-4000-8000-000000002270",
  dispute = "90000000-0000-4000-8000-000000002271";
const zero = { bookingPriceFils: 0, bookingServiceFeeFils: 0 };
const command = {
  commandId: hold,
  action: "place_hold",
  subjectId: null,
  outcome: null,
  allocation: null,
  actorUserId: "10000000-0000-4000-8000-000000003801",
  reason: "Private reason",
  occurredAt: "2026-09-12T12:00:00Z",
};
const facts = {
  bookingRequestId,
  captured: { bookingPriceFils: 100000000, bookingServiceFeeFils: 5000000 },
  refunded: zero,
  reserved: zero,
  commands: [
    command,
    { ...command, commandId: dispute, action: "open_dispute" },
  ],
  activeHoldIds: [hold],
  activeDisputeIds: [dispute],
  disputes: [
    { id: dispute, resolutionId: null, refundIntentId: null, state: "open" },
  ],
};
describe("payout evidence adapter", () => {
  it("fresh adapters reproduce independent attributed holds without raw provider payloads", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({
        data: {
          ...facts,
          providerReference: "private-correlation",
          rawObservation: { secret: true },
        },
        error: null,
      });
    const client = { rpc } as unknown as SupabaseClient;
    const first = await new SupabaseBookingPayoutRepository(client).facts(
      bookingRequestId,
    );
    const restarted = await new SupabaseBookingPayoutRepository(client).facts(
      bookingRequestId,
    );
    expect(first).toEqual(facts);
    expect(restarted).toEqual(first);
    expect(first).not.toHaveProperty("providerReference");
    expect(first).not.toHaveProperty("rawObservation");
  });
  it.each([
    { bookingRequestId: "foreign" },
    { commands: [] },
    { activeHoldIds: [] },
    { activeDisputeIds: [] },
    { disputes: [{ ...facts.disputes[0], state: "resolved" }] },
    { commands: [{ ...command, actorUserId: undefined }, facts.commands[1]] },
    { commands: [command, command, facts.commands[1]] },
    { refunded: { bookingPriceFils: 100000010, bookingServiceFeeFils: 0 } },
  ])(
    "fails closed for incomplete or conflicting financial evidence %j",
    (change) => {
      expect(() =>
        parseBookingPayoutFacts({ ...facts, ...change }, bookingRequestId),
      ).toThrow();
    },
  );
  it("rejects a replay receipt that belongs to another command", async () => {
    const client = {
      rpc: vi
        .fn()
        .mockResolvedValue({
          data: {
            status: "recorded",
            bookingRequestId,
            commandId: dispute,
            occurredAt: command.occurredAt,
          },
          error: null,
        }),
    } as unknown as SupabaseClient;
    await expect(
      new SupabaseBookingPayoutRepository(client).record({
        bookingRequestId,
        commandId: hold,
        action: "place_hold",
        reason: "Review",
      }),
    ).rejects.toThrow("receipt");
  });
  it("preserves a current database conflict as an actionable refresh outcome", async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: { code: "RC409" } }),
    } as unknown as SupabaseClient;
    await expect(
      new SupabaseBookingPayoutRepository(client).record({
        bookingRequestId,
        commandId: hold,
        action: "place_hold",
        reason: "Review",
      }),
    ).rejects.toThrow("Refresh");
  });
});
