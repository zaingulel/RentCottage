import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { preparePaymentOperations } from "./payment-operations";

it("admits payment operations only in the exact local test runtime", () => {
  const localEnvironment = {
    APP_ENVIRONMENT: "test",
    SUPABASE_PROJECT_REF: "local-test",
    SUPABASE_URL: "http://127.0.0.1:54331",
    SUPABASE_SECRET_KEY: "fictional-test-secret",
  };
  const forbiddenEnvironments = [
    { APP_ENVIRONMENT: "production" },
    { APP_ENVIRONMENT: "preview" },
    { SUPABASE_PROJECT_REF: "another-project" },
    { SUPABASE_URL: "https://fictional-project.supabase.co" },
    { SUPABASE_URL: "http://fictional-project.example:54331" },
    { SUPABASE_URL: "not-a-url" },
    { APP_ENVIRONMENT: undefined },
    { SUPABASE_SECRET_KEY: undefined },
  ];

  expect(preparePaymentOperations(localEnvironment)).toBeTypeOf("function");
  for (const environment of forbiddenEnvironments) {
    expect(
      preparePaymentOperations({ ...localEnvironment, ...environment }),
      JSON.stringify(environment),
    ).toBeUndefined();
  }
});

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
