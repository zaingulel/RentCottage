import { afterEach, expect, it, vi } from "vitest";

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient }));

import { createRequestPaymentOperations } from "./request-payment-operations";

afterEach(() => vi.unstubAllEnvs());

it("hosted request payment composition preserves complete admission", () => {
  createClient.mockClear();
  const hosted = {
    APP_ENVIRONMENT: "preview",
    HOSTED_DEMO: "true",
    SUPABASE_PROJECT_REF: "yvibcyqtyihpzpmomnzg",
    SUPABASE_URL: "https://yvibcyqtyihpzpmomnzg.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "fixture-publishable",
    SUPABASE_SECRET_KEY: "fixture-secret",
    PRIVILEGED_AUDIT_HMAC_KEY: "fixture-audit-key-with-at-least-32-characters",
    DEPLOYMENT_COMMIT: "cccccccccccccccccccccccccccccccccccccccc",
    NEXT_PUBLIC_SUPABASE_SECRET_KEY: undefined,
    NEXT_PUBLIC_PRIVILEGED_AUDIT_HMAC_KEY: undefined,
  };
  for (const [key, value] of Object.entries(hosted)) vi.stubEnv(key, value);
  const client = { rpc: vi.fn() };
  createClient.mockReturnValue(client);

  const composed = createRequestPaymentOperations();
  expect(composed?.provider.identity).toEqual({
    provider: "fictional-payments",
    environment: "hosted-demo-yvibcyqtyihpzpmomnzg",
    merchantId: "fictional-merchant",
    terminalId: "fictional-terminal",
  });
  expect(composed?.serviceClient).toBe(client);
  expect(createClient).toHaveBeenCalledExactlyOnceWith(
    "https://yvibcyqtyihpzpmomnzg.supabase.co",
    "fixture-secret",
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  for (const patch of [
    { HOSTED_DEMO: undefined },
    { HOSTED_DEMO: "TRUE" },
    { APP_ENVIRONMENT: "production" },
    { SUPABASE_PROJECT_REF: "another-project" },
    { SUPABASE_URL: "https://yvibcyqtyihpzpmomnzg.supabase.co/path" },
    { SUPABASE_PUBLISHABLE_KEY: undefined },
    { SUPABASE_SECRET_KEY: undefined },
    { PRIVILEGED_AUDIT_HMAC_KEY: undefined },
    { DEPLOYMENT_COMMIT: undefined },
    { NEXT_PUBLIC_SUPABASE_SECRET_KEY: "fixture-exposed-secret" },
    { NEXT_PUBLIC_PRIVILEGED_AUDIT_HMAC_KEY: "fixture-exposed-audit-key" },
  ]) {
    for (const [key, value] of Object.entries({ ...hosted, ...patch }))
      vi.stubEnv(key, value);
    createClient.mockClear();
    expect(createRequestPaymentOperations()).toBeUndefined();
    expect(createClient).not.toHaveBeenCalled();
  }

  for (const [key, value] of Object.entries({
    ...hosted,
    APP_ENVIRONMENT: "test",
    HOSTED_DEMO: undefined,
    SUPABASE_PROJECT_REF: "local-test",
    SUPABASE_URL: "http://127.0.0.1:54331",
  }))
    vi.stubEnv(key, value);
  expect(createRequestPaymentOperations()?.provider.identity).toEqual({
    provider: "fictional-payments",
    environment: "local-test",
    merchantId: "fictional-merchant",
    terminalId: "fictional-terminal",
  });
});
