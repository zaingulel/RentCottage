import { describe, expect, it, vi } from "vitest";
import {
  SupabaseBookingNoShowRepository,
  recordBookingIncident,
  BookingLifecycleConflict,
} from "./supabase-booking-lifecycle";
const command = {
  bookingRequestId: "60000000-0000-4000-8000-000000001001",
  commandId: "90000000-0000-4000-8000-000000003901",
  reason: "Did not arrive",
};
const facts = {
  bookingRequestId: command.bookingRequestId,
  revision: "a".repeat(32),
  firstStartsAt: "2026-09-12T05:00:00Z",
  observedAt: "2026-09-12T06:00:00Z",
  captured: { bookingPriceFils: 110000000, bookingServiceFeeFils: 5000000 },
};
const receipt = {
  status: "no_show",
  bookingRequestId: command.bookingRequestId,
  noShowId: command.commandId,
  occurredAt: "2026-09-12T06:00:00Z",
  refundObligation: { bookingPriceFils: 0, bookingServiceFeeFils: 0 },
};
describe("booking lifecycle database adapters", () => {
  it("binds no-show facts and zero-refund command to the original booking", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: facts, error: null })
      .mockResolvedValueOnce({ data: receipt, error: null });
    const repo = new SupabaseBookingNoShowRepository({ rpc } as never);
    expect(await repo.facts(command)).toEqual(facts);
    expect(
      await repo.commit(command, {
        revision: facts.revision,
        refundObligation: receipt.refundObligation,
      }),
    ).toEqual(receipt);
    expect(rpc).toHaveBeenLastCalledWith("commit_booking_no_show", {
      target_booking_request_id: command.bookingRequestId,
      target_command_id: command.commandId,
      target_reason: command.reason,
      target_decision: {
        revision: facts.revision,
        refundObligation: receipt.refundObligation,
      },
    });
  });
  it.each([
    { ...receipt, bookingRequestId: "foreign" },
    {
      ...receipt,
      refundObligation: { bookingPriceFils: 1, bookingServiceFeeFils: 0 },
    },
    { ...receipt, noShowId: "bad" },
  ])("rejects invalid no-show receipt %j", async (data) => {
    const rpc = vi.fn().mockResolvedValue({ data, error: null });
    await expect(
      new SupabaseBookingNoShowRepository({ rpc } as never).commit(command, {
        revision: facts.revision,
        refundObligation: receipt.refundObligation,
      }),
    ).rejects.toThrow();
  });
  it("returns a typed visible conflict without database diagnostics", async () => {
    const rpc = vi.fn().mockResolvedValue({
      error: { code: "RC409", message: "PRIVATE" },
      data: null,
    });
    await expect(
      new SupabaseBookingNoShowRepository({ rpc } as never).facts(command),
    ).rejects.toBeInstanceOf(BookingLifecycleConflict);
  });
  it("sends only incident command fields and validates its receipt", async () => {
    const input = {
      bookingRequestId: command.bookingRequestId,
      commandId: command.commandId,
      actorRole: "cottage_owner" as const,
      category: "safety" as const,
      narrative: "PRIVATE",
    };
    const result = {
      status: "recorded",
      bookingRequestId: command.bookingRequestId,
      incidentId: command.commandId,
      recordedAt: "2026-09-12T06:00:00Z",
    };
    const rpc = vi.fn().mockResolvedValue({ data: result, error: null });
    expect(await recordBookingIncident({ rpc } as never, input)).toEqual(
      result,
    );
    expect(rpc).toHaveBeenCalledWith("record_booking_incident", {
      target_booking_request_id: input.bookingRequestId,
      target_command_id: input.commandId,
      target_actor_role: input.actorRole,
      target_category: input.category,
      target_narrative: input.narrative,
    });
  });
});
