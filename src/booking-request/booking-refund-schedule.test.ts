import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runScheduledBookingRefunds } from "./booking-refund-schedule";
vi.mock("@supabase/supabase-js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@supabase/supabase-js")>()),
  createClient: vi.fn(),
}));
beforeEach(() => {
  vi.mocked(createClient).mockClear();
});
const environment = {
  APP_ENVIRONMENT: "test",
  SUPABASE_PROJECT_REF: "local-test",
  SUPABASE_URL: "http://127.0.0.1:15331",
  SUPABASE_PUBLISHABLE_KEY: "local-publishable",
  SUPABASE_SECRET_KEY: "local-secret",
};
describe("scheduled booking refunds", () => {
  it("awaits one bounded refund drain and preserves attention separately from availability", async () => {
    const processDue = vi
      .fn()
      .mockResolvedValue([{ status: "attention-required" }]);
    expect(await runScheduledBookingRefunds(environment, processDue)).toEqual([
      { status: "attention-required" },
    ]);
    expect(processDue).toHaveBeenCalledExactlyOnceWith(50);
    expect(createClient).not.toHaveBeenCalled();
  });
  it.each([
    { APP_ENVIRONMENT: "production" },
    { APP_ENVIRONMENT: "preview" },
    { SUPABASE_PROJECT_REF: "hosted" },
    { SUPABASE_URL: "https://local-test.supabase.co" },
    { SUPABASE_SECRET_KEY: "" },
  ])("fails closed outside the exact fictional runtime", async (change) => {
    const processDue = vi.fn();
    await expect(
      runScheduledBookingRefunds({ ...environment, ...change }, processDue),
    ).rejects.toThrow("test runtime");
    expect(processDue).not.toHaveBeenCalled();
  });
  it("reports unavailable database evidence as an incomplete scheduled invocation", async () => {
    await expect(
      runScheduledBookingRefunds(
        environment,
        vi.fn().mockResolvedValue([{ status: "unavailable" }]),
      ),
    ).rejects.toThrow("incomplete");
  });
});
