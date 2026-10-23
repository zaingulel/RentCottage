import { describe, expect, it, vi } from "vitest";

import {
  readPublicSupabaseEnvironment,
  readServerEnvironment,
} from "./server-environment";

describe("server environment", () => {
  it("accepts a canonical initial-capture selector only on the exact hosted demo and keeps it server-only", () => {
    const source = {
      APP_ENVIRONMENT: "preview",
      HOSTED_DEMO: "true",
      SUPABASE_PROJECT_REF: "yvibcyqtyihpzpmomnzg",
      SUPABASE_URL: "https://yvibcyqtyihpzpmomnzg.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "fixture-publishable",
      SUPABASE_SECRET_KEY: "fixture-secret",
      PRIVILEGED_AUDIT_HMAC_KEY:
        "fixture-audit-key-with-at-least-32-characters",
      DEPLOYMENT_COMMIT: "c".repeat(40),
      HOSTED_DEMO_FAILED_CAPTURE_LIFECYCLE_ID:
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    };
    expect(readServerEnvironment(source)).toHaveProperty(
      "failedInitialCaptureLifecycleId",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
    const publicEnvironment = readPublicSupabaseEnvironment(source);
    expect(publicEnvironment).not.toHaveProperty(
      "failedInitialCaptureLifecycleId",
    );
    expect(publicEnvironment).not.toHaveProperty(
      "HOSTED_DEMO_FAILED_CAPTURE_LIFECYCLE_ID",
    );
    expect(
      readServerEnvironment({
        ...source,
        HOSTED_DEMO_FAILED_CAPTURE_LIFECYCLE_ID: undefined,
      }),
    ).not.toHaveProperty("failedInitialCaptureLifecycleId");
    for (const selector of [
      "",
      "not-a-uuid",
      "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
      " aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\n",
    ]) {
      expect(() =>
        readServerEnvironment({
          ...source,
          HOSTED_DEMO_FAILED_CAPTURE_LIFECYCLE_ID: selector,
        }),
      ).toThrow(/HOSTED_DEMO_FAILED_CAPTURE_LIFECYCLE_ID/);
    }
    for (const patch of [
      { HOSTED_DEMO: undefined },
      {
        APP_ENVIRONMENT: "test",
        HOSTED_DEMO: undefined,
        SUPABASE_PROJECT_REF: "local-test",
        SUPABASE_URL: "http://127.0.0.1:54331",
      },
    ]) {
      expect(() => readServerEnvironment({ ...source, ...patch })).toThrow(
        /HOSTED_DEMO_FAILED_CAPTURE_LIFECYCLE_ID/,
      );
    }
  });
  it("hosted demo refuses unpinned malformed and mismatched configuration", async () => {
    const target = {
      workerOrigin: "https://invited-demo.example.workers.dev",
      supabaseProjectRef: "demo-fixture",
      accessIssuer: "https://fixture.cloudflareaccess.com",
      accessAudience: "fixture-application-audience",
    };
    const source = {
      APP_ENVIRONMENT: "preview",
      HOSTED_DEMO: "true",
      SUPABASE_PROJECT_REF: "demo-fixture",
      SUPABASE_URL: "https://demo-fixture.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "fixture-publishable",
      SUPABASE_SECRET_KEY: "fixture-secret",
      PRIVILEGED_AUDIT_HMAC_KEY:
        "fixture-audit-key-with-at-least-32-characters",
      DEPLOYMENT_COMMIT: "b".repeat(40),
    };
    const rejects = (
      read: typeof readPublicSupabaseEnvironment,
      input: typeof source,
    ) => {
      let failure: unknown;
      try {
        read(input);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      const message = (failure as Error).message;
      expect(message).toMatch(
        /HOSTED_DEMO|APP_ENVIRONMENT|SUPABASE_URL|SUPABASE_PROJECT_REF/,
      );
      for (const value of Object.values(input)) {
        if (value.length > 15) expect(message).not.toContain(value);
      }
    };

    try {
      vi.doMock("./hosted-demo-target", () => ({ hostedDemoTarget: null }));
      vi.resetModules();
      const unconfigured = await import("./server-environment");
      rejects(unconfigured.readPublicSupabaseEnvironment, source);

      vi.doMock("./hosted-demo-target", () => ({ hostedDemoTarget: target }));
      vi.resetModules();
      const configured = await import("./server-environment");
      expect(configured.readPublicSupabaseEnvironment(source)).toMatchObject({
        name: "preview",
        hostedDemo: true,
      });
      expect(configured.readServerEnvironment(source).hostedDemo).toBe(true);
      for (const patch of [
        { HOSTED_DEMO: "false" },
        { HOSTED_DEMO: "TRUE" },
        { HOSTED_DEMO: "" },
        { HOSTED_DEMO: "secret-like-invalid-marker" },
        { APP_ENVIRONMENT: "production" },
        { APP_ENVIRONMENT: "test" },
        { APP_ENVIRONMENT: "secret-like-invalid-environment" },
        { SUPABASE_URL: "secret-like-invalid-url" },
        { SUPABASE_URL: "http://127.0.0.1:54331" },
        { SUPABASE_URL: "http://demo-fixture.supabase.co" },
        { SUPABASE_URL: "https://demo-fixture.supabase.co.attacker.example" },
        {
          SUPABASE_URL:
            "https://user:secret-like-password@demo-fixture.supabase.co",
        },
        { SUPABASE_URL: "https://demo-fixture.supabase.co/path" },
        {
          SUPABASE_URL:
            "https://demo-fixture.supabase.co?key=secret-like-query",
        },
        {
          SUPABASE_URL: "https://demo-fixture.supabase.co#secret-like-fragment",
        },
        {
          SUPABASE_PROJECT_REF: "other-project",
          SUPABASE_URL: "https://other-project.supabase.co",
        },
      ]) {
        rejects(configured.readPublicSupabaseEnvironment, {
          ...source,
          ...patch,
        });
      }
      expect(
        configured.readPublicSupabaseEnvironment({
          ...source,
          HOSTED_DEMO: undefined,
        }),
      ).not.toHaveProperty("hostedDemo");
    } finally {
      vi.doUnmock("./hosted-demo-target");
      vi.resetModules();
    }
  });

  it("hosted demo accepts only the approved deployed target", async () => {
    vi.doUnmock("./hosted-demo-target");
    vi.resetModules();
    try {
      const { hostedDemoTarget } = await import("./hosted-demo-target");
      const { readServerEnvironment } = await import("./server-environment");
      expect(hostedDemoTarget).toEqual({
        workerOrigin: "https://demo.halabeekom.com",
        supabaseProjectRef: "yvibcyqtyihpzpmomnzg",
        accessIssuer: "https://fragrant-snow-bffc.cloudflareaccess.com",
        accessAudience:
          "7cfcb76e2ce196644be64a1d8583ea74c6faef901a9f2c58cc6796468fdb8f92",
      });
      const source = {
        APP_ENVIRONMENT: "preview",
        HOSTED_DEMO: "true",
        SUPABASE_PROJECT_REF: "yvibcyqtyihpzpmomnzg",
        SUPABASE_URL: "https://yvibcyqtyihpzpmomnzg.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: "fixture-publishable",
        SUPABASE_SECRET_KEY: "fixture-secret",
        PRIVILEGED_AUDIT_HMAC_KEY:
          "fixture-audit-key-with-at-least-32-characters",
        DEPLOYMENT_COMMIT: "c".repeat(40),
      };
      expect(readServerEnvironment(source)).toEqual({
        name: "preview",
        hostedDemo: true,
        deployment: { commit: "c".repeat(40) },
        privilegedAuditHmacKey: "fixture-audit-key-with-at-least-32-characters",
        supabase: {
          projectRef: "yvibcyqtyihpzpmomnzg",
          url: "https://yvibcyqtyihpzpmomnzg.supabase.co",
          publishableKey: "fixture-publishable",
          secretKey: "fixture-secret",
        },
      });
      for (const patch of [
        {
          SUPABASE_PROJECT_REF: "other-project",
          SUPABASE_URL: "https://other-project.supabase.co",
        },
        {
          SUPABASE_URL:
            "https://user:fixture-password@yvibcyqtyihpzpmomnzg.supabase.co",
        },
      ]) {
        expect(() => readServerEnvironment({ ...source, ...patch })).toThrow(
          /SUPABASE_URL/,
        );
      }
    } finally {
      vi.doUnmock("./hosted-demo-target");
      vi.resetModules();
    }
  });

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
