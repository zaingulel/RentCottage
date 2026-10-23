import { expect, it, vi } from "vitest";
import { FictionalNotificationAdapter } from "./fictional-notification-adapter";

const effects = { queryEffect: vi.fn(), executeEffect: vi.fn() };
const local = {
  APP_ENVIRONMENT: "test",
  SUPABASE_PROJECT_REF: "local-test",
  SUPABASE_URL: "http://127.0.0.1:54331",
};

it("rejects ordinary production and preserves exact local construction", () => {
  expect(
    () =>
      new FictionalNotificationAdapter(effects, {
        ...local,
        APP_ENVIRONMENT: "production",
      }),
  ).toThrow("Fictional notifications require");
  expect(() => new FictionalNotificationAdapter(effects, local)).not.toThrow();
});

it("hosted notification adapter admits only the approved fictional runtime", async () => {
  const hosted = {
    APP_ENVIRONMENT: "preview",
    HOSTED_DEMO: "true",
    SUPABASE_PROJECT_REF: "yvibcyqtyihpzpmomnzg",
    SUPABASE_URL: "https://yvibcyqtyihpzpmomnzg.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "fixture-publishable",
    SUPABASE_SECRET_KEY: "fixture-secret",
    PRIVILEGED_AUDIT_HMAC_KEY: "fixture-audit-key-with-at-least-32-characters",
    DEPLOYMENT_COMMIT: "cccccccccccccccccccccccccccccccccccccccc",
  };
  const effects = {
    queryEffect: vi.fn().mockResolvedValue({ status: "not-found" }),
    executeEffect: vi.fn().mockResolvedValue({ status: "suppressed" }),
  };
  const lease = {} as never;
  for (const environment of [hosted, local]) {
    const adapter = new FictionalNotificationAdapter(effects, environment);
    await expect(adapter.query(lease)).resolves.toEqual({
      status: "not-found",
    });
    await expect(adapter.execute(lease)).resolves.toEqual({
      status: "suppressed",
    });
    expect(effects.queryEffect).toHaveBeenLastCalledWith(lease);
    expect(effects.executeEffect).toHaveBeenLastCalledWith(lease);
  }
  vi.clearAllMocks();
  for (const override of [
    { HOSTED_DEMO: undefined },
    { HOSTED_DEMO: "false" },
    { HOSTED_DEMO: null },
    { HOSTED_DEMO: true },
    { APP_ENVIRONMENT: "production" },
    { SUPABASE_PROJECT_REF: "foreign" },
    { SUPABASE_URL: "https://foreign.supabase.co" },
    { SUPABASE_SECRET_KEY: "" },
    { SUPABASE_PUBLISHABLE_KEY: "" },
    { PRIVILEGED_AUDIT_HMAC_KEY: "" },
    { DEPLOYMENT_COMMIT: "" },
  ]) {
    expect(
      () =>
        new FictionalNotificationAdapter(effects, {
          ...hosted,
          ...override,
        } as never),
    ).toThrow("Fictional notifications require");
  }
  expect(
    () =>
      new FictionalNotificationAdapter(effects, {
        ...local,
        HOSTED_DEMO: "false",
      }),
  ).toThrow("Fictional notifications require");
  expect(effects.queryEffect).not.toHaveBeenCalled();
  expect(effects.executeEffect).not.toHaveBeenCalled();
});
