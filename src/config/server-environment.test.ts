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
      }),
    ).toEqual({
      name: "test",
      supabase: {
        projectRef: "local-test",
        url: "http://127.0.0.1:54321",
        publishableKey: "local-publishable",
        secretKey: "local-secret",
      },
    });
  });

  it("rejects browser-prefixed server credentials", () => {
    expect(() =>
      readServerEnvironment({
        APP_ENVIRONMENT: "production",
        SUPABASE_PROJECT_REF: "prod-ref",
        SUPABASE_URL: "https://prod-ref.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: "publishable",
        SUPABASE_SECRET_KEY: "secret",
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
      }),
    ).toThrow(/SUPABASE_URL/);
  });
});
