import { describe, expect, it, vi } from "vitest";

import { SupabaseBookingCompletionRepository } from "./supabase-booking-completion";
import type { BookingCompletionCandidate } from "./booking-completion";

const completion: BookingCompletionCandidate = {
  bookingRequestId: "60000000-0000-4000-8000-000000003901",
  action: "complete",
  revision: "a".repeat(32),
  effectivePeriodEnd: "2099-08-24T18:00:00.000Z",
  observedAt: "2099-08-24T18:00:00.000Z",
};

describe("Supabase booking completion repository", () => {
  it("binds due candidates and both application-selected commits to exact identities", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: [completion], error: null })
      .mockResolvedValueOnce({
        data: {
          status: "completed",
          bookingRequestId: completion.bookingRequestId,
          effectivePeriodEnd: completion.effectivePeriodEnd,
          completedAt: completion.observedAt,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          status: "matured",
          bookingRequestId: completion.bookingRequestId,
          effectivePeriodEnd: completion.effectivePeriodEnd,
          assessedAt: completion.observedAt,
        },
        error: null,
      });
    const repository = new SupabaseBookingCompletionRepository({
      rpc,
    } as never);

    await expect(repository.due(50)).resolves.toEqual([completion]);
    await expect(repository.complete(completion)).resolves.toMatchObject({
      status: "completed",
    });
    await expect(
      repository.assessMaturity({ ...completion, action: "assess_maturity" }),
    ).resolves.toMatchObject({ status: "matured" });
    expect(rpc).toHaveBeenNthCalledWith(1, "list_due_booking_completions", {
      target_limit: 50,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "commit_booking_completion", {
      target_booking_request_id: completion.bookingRequestId,
      target_revision: completion.revision,
    });
    expect(rpc).toHaveBeenNthCalledWith(
      3,
      "commit_booking_completion_maturity",
      {
        target_booking_request_id: completion.bookingRequestId,
        target_revision: completion.revision,
      },
    );
  });

  it.each([
    { ...completion, action: "unknown" },
    { ...completion, revision: "" },
    { ...completion, observedAt: "2099-08-24 18:00:00" },
    { ...completion, effectivePeriodEnd: "2099-08-24 18:00:00" },
  ])("rejects malformed or timezone-ambiguous candidates %#", async (value) => {
    const repository = new SupabaseBookingCompletionRepository({
      rpc: vi.fn().mockResolvedValue({ data: [value], error: null }),
    } as never);
    await expect(repository.due(1)).rejects.toThrow("candidate is invalid");
  });
});
