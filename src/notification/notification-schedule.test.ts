import { expect, it, vi } from "vitest";

import { runScheduledBookingNotifications } from "./notification-schedule";

const environment = {
  APP_ENVIRONMENT: "test",
  SUPABASE_PROJECT_REF: "local-test",
  SUPABASE_URL: "http://127.0.0.1:54331",
  SUPABASE_PUBLISHABLE_KEY: "local-publishable",
  SUPABASE_SECRET_KEY: "local-secret",
};

it.each([
  { APP_ENVIRONMENT: "production" },
  { APP_ENVIRONMENT: "preview" },
  { SUPABASE_PROJECT_REF: "hosted" },
  { SUPABASE_URL: "https://example.supabase.co" },
  { SUPABASE_URL: "http://remote.example" },
  { SUPABASE_SECRET_KEY: "" },
  { SUPABASE_PUBLISHABLE_KEY: "" },
])(
  "rejects fictional notification delivery outside exact local test %#",
  async (override) => {
    const drain = vi.fn();
    await expect(
      runScheduledBookingNotifications({ ...environment, ...override }, drain),
    ).rejects.toThrow("exact local test runtime");
    expect(drain).not.toHaveBeenCalled();
  },
);

it("awaits one bounded notification drain", async () => {
  const drain = vi.fn().mockResolvedValue([{ status: "delivered" }]);
  await expect(
    runScheduledBookingNotifications(environment, drain),
  ).resolves.toEqual([{ status: "delivered" }]);
  expect(drain).toHaveBeenCalledExactlyOnceWith(50);
});
