import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { test as base } from "@playwright/test";

import { triggerScheduled } from "./trigger-scheduled";

const { createLocalSupabaseConcurrencyHarness } = createRequire(
  import.meta.url,
)("../../scripts/local-supabase-concurrency-harness.mjs") as {
  createLocalSupabaseConcurrencyHarness(): SqlHarness & {
    guardDisposableLocalDatabase(): void;
  };
};
const { withPaymentRecoveryCleanup } = createRequire(import.meta.url)(
  "./payment-recovery-cleanup.mjs",
) as {
  withPaymentRecoveryCleanup(cleanup: string, requestId: string): string;
};

type SqlHarness = { runSql(sql: string): string };
type PaymentDefault = { table: string; column: string; expression: string };

export const expirySignatures = [
  "claim_due_booking_request_payment_required_expiries(integer,jsonb)",
  "prepare_booking_request_payment_required_expiry(uuid,jsonb,jsonb)",
  "persist_simulated_payment_effect(jsonb,jsonb)",
  "resolve_simulated_payment_effect(jsonb,text,jsonb)",
  "seal_simulated_payment_absence(jsonb)",
  "validate_payment_provider_observation(jsonb,uuid)",
  "accept_payment_provider_observation(uuid,jsonb)",
  "admit_booking_request_payment_required_expiry(jsonb)",
  "reload_booking_request_payment_operation(jsonb,text,text)",
  "finalize_booking_request_payment_required_expiry(uuid)",
  "booking_request_payment_required_expiry_completed(uuid)",
];
const captureSignatures = [
  "lease_booking_request_capture_work(uuid,jsonb)",
  "admit_booking_request_capture(jsonb)",
  "persist_simulated_payment_effect(jsonb,jsonb)",
  "record_booking_request_capture_failure(uuid,bigint,uuid,jsonb)",
];
const recoverySignatures = [
  "claim_customer_booking_request_payment_recovery(uuid,uuid,text)",
  "lease_booking_request_payment_recovery_step(uuid,text,text)",
  "admit_booking_request_payment_recovery(jsonb)",
  "persist_simulated_payment_effect(jsonb,jsonb)",
];
const paymentColumns = [
  ["payment_provider_operations", "created_at"],
  ["payment_provider_operations", "updated_at"],
  ["simulated_payment_effects", "created_at"],
  ["simulated_payment_effects", "updated_at"],
  ["payment_provider_observations", "received_at"],
] as const;

export const paymentEvidenceSql =
  "-- BEGIN PAYMENT EVIDENCE FIXTURE\n" +
  readFileSync("supabase/fixtures/payment-evidence.sql", "utf8") +
  "\n-- END PAYMENT EVIDENCE FIXTURE\n";

export type ScheduledExpiryBaseline = {
  definitions: string[];
  ordinary: string;
  captureDefinitions: string[];
  recoveryDefinitions: string[];
  paymentDefaults: PaymentDefault[];
};

export function readScheduledExpiryBaseline(
  harness: SqlHarness,
): ScheduledExpiryBaseline {
  const readDefinitions = (signatures: string[]) =>
    signatures.map((signature) =>
      harness.runSql(
        paymentEvidenceSql +
          `select pg_get_functiondef('public.${signature}'::regprocedure);`,
      ),
    );
  const definitions = readDefinitions(expirySignatures);
  const ordinary = harness.runSql(
    paymentEvidenceSql +
      "select pg_get_functiondef('public.claim_due_booking_request_releases(integer)'::regprocedure);",
  );
  const captureDefinitions = readDefinitions(captureSignatures);
  const recoveryDefinitions = readDefinitions(recoverySignatures);
  const paymentDefaults = paymentColumns.map(([table, column]) => ({
    table,
    column,
    expression: harness.runSql(
      `select pg_get_expr(defaults.adbin,defaults.adrelid) from pg_attrdef defaults
       join pg_attribute attributes on attributes.attrelid=defaults.adrelid and attributes.attnum=defaults.adnum
       where defaults.adrelid='public.${table}'::regclass and attributes.attname='${column}';`,
    ),
  }));

  for (const { table, column, expression } of paymentDefaults) {
    if (expression !== "clock_timestamp()") {
      throw new Error(
        `Expected public.${table}.${column} default clock_timestamp(), received ${expression || "missing default"}.`,
      );
    }
  }
  if (
    harness.runSql(
      "select to_regprocedure('public.scheduled_payment_expiry_now()');",
    )
  ) {
    throw new Error(
      "Temporary public.scheduled_payment_expiry_now() already exists.",
    );
  }
  for (const [identity, definition] of [
    ...expirySignatures.map((signature, index) => [
      signature,
      definitions[index],
    ]),
    ["claim_due_booking_request_releases(integer)", ordinary],
    ...captureSignatures.map((signature, index) => [
      signature,
      captureDefinitions[index],
    ]),
    ...recoverySignatures.map((signature, index) => [
      signature,
      recoveryDefinitions[index],
    ]),
  ]) {
    if (definition.includes("scheduled_payment_expiry_now()")) {
      throw new Error(`Temporary clock reference remains in ${identity}.`);
    }
  }
  return {
    definitions,
    ordinary,
    captureDefinitions,
    recoveryDefinitions,
    paymentDefaults,
  };
}

