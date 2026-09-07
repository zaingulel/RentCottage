import { describe, expect, it, vi } from "vitest";

import { runScheduledBookingRequestExpiry } from "./booking-request-expiry-schedule";

vi.mock("server-only", () => ({}));

import * as requestBookingRequestLifecycle from "./request-booking-request-lifecycle";

const testEnvironment = {
  APP_ENVIRONMENT: "test",
  SUPABASE_PROJECT_REF: "local-test",
  SUPABASE_URL: "http://127.0.0.1:54331",
  SUPABASE_PUBLISHABLE_KEY: "local-test-publishable",
  SUPABASE_SECRET_KEY: "local-test-secret",
};

describe("Booking Request expiry schedule", () => {
  it("does not expose a request-scoped lifecycle drain", () => {
    expect(requestBookingRequestLifecycle).not.toHaveProperty(
      "processDueBookingRequests",
    );
  });

  it("runs independent bounded ordinary and Payment Required expiry drains", async () => {
    const processDue = vi.fn().mockResolvedValue([{ status: "expired" }]);
    const paymentRequiredDue = vi
      .fn()
      .mockResolvedValue([{ status: "attention-required" }]);

    await expect(
      runScheduledBookingRequestExpiry(
        testEnvironment,
        processDue,
        paymentRequiredDue,
      ),
    ).resolves.toEqual([
      { status: "expired" },
      { status: "attention-required" },
    ]);
    expect(processDue).toHaveBeenCalledOnce();
    expect(processDue).toHaveBeenCalledWith(50);
    expect(paymentRequiredDue).toHaveBeenCalledOnce();
    expect(paymentRequiredDue).toHaveBeenCalledWith(50);
  });

  it.each([0, 1])(
    "attempts both drains when drain %i rejects",
    async (failed) => {
      const drains = [
        vi.fn().mockResolvedValue([]),
        vi.fn().mockResolvedValue([]),
      ] as const;
      drains[failed].mockRejectedValue(new Error("database unavailable"));
      await expect(
        runScheduledBookingRequestExpiry(testEnvironment, ...drains),
      ).rejects.toThrow("incomplete");
      for (const drain of drains) expect(drain).toHaveBeenCalledWith(50);
    },
  );

  it.each(["unavailable", "invalid"])(
    "reports %s as incomplete after both drains run",
    async (status) => {
      const ordinary = vi.fn().mockResolvedValue([{ status }]);
      const paymentRequired = vi
        .fn()
        .mockResolvedValue([{ status: "expired" }]);
      await expect(
        runScheduledBookingRequestExpiry(
          testEnvironment,
          ordinary,
          paymentRequired,
        ),
      ).rejects.toThrow("incomplete");
      expect(paymentRequired).toHaveBeenCalledWith(50);
    },
  );

  it.each([
    { ...testEnvironment, APP_ENVIRONMENT: "preview" },
    { ...testEnvironment, APP_ENVIRONMENT: "production" },
    { ...testEnvironment, SUPABASE_PROJECT_REF: "hosted-project" },
    { ...testEnvironment, SUPABASE_URL: "https://local-test.supabase.co" },
    { ...testEnvironment, SUPABASE_SECRET_KEY: "" },
  ])("fails closed outside the exact test runtime %#", async (environment) => {
    const processDue = vi.fn();
    const paymentRequiredDue = vi.fn();

    await expect(
      runScheduledBookingRequestExpiry(
        environment,
        processDue,
        paymentRequiredDue,
      ),
    ).rejects.toThrow("test runtime");
    expect(processDue).not.toHaveBeenCalled();
    expect(paymentRequiredDue).not.toHaveBeenCalled();
  });
});
