import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const sources = [
  ...readdirSync(join(process.cwd(), "src"), { recursive: true })
    .map((file) => `src/${String(file).replaceAll("\\", "/")}`)
    .filter((file) => /(?<!\.test)\.tsx?$/.test(file)),
  "custom-worker.ts",
]
  .sort()
  .map((file) => ({
    file,
    source: readFileSync(join(process.cwd(), file), "utf8"),
  }));

function filesReferencing(symbol: RegExp) {
  return sources
    .filter(({ source }) => symbol.test(source))
    .map(({ file }) => file);
}

const requestCallers = [
  "src/booking-request/request-booking-request-lifecycle.ts",
  "src/booking-request/request-booking-request-payment-recovery.ts",
  "src/booking-request/request-booking-request-submission.ts",
  "src/booking-request/request-booking-settlement.ts",
];

const scheduleCallers = [
  "src/booking-request/booking-refund-schedule.ts",
  "src/booking-request/booking-request-capture-schedule.ts",
  "src/booking-request/booking-request-expiry-schedule.ts",
];

function callerSource(caller: string) {
  const match = sources.find(({ file }) => file === caller);
  if (!match) throw new Error(`Payment operation caller ${caller} is missing`);
  return match.source;
}

describe("payment operations boundary", () => {
  it("assembles the payment provider adapter, operation execution and payment service client only in the payment operations module", () => {
    expect(filesReferencing(/\bDurablePaymentSimulator\b/)).toEqual([
      "src/booking-request/payment-operations.ts",
      "src/payment/durable-payment-simulator-core.ts",
    ]);
    expect(filesReferencing(/\bcreatePaymentOperationExecution\b/)).toEqual([
      "src/booking-request/payment-operations.ts",
      "src/payment/payment-operation-execution.ts",
    ]);

    for (const caller of requestCallers) {
      expect(callerSource(caller), caller).toMatch(
        /from "\.\/request-payment-operations"/,
      );
    }
    for (const caller of scheduleCallers) {
      expect(callerSource(caller), caller).toMatch(
        /from "\.\/payment-operations"/,
      );
    }
    for (const caller of [...requestCallers, ...scheduleCallers]) {
      expect(callerSource(caller), caller).not.toMatch(
        /\bcreateClient\b|SUPABASE_SECRET_KEY|secretKey/,
      );
    }
  });
});
