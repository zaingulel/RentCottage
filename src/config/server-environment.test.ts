import { describe, expect, it } from "vitest";

import {
  readPublicSupabaseEnvironment,
  readServerEnvironment,
} from "./server-environment";

describe("server environment", () => {
  it("provides the publishable connection without requiring the server secret", () => {
    expect(
      readPublicSupabaseEnvironment({
        APP_ENVIRONMENT: "test",
        SUPABASE_PROJECT_REF: "local-test",
        SUPABASE_URL: "http://127.0.0.1:54321",
        SUPABASE_PUBLISHABLE_KEY: "local-publishable",
      }),
    ).toEqual({
      name: "test",
      supabase: {
        projectRef: "local-test",
        url: "http://127.0.0.1:54321",
        publishableKey: "local-publishable",
      },
    });
  });

  it("returns a named Supabase environment from server-only variables", () => {
    expect(
      readServerEnvironment({
        APP_ENVIRONMENT: "test",
        SUPABASE_PROJECT_REF: "local-test",
        SUPABASE_URL: "http://127.0.0.1:54321",
        SUPABASE_PUBLISHABLE_KEY: "local-publishable",
        SUPABASE_SECRET_KEY: "local-secret",
        PRIVILEGED_AUDIT_HMAC_KEY: "local-audit-hmac-key-with-32-characters",
      }),
    ).toEqual({
      name: "test",
      deployment: { commit: null },
      privilegedAuditHmacKey: "local-audit-hmac-key-with-32-characters",
      supabase: {
        projectRef: "local-test",
        url: "http://127.0.0.1:54321",
        publishableKey: "local-publishable",
        secretKey: "local-secret",
      },
    });
  });

  it("requires a validated deployment commit in hosted environments", () => {
    const hosted = {
      APP_ENVIRONMENT: "preview",
      SUPABASE_PROJECT_REF: "preview-ref",
      SUPABASE_URL: "https://preview-ref.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "publishable",
      SUPABASE_SECRET_KEY: "secret",
      PRIVILEGED_AUDIT_HMAC_KEY: "audit-hmac-key-with-at-least-32-characters",
    } as const;

    expect(() => readServerEnvironment(hosted)).toThrow(/DEPLOYMENT_COMMIT/);
    expect(() =>
      readServerEnvironment({ ...hosted, DEPLOYMENT_COMMIT: "not-a-sha" }),
    ).toThrow(/DEPLOYMENT_COMMIT/);
    expect(
      readServerEnvironment({ ...hosted, DEPLOYMENT_COMMIT: "a".repeat(40) })
        .deployment,
    ).toEqual({ commit: "a".repeat(40) });
  });

  it("rejects browser-prefixed server credentials", () => {
    expect(() =>
      readServerEnvironment({
        APP_ENVIRONMENT: "production",
        SUPABASE_PROJECT_REF: "prod-ref",
        SUPABASE_URL: "https://prod-ref.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: "publishable",
        SUPABASE_SECRET_KEY: "secret",
        PRIVILEGED_AUDIT_HMAC_KEY: "audit-hmac-key-with-at-least-32-characters",
        NEXT_PUBLIC_SUPABASE_SECRET_KEY: "leaked-secret",
      }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_SECRET_KEY/);
  });

  it("rejects a loopback lookalike hostname", () => {
    expect(() =>
      readServerEnvironment({
        APP_ENVIRONMENT: "test",
        SUPABASE_PROJECT_REF: "local-test",
        SUPABASE_URL: "http://127.0.0.1.attacker.example:54321",
        SUPABASE_PUBLISHABLE_KEY: "publishable",
        SUPABASE_SECRET_KEY: "secret",
        PRIVILEGED_AUDIT_HMAC_KEY: "audit-hmac-key-with-at-least-32-characters",
      }),
    ).toThrow(/SUPABASE_URL/);
  });

  it("rejects a remote URL that only contains the project reference", () => {
    expect(() =>
      readServerEnvironment({
        APP_ENVIRONMENT: "production",
        SUPABASE_PROJECT_REF: "prod-ref",
        SUPABASE_URL: "https://attacker.example/prod-ref.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: "publishable",
        SUPABASE_SECRET_KEY: "secret",
        PRIVILEGED_AUDIT_HMAC_KEY: "audit-hmac-key-with-at-least-32-characters",
      }),
    ).toThrow(/SUPABASE_URL/);
  });

  it("requires a dedicated strong privileged-audit HMAC key", () => {
    expect(() =>
      readServerEnvironment({
        APP_ENVIRONMENT: "test",
        SUPABASE_PROJECT_REF: "local-test",
        SUPABASE_URL: "http://127.0.0.1:54321",
        SUPABASE_PUBLISHABLE_KEY: "publishable",
        SUPABASE_SECRET_KEY: "secret",
        PRIVILEGED_AUDIT_HMAC_KEY: "too-short",
      }),
    ).toThrow(/PRIVILEGED_AUDIT_HMAC_KEY/);
  });

  it("rejects a browser-prefixed privileged-audit HMAC key", () => {
    expect(() =>
      readServerEnvironment({
        APP_ENVIRONMENT: "test",
        SUPABASE_PROJECT_REF: "local-test",
        SUPABASE_URL: "http://127.0.0.1:54321",
        SUPABASE_PUBLISHABLE_KEY: "publishable",
        SUPABASE_SECRET_KEY: "secret",
        PRIVILEGED_AUDIT_HMAC_KEY: "audit-hmac-key-with-at-least-32-characters",
        NEXT_PUBLIC_PRIVILEGED_AUDIT_HMAC_KEY: "exposed-audit-key",
      }),
    ).toThrow(/NEXT_PUBLIC_PRIVILEGED_AUDIT_HMAC_KEY/);
  });
});