const requestId = "60000000-0000-4000-8000-000000001001";
const cleanup = withPaymentRecoveryCleanup(
  readFileSync("scripts/verify-booking-request-capture-concurrency.mjs", "utf8")
    .split("const cleanup = `")[1]
    .split("`;\n")[0]
    .replaceAll("${requestId}", requestId),
  requestId,
);

type ScheduledExpiry = ScheduledExpiryBaseline & {
  harness: SqlHarness;
  clocked: string[];
  setPaymentClock(expression: string): void;
  seeded: boolean;
  triggerScheduled(
    baseURL: string | undefined,
    path: string,
  ): Promise<Response>;
};

export const test = base.extend<{ scheduledExpiry: ScheduledExpiry }>({
  scheduledExpiry: async ({}, use) => {
    const harness = createLocalSupabaseConcurrencyHarness();
    harness.guardDisposableLocalDatabase();
    const baseline = readScheduledExpiryBaseline(harness);
    const controller = new AbortController();
    let closed = false;
    const ensureOpen = () => {
      if (closed) throw new Error("Scheduled expiry fixture is closed.");
    };
    const setPaymentClock = (expression: string) => {
      ensureOpen();
      harness.runSql(
        baseline.paymentDefaults
          .map(
            ({ table, column }) =>
              `alter table public.${table} alter column ${column} set default ${expression};`,
          )
          .join("\n"),
      );
    };
    const scheduledExpiry: ScheduledExpiry = {
      ...baseline,
      harness: {
        runSql(sql) {
          ensureOpen();
          return harness.runSql(sql);
        },
      },
      clocked: baseline.definitions.map((definition) =>
        definition.replaceAll(
          "clock_timestamp()",
          "public.scheduled_payment_expiry_now()",
        ),
      ),
      setPaymentClock,
      seeded: false,
      async triggerScheduled(baseURL, path) {
        ensureOpen();
        const response = await triggerScheduled(
          baseURL,
          path,
          controller.signal,
        );
        ensureOpen();
        return response;
      },
    };
    try {
      // Playwright's use owns fixture lifetime; this is not a React Hook.
      // eslint-disable-next-line react-hooks/rules-of-hooks
      await use(scheduledExpiry);
    } finally {
      closed = true;
      controller.abort();
      harness.runSql(
        paymentEvidenceSql +
          "begin;\n" +
          baseline.ordinary +
          ";\n" +
          [
            ...baseline.definitions,
            ...baseline.captureDefinitions,
            ...baseline.recoveryDefinitions,
          ].join(";\n") +
          ";\n" +
          baseline.paymentDefaults
            .map(
              ({ table, column, expression }) =>
                `alter table public.${table} alter column ${column} set default ${expression};`,
            )
            .join("\n") +
          "\ndrop function if exists public.scheduled_payment_expiry_now();\ncommit;",
      );
      if (scheduledExpiry.seeded) harness.runSql(paymentEvidenceSql + cleanup);
    }
  },
});
