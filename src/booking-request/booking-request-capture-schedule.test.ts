import { describe, expect, it, vi } from "vitest";
import { runScheduledBookingRequestCapture } from "./booking-request-capture-schedule";
const environment = {
  APP_ENVIRONMENT: "test",
  SUPABASE_PROJECT_REF: "local-test",
  SUPABASE_URL: "http://127.0.0.1:54331",
  SUPABASE_PUBLISHABLE_KEY: "local-publishable",
  SUPABASE_SECRET_KEY: "local-secret",
};
describe("Scheduled capture admission", () => {
  it.each([
    { APP_ENVIRONMENT: "production" },
    { APP_ENVIRONMENT: "preview" },
    { SUPABASE_PROJECT_REF: "hosted" },
    { SUPABASE_URL: "https://example.supabase.co" },
    { SUPABASE_URL: "http://remote.example" },
    { SUPABASE_SECRET_KEY: "" },
    { SUPABASE_PUBLISHABLE_KEY: "" },
  ])(
    "rejects unavailable local identity before provider construction %#",
    async (override) => {
      const drain = vi.fn();
      await expect(
        runScheduledBookingRequestCapture(
          { ...environment, ...override },
          drain,
        ),
      ).rejects.toThrow("local test runtime");
      expect(drain).not.toHaveBeenCalled();
    },
  );
  it("runs a bounded drain and distinguishes empty success", async () => {
    const drain = vi.fn().mockResolvedValue([]);
    await expect(
      runScheduledBookingRequestCapture(environment, drain),
    ).resolves.toEqual([]);
    expect(drain).toHaveBeenCalledExactlyOnceWith(50);
  });
  it.each(["unavailable", "invalid"] as const)(
    "fails the scheduled observation for %s work",
    async (status) => {
      await expect(
        runScheduledBookingRequestCapture(environment, async () => [
          { status },
        ]),
      ).rejects.toThrow("incomplete");
    },
  );
});

it("resumes admitted recovery work alongside ordinary captures in the same bounded schedule", async () => {
  const recovery = vi.fn().mockResolvedValue([{ status: "succeeded" }]);
  await runScheduledBookingRequestCapture(
    environment,
    async () => [],
    recovery,
  );
  expect(recovery).toHaveBeenCalledExactlyOnceWith(50);
});
