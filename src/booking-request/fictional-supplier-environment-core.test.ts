import { expect, it, vi } from "vitest";

import {
  bookingRequestTestRuntimeIsEnabled,
  fictionalSupplierEnvironment,
} from "./fictional-supplier-environment-core";

it("hosted fictional admission preserves local guards and rejects corrupt targets", () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("Admission must not access a supplier"));
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
  const local = {
    APP_ENVIRONMENT: "test",
    SUPABASE_PROJECT_REF: "local-test",
    SUPABASE_URL: "http://127.0.0.1:54321",
  };

  try {
    expect(fictionalSupplierEnvironment(hosted)).toBe(
      "hosted-demo-yvibcyqtyihpzpmomnzg",
    );
    expect(bookingRequestTestRuntimeIsEnabled(hosted)).toBe(false);

    for (const patch of [
      { HOSTED_DEMO: undefined },
      { HOSTED_DEMO: "false" },
      { HOSTED_DEMO: "TRUE" },
      { HOSTED_DEMO: "" },
      { HOSTED_DEMO: " true " },
      { APP_ENVIRONMENT: "production" },
      { APP_ENVIRONMENT: "test" },
      { APP_ENVIRONMENT: "development" },
      { APP_ENVIRONMENT: undefined },
      { SUPABASE_PROJECT_REF: undefined },
      { SUPABASE_PROJECT_REF: "other-project" },
      {
        SUPABASE_PROJECT_REF: "other-project",
        SUPABASE_URL: "https://other-project.supabase.co",
      },
      { SUPABASE_URL: undefined },
      { SUPABASE_URL: "not-a-url" },
      { SUPABASE_URL: "http://127.0.0.1:54321" },
      { SUPABASE_URL: "http://yvibcyqtyihpzpmomnzg.supabase.co" },
      { SUPABASE_URL: "https://yvibcyqtyihpzpmomnzg.supabase.co/" },
      { SUPABASE_URL: "https://yvibcyqtyihpzpmomnzg.supabase.co/path" },
      { SUPABASE_URL: "https://yvibcyqtyihpzpmomnzg.supabase.co?key=fixture" },
      { SUPABASE_URL: "https://yvibcyqtyihpzpmomnzg.supabase.co#fixture" },
      {
        SUPABASE_URL:
          "https://user:fixture-password@yvibcyqtyihpzpmomnzg.supabase.co",
      },
      {
        SUPABASE_URL:
          "https://yvibcyqtyihpzpmomnzg.supabase.co.attacker.example",
      },
      { SUPABASE_PUBLISHABLE_KEY: undefined },
      { SUPABASE_PUBLISHABLE_KEY: "" },
      { SUPABASE_SECRET_KEY: undefined },
      { SUPABASE_SECRET_KEY: "" },
      { PRIVILEGED_AUDIT_HMAC_KEY: undefined },
      { PRIVILEGED_AUDIT_HMAC_KEY: "too-short" },
      { DEPLOYMENT_COMMIT: undefined },
      { DEPLOYMENT_COMMIT: "" },
      { DEPLOYMENT_COMMIT: "not-a-commit" },
      { DEPLOYMENT_COMMIT: "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC" },
      { NEXT_PUBLIC_SUPABASE_SECRET_KEY: "fixture-exposed-secret" },
      { NEXT_PUBLIC_PRIVILEGED_AUDIT_HMAC_KEY: "fixture-exposed-audit-key" },
    ]) {
      expect(
        fictionalSupplierEnvironment({ ...hosted, ...patch }),
      ).toBeUndefined();
    }

    for (const url of [
      "http://127.0.0.1:54321",
      "http://localhost:54321",
      "http://[::1]:54321",
      "http://localhost:54321/path?fixture=true#fixture",
      "http://user:fixture-password@localhost:54321",
    ]) {
      const environment = { ...local, SUPABASE_URL: url };
      expect(bookingRequestTestRuntimeIsEnabled(environment)).toBe(true);
      expect(fictionalSupplierEnvironment(environment)).toBe("local-test");
      for (const marker of ["true", "false", "TRUE", "", " true "]) {
        expect(
          fictionalSupplierEnvironment({ ...environment, HOSTED_DEMO: marker }),
        ).toBeUndefined();
      }
    }

    for (const patch of [
      { APP_ENVIRONMENT: "production" },
      { APP_ENVIRONMENT: "preview" },
      { APP_ENVIRONMENT: "development" },
      { APP_ENVIRONMENT: undefined },
      { SUPABASE_PROJECT_REF: "other-project" },
      { SUPABASE_PROJECT_REF: undefined },
      { SUPABASE_URL: undefined },
      { SUPABASE_URL: "not-a-url" },
      { SUPABASE_URL: "https://localhost:54321" },
      { SUPABASE_URL: "http://localhost.attacker.example:54321" },
      { SUPABASE_URL: "http://127.0.0.1.attacker.example:54321" },
      { SUPABASE_URL: "https://yvibcyqtyihpzpmomnzg.supabase.co" },
    ]) {
      const environment = { ...local, ...patch };
      expect(bookingRequestTestRuntimeIsEnabled(environment)).toBe(false);
      expect(fictionalSupplierEnvironment(environment)).toBeUndefined();
    }
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    fetch.mockRestore();
  }
});
