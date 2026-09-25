// @vitest-environment node
import { describe, expect, it } from "vitest";

import * as scheduledExpiry from "../tests/fixtures/scheduled-expiry.ts";

const { readScheduledExpiryBaseline } = scheduledExpiry;

const baseline = {
  ordinary: "CREATE FUNCTION ordinary() AS $$select 1$$",
  definitions: ["CREATE FUNCTION expiry() AS $$select 1$$"],
  captureDefinitions: [],
  recoveryDefinitions: [],
  paymentDefaults: [
    {
      table: "payment_provider_operations",
      column: "created_at",
      expression: "clock_timestamp()",
    },
  ],
};

function recordingHarness(restoreError, cleanupError) {
  const calls = [];
  return {
    calls,
    runSql(sql) {
      const phase = sql.includes(
        "drop function if exists public.scheduled_payment_expiry_now()",
      )
        ? "restore"
        : "cleanup";
      calls.push(phase);
      if (phase === "restore" && restoreError) throw restoreError;
      if (phase === "cleanup" && cleanupError) throw cleanupError;
      return "";
    },
  };
}

function catalogHarness(injectedSignature, injectedMessage) {
  return {
    runSql(sql) {
      if (sql.includes("select pg_get_expr(defaults.adbin")) {
        return "clock_timestamp()";
      }
      if (sql.includes("select to_regprocedure(")) return "";
      const signature = sql.match(
        /select pg_get_functiondef\('public\.([^']+)'::regprocedure\);/,
      )?.[1];
      if (!signature) throw new Error(`Unexpected catalog query: ${sql}`);
      return signature === injectedSignature
        ? `CREATE FUNCTION public.${signature} AS $$begin raise exception '${injectedMessage}';end;$$`
        : `CREATE FUNCTION public.${signature} AS $$begin return;end;$$`;
    },
  };
}

describe("scheduled expiry fixture", () => {
  it("attempts seeded cleanup when scheduled expiry restoration fails", () => {
    const restoreError = new Error("restore failed");
    const harness = recordingHarness(restoreError);
    expect(() =>
      scheduledExpiry.restoreScheduledExpiryDatabase(harness, baseline, true),
    ).toThrow(restoreError);
    expect(harness.calls).toEqual(["restore", "cleanup"]);
  });

  it("preserves both scheduled expiry cleanup failures", () => {
    const restoreError = new Error("restore failed");
    const cleanupError = new Error("cleanup failed");
    const harness = recordingHarness(restoreError, cleanupError);
    let thrown;
    try {
      scheduledExpiry.restoreScheduledExpiryDatabase(harness, baseline, true);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AggregateError);
    expect(thrown.errors).toEqual([restoreError, cleanupError]);
    expect(harness.calls).toEqual(["restore", "cleanup"]);
  });

  it("omits seeded cleanup when scheduled expiry was not seeded", () => {
    const harness = recordingHarness();
    scheduledExpiry.restoreScheduledExpiryDatabase(harness, baseline, false);
    expect(harness.calls).toEqual(["restore"]);
  });

  it.each([
    [
      "finalization",
      "finalize_booking_request_payment_required_expiry(uuid)",
      "Injected finalization interruption",
    ],
    [
      "ordinary release",
      "claim_due_booking_request_releases(integer)",
      "Injected unrelated ordinary expiry failure",
    ],
  ])(
    "refuses an abandoned scheduled expiry injection in %s",
    (_label, signature, message) => {
      expect(() =>
        readScheduledExpiryBaseline(catalogHarness(signature, message)),
      ).toThrow(
        new RegExp(`${signature.replace(/[()]/g, "\\$&")}.*restart`, "i"),
      );
    },
  );

  it("accepts clean scheduled expiry definitions", () => {
    const baseline = readScheduledExpiryBaseline(catalogHarness());
    expect(baseline.paymentDefaults).toHaveLength(5);
    expect(
      baseline.paymentDefaults.every(
        ({ expression }) => expression === "clock_timestamp()",
      ),
    ).toBe(true);
  });
});
