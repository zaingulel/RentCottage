import { expect, it, vi } from "vitest";
import { FictionalNotificationAdapter } from "./fictional-notification-adapter";

const effects = { queryEffect: vi.fn(), executeEffect: vi.fn() };
const local = {
  APP_ENVIRONMENT: "test",
  SUPABASE_PROJECT_REF: "local-test",
  SUPABASE_URL: "http://127.0.0.1:54331",
};

it("cannot be constructed outside the exact local test runtime", () => {
  expect(
    () =>
      new FictionalNotificationAdapter(effects, {
        ...local,
        APP_ENVIRONMENT: "production",
      }),
  ).toThrow("exact local test runtime");
  expect(() => new FictionalNotificationAdapter(effects, local)).not.toThrow();
});
