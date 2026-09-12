import { describe, expect, it, vi } from "vitest";

import type { BookingCompletionResult } from "./booking-completion";
import { runScheduledBookingCompletion } from "./booking-completion-schedule";

const environment = {
  APP_ENVIRONMENT: "test",
  SUPABASE_PROJECT_REF: "local-test",
  SUPABASE_URL: "http://127.0.0.1:54331",
  SUPABASE_PUBLISHABLE_KEY: "local-publishable",
  SUPABASE_SECRET_KEY: "local-secret",
};

describe("scheduled booking completion", () => {
  it.each([
    { APP_ENVIRONMENT: "production" },
    { APP_ENVIRONMENT: "preview" },
    { SUPABASE_PROJECT_REF: "hosted" },
    { SUPABASE_URL: "https://example.supabase.co" },
    { SUPABASE_URL: "http://remote.example" },
    { SUPABASE_SECRET_KEY: "" },
    { SUPABASE_PUBLISHABLE_KEY: "" },
  ])(
    "rejects non-local execution before constructing the drain %#",
    async (override) => {
      const processDue = vi.fn();
      await expect(
        runScheduledBookingCompletion(
          { ...environment, ...override },
          processDue,
        ),
      ).rejects.toThrow("local test runtime");
      expect(processDue).not.toHaveBeenCalled();
    },
  );

  it("runs one bounded drain and permits an empty successful tick", async () => {
    const processDue = vi.fn().mockResolvedValue([]);
    await expect(
      runScheduledBookingCompletion(environment, processDue),
    ).resolves.toEqual([]);
    expect(processDue).toHaveBeenCalledExactlyOnceWith(50);
  });

  it("preserves successful outcomes and candidates made ineligible before commit", async () => {
    const results: readonly BookingCompletionResult[] = [
      {
        status: "completed",
        bookingRequestId: "60000000-0000-4000-8000-000000003901",
        effectivePeriodEnd: "2099-08-24T18:00:00.000Z",
        completedAt: "2099-08-24T18:01:00.000Z",
      },
      {
        status: "ineligible",
        bookingRequestId: "60000000-0000-4000-8000-000000003902",
      },
      {
        status: "matured",
        bookingRequestId: "60000000-0000-4000-8000-000000003903",
        effectivePeriodEnd: "2099-08-24T18:00:00.000Z",
        assessedAt: "2099-08-24T18:01:00.000Z",
      },
    ];

    await expect(
      runScheduledBookingCompletion(environment, async () => results),
    ).resolves.toEqual(results);
  });

  it("propagates a failed drain without converting it into a successful tick", async () => {
    const error = new Error("Booking completion could not be recorded");

    await expect(
      runScheduledBookingCompletion(environment, async () => {
        throw error;
      }),
    ).rejects.toBe(error);
  });
});
