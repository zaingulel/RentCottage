import { describe, expect, it, vi } from "vitest";
import { SupabaseBookingCancellationRepository } from "./supabase-booking-cancellation";

const command = {
  bookingRequestId: "60000000-0000-4000-8000-000000001001",
  commandId: "60000000-0000-4000-8000-000000003801",
  actorRole: "customer" as const,
  reason: null,
  category: null,
};
const captured = {
  bookingPriceFils: 110_000_000,
  bookingServiceFeeFils: 5_000_000,
};
const facts = {
  bookingRequestId: command.bookingRequestId,
  revision: "a".repeat(32),
  firstStartsAt: "2099-08-22T05:00:00Z",
  observedAt: "2099-08-20T05:00:00Z",
  captured,
};
const result = {
  status: "cancelled",
  bookingRequestId: command.bookingRequestId,
  cancellationId: "60000000-0000-4000-8000-000000003802",
  occurredAt: facts.observedAt,
  refundObligation: captured,
};
const decision = { revision: facts.revision, refundObligation: captured };

describe("Supabase cancellation repository", () => {
  it("uses the authenticated facts and atomic command functions with the exact identity", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: facts, error: null })
      .mockResolvedValue({ data: result, error: null });
    const repository = new SupabaseBookingCancellationRepository({
      rpc,
    } as never);
    expect(await repository.facts(command)).toEqual(facts);
    expect(await repository.commit(command, decision)).toEqual(result);
    expect(rpc).toHaveBeenNthCalledWith(1, "get_booking_cancellation_facts", {
      target_booking_request_id: command.bookingRequestId,
      target_actor_role: "customer",
    });
    expect(rpc).toHaveBeenLastCalledWith("commit_booking_cancellation", {
      target_booking_request_id: command.bookingRequestId,
      target_command_id: command.commandId,
      target_actor_role: "customer",
      target_reason: null,
      target_category: null,
      target_decision: decision,
    });
  });

  it.each([
    { ...facts, bookingRequestId: "another-booking" },
    { ...facts, revision: "" },
    { ...facts, firstStartsAt: "invalid" },
    {
      ...facts,
      captured: { bookingPriceFils: 110_000_001, bookingServiceFeeFils: 0 },
    },
    { ...facts, captured: { bookingPriceFils: 0, bookingServiceFeeFils: -1 } },
  ])("rejects malformed or misbound facts", async (data) => {
    const repository = new SupabaseBookingCancellationRepository({
      rpc: vi.fn().mockResolvedValue({ data, error: null }),
    } as never);
    await expect(repository.facts(command)).rejects.toThrow();
  });

  it("preserves a stale result so the application can re-evaluate", async () => {
    const repository = new SupabaseBookingCancellationRepository({
      rpc: vi
        .fn()
        .mockResolvedValue({ data: { status: "stale" }, error: null }),
    } as never);
    expect(await repository.commit(command, decision)).toEqual({
      status: "stale",
    });
  });

  it("rejects another booking's outcome and database failures", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: { ...result, bookingRequestId: "another-booking" },
        error: null,
      })
      .mockResolvedValue({ data: null, error: { code: "42501" } });
    const repository = new SupabaseBookingCancellationRepository({
      rpc,
    } as never);
    await expect(repository.commit(command, decision)).rejects.toThrow(
      "result is invalid",
    );
    await expect(repository.commit(command, decision)).rejects.toThrow(
      "could not be recorded",
    );
    await expect(repository.facts(command)).rejects.toThrow(
      "facts are unavailable",
    );
  });
});
