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

  it("runs one bounded drain only in the exact secret-backed test runtime", async () => {
    const processDue = vi.fn().mockResolvedValue([{ status: "expired" }]);

    await expect(
      runScheduledBookingRequestExpiry(testEnvironment, processDue),
    ).resolves.toEqual([{ status: "expired" }]);
    expect(processDue).toHaveBeenCalledOnce();
    expect(processDue).toHaveBeenCalledWith(50);
  });

  it.each([
    { ...testEnvironment, APP_ENVIRONMENT: "preview" },
    { ...testEnvironment, APP_ENVIRONMENT: "production" },
    { ...testEnvironment, SUPABASE_PROJECT_REF: "hosted-project" },
    { ...testEnvironment, SUPABASE_URL: "https://local-test.supabase.co" },
    { ...testEnvironment, SUPABASE_SECRET_KEY: "" },
  ])("fails closed outside the exact test runtime %#", async (environment) => {
    const processDue = vi.fn();

    await expect(
      runScheduledBookingRequestExpiry(environment, processDue),
    ).rejects.toThrow("test runtime");
    expect(processDue).not.toHaveBeenCalled();
  });
});
