// SQL arrangement mirrors admission, isolated effect, and explicit recording.
const paymentEvidenceSql =
  "-- BEGIN PAYMENT EVIDENCE FIXTURE\n" +
  readFileSync("supabase/fixtures/payment-evidence.sql", "utf8") +
  "\n-- END PAYMENT EVIDENCE FIXTURE\n";
import { expect, test } from "@playwright/test";

test("the test Worker expires due booking requests exactly once", async ({
  request,
}) => {
  for (let invocation = 0; invocation < 2; invocation += 1) {
    const response = await request.get(
      "/__scheduled?format=json&cron=%2A%20%2A%20%2A%20%2A%20%2A",
    );
    expect(response.ok()).toBe(true);
  }
});

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const { createLocalSupabaseConcurrencyHarness } = createRequire(
  import.meta.url,
)("../scripts/local-supabase-concurrency-harness.mjs") as {
  createLocalSupabaseConcurrencyHarness(): {
    guardDisposableLocalDatabase(): void;
    runSql(sql: string): string;
  };
};
const { withPaymentRecoveryCleanup } = createRequire(import.meta.url)(
  "./fixtures/payment-recovery-cleanup.mjs",
) as {
  withPaymentRecoveryCleanup(cleanup: string, requestId: string): string;
};

for (const { outcome, movement } of (
  ["release", "refund", "recovery-release"] as const
).flatMap((movement) =>
  (["succeeded", "failed", "indeterminate"] as const)
    .filter(
      (outcome) => movement !== "recovery-release" || outcome !== "succeeded",
    )
    .map((outcome) => ({
      outcome,
      movement,
    })),
)) {
  test(`the actual Worker preserves safe expiry through ${outcome} ${movement}, interruption and unrelated drain failure`, async ({
    request,
  }) => {
    const harness = createLocalSupabaseConcurrencyHarness();
    harness.guardDisposableLocalDatabase();
    const id = "60000000-0000-4000-8000-000000001001";
    const source = readFileSync(
      "supabase/tests/database/booking_request_payment_recovery.test.sql",
      "utf8",
    )
      .split("select plan(")[0]
      .replace(/^begin;/, "");
    const cleanup = withPaymentRecoveryCleanup(
      readFileSync(
        "scripts/verify-booking-request-capture-concurrency.mjs",
        "utf8",
      )
        .split("const cleanup = `")[1]
        .split("`;\n")[0]
        .replaceAll("${requestId}", id),
      id,
    );
    const signatures = [
      "claim_due_booking_request_payment_required_expiries(integer,jsonb)",
      "prepare_booking_request_payment_required_expiry(uuid,jsonb)",
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
    const definitions = signatures.map((signature) =>
      harness.runSql(
        paymentEvidenceSql +
          `select pg_get_functiondef('public.${signature}'::regprocedure);`,
      ),
    );
    const ordinary = harness.runSql(
      paymentEvidenceSql +
        "select pg_get_functiondef('public.claim_due_booking_request_releases(integer)'::regprocedure);",
    );
    const captureDefinitions = [
      "lease_booking_request_capture_work(uuid,jsonb)",
      "admit_booking_request_capture(jsonb)",
      "persist_simulated_payment_effect(jsonb,jsonb)",
      "record_booking_request_capture_failure(uuid,bigint,uuid,jsonb)",
    ].map((signature) =>
      harness.runSql(
        paymentEvidenceSql +
          `select pg_get_functiondef('public.${signature}'::regprocedure);`,
      ),
    );
    const recoveryDefinitions = [
      "claim_customer_booking_request_payment_recovery(uuid,uuid,text)",
      "lease_booking_request_payment_recovery_step(uuid)",
      "admit_booking_request_payment_recovery(jsonb)",
      "persist_simulated_payment_effect(jsonb,jsonb)",
    ].map((signature) =>
      harness.runSql(
        paymentEvidenceSql +
          `select pg_get_functiondef('public.${signature}'::regprocedure);`,
      ),
    );
    // The historical fixture clock also owns admission, effect and receipt timestamps.
    const paymentDefaults = [
      ["payment_provider_operations", "created_at"],
      ["payment_provider_operations", "updated_at"],
      ["simulated_payment_effects", "created_at"],
      ["simulated_payment_effects", "updated_at"],
      ["payment_provider_observations", "received_at"],
    ].map(([table, column]) => ({
      table,
      column,
      expression: harness.runSql(
        `select pg_get_expr(defaults.adbin,defaults.adrelid) from pg_attrdef defaults
         join pg_attribute attributes on attributes.attrelid=defaults.adrelid and attributes.attnum=defaults.adnum
         where defaults.adrelid='public.${table}'::regclass and attributes.attname='${column}';`,
      ),
    }));
    const setPaymentClock = (expression: string) =>
      harness.runSql(
        paymentDefaults
          .map(
            ({ table, column }) =>
              `alter table public.${table} alter column ${column} set default ${expression};`,
          )
          .join("\n"),
      );
    const restorePaymentDefaults = paymentDefaults
      .map(
        ({ table, column, expression }) =>
          `alter table public.${table} alter column ${column} set default ${expression};`,
      )
      .join("\n");
    const clocked = definitions.map((definition) =>
      definition.replaceAll(
        "clock_timestamp()",
        "public.scheduled_payment_expiry_now()",
      ),
    );
    const observe = () =>
      JSON.parse(
        harness.runSql(
          paymentEvidenceSql +
            `select jsonb_build_object(
      'request',(select to_jsonb(r) from public.booking_requests r where id='${id}'),
      'capture',(select to_jsonb(w) from public.booking_request_capture_work w where booking_request_id='${id}'),
      'expiry',(select to_jsonb(w) from public.booking_request_payment_required_expiry_work w where booking_request_id='${id}'),
      'ledger',(select jsonb_agg(pg_temp.payment_fixture_operation_json(o) order by id) from public.payment_provider_operations o where claim_id='72000000-0000-4000-8000-000000001001'),
      'notices',(select coalesce(jsonb_agg(to_jsonb(n) order by id),'[]') from public.booking_request_status_notifications n where booking_request_id='${id}' and status='expired'),
      'confirmed',(select count(*) from public.booking_confirmations where booking_request_id='${id}'),
      'hold',(select status from public.cottage_booking_period_commitments where id='50000000-0000-4000-8000-000000001001'),
      'active',(select count(*) from public.cottage_booking_period_occupancies where booking_period_commitment_id='50000000-0000-4000-8000-000000001001' and active));`,
        ),
      );
    let seeded = false;
    try {
      // Seed a coherent historical capture/window: both PostgreSQL and the real Worker are past D.
      setPaymentClock("(clock_timestamp() - interval '21 minutes')");
      for (const definition of captureDefinitions)
        harness.runSql(
          paymentEvidenceSql +
            definition.replaceAll(
              "clock_timestamp()",
              "(clock_timestamp() - interval '21 minutes')",
            ),
        );
      harness.runSql(paymentEvidenceSql + `begin;${source}commit;`);
      for (const definition of captureDefinitions)
        harness.runSql(paymentEvidenceSql + definition);
      seeded = true;
      harness.runSql(
        paymentEvidenceSql +
          "create function public.scheduled_payment_expiry_now() returns timestamptz language sql volatile security definer set search_path='' as $$select payment_required_deadline from public.booking_request_capture_work where booking_request_id='60000000-0000-4000-8000-000000001001'$$;",
      );
      setPaymentClock("public.scheduled_payment_expiry_now()");
      if (movement !== "release") {
        setPaymentClock(
          "(public.scheduled_payment_expiry_now() - interval '1 millisecond')",
        );
        for (const definition of recoveryDefinitions)
          harness.runSql(
            paymentEvidenceSql +
              definition.replaceAll(
                "clock_timestamp()",
                "(public.scheduled_payment_expiry_now() - interval '1 millisecond')",
              ),
          );
        const admitted = JSON.parse(
          harness
            .runSql(
              paymentEvidenceSql +
                `select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001002',false);set role authenticated;select public.claim_customer_booking_request_payment_recovery('${id}','81000000-0000-4000-8000-000000001001','simulated-replacement');`,
            )
            .split("\n")
            .at(-1)!,
        );
        if (movement === "recovery-release") {
          harness.runSql(
            paymentEvidenceSql +
              `set role service_role;select pg_temp.recovery_execute(public.lease_booking_request_payment_recovery_step('${admitted.attemptId}')->'permit','${outcome}');`,
          );
          expect(observe().expiry.state).toBe("quarantined");
        } else {
          harness.runSql(
            paymentEvidenceSql +
              `set role service_role;select pg_temp.recovery_execute(public.lease_booking_request_payment_recovery_step('${admitted.attemptId}')->'permit','succeeded');select pg_temp.recovery_execute(public.lease_booking_request_payment_recovery_step('${admitted.attemptId}')->'permit','succeeded');`,
          );
          const permit = JSON.parse(
            harness.runSql(
              paymentEvidenceSql +
                `set role service_role;select public.lease_booking_request_payment_recovery_step('${admitted.attemptId}');`,
            ),
          ).permit;
          const unobservedFixture = readFileSync(
            "supabase/tests/database/booking_request_payment_correction.test.sql",
            "utf8",
          )
            .split("-- BEGIN UNOBSERVED RECOVERY FIXTURE")[1]
            .split("-- END UNOBSERVED RECOVERY FIXTURE")[0];
          const receipt = JSON.parse(
            harness.runSql(
              paymentEvidenceSql +
                (unobservedFixture +
                  `select pg_temp.seed_unobserved_payment_outcome('${JSON.stringify(permit)}'::jsonb,'succeeded',public.scheduled_payment_expiry_now());`),
            ),
          );
          setPaymentClock("public.scheduled_payment_expiry_now()");
          harness.runSql(
            paymentEvidenceSql +
              `set role service_role;select public.observe_booking_request_payment_correction('${id}','${receipt.providerOperationId}','${JSON.stringify(receipt)}'::jsonb);`,
          );
        }
        for (const definition of recoveryDefinitions)
          harness.runSql(paymentEvidenceSql + definition);
      }
      setPaymentClock("public.scheduled_payment_expiry_now()");
      for (const definition of clocked)
        harness.runSql(paymentEvidenceSql + definition);
      const before = observe();
      expect(Date.parse(before.capture.payment_required_deadline)).toBeLessThan(
        Date.now(),
      );
      if (outcome !== "succeeded" && movement !== "recovery-release")
        harness.runSql(
          paymentEvidenceSql +
            `set role service_role;select pg_temp.expiry_execute(public.prepare_booking_request_payment_required_expiry('${id}','{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}')->'permit','${outcome}');`,
        );
      if (outcome === "indeterminate") {
        const unresolvedQuery = clocked[3].replace(
          "  if jsonb_typeof(target_result#>'{evidence,occurredAt}')",
          "  return winner.result;\n  if jsonb_typeof(target_result#>'{evidence,occurredAt}')",
        );
        expect(unresolvedQuery).not.toBe(clocked[3]);
        harness.runSql(paymentEvidenceSql + unresolvedQuery);
      }
      if (outcome === "succeeded")
        harness.runSql(
          paymentEvidenceSql +
            "create or replace function public.finalize_booking_request_payment_required_expiry(target_booking_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$begin raise exception 'Injected finalization interruption';end;$$;",
        );
      harness.runSql(
        paymentEvidenceSql +
          "create or replace function public.claim_due_booking_request_releases(target_limit integer) returns jsonb language plpgsql security definer set search_path='' as $$begin raise exception 'Injected unrelated ordinary expiry failure';end;$$;",
      );
      expect((await request.get("/__scheduled")).ok()).toBe(false);
      const held = observe();
      expect(held.capture).toEqual(before.capture);
      expect(held.request.status).toBe("accepted");
      expect(held.hold).toBe("pending_hold");
      expect(held.active).toBe(5);
      expect(held.confirmed).toBe(0);
      expect(held.notices).toHaveLength(0);
      const releases = held.ledger.filter(
        (row: { operation_kind: string }) =>
          row.operation_kind ===
          (movement === "recovery-release" ? "release" : movement),
      );
      expect(releases).toHaveLength(1);
      expect(releases[0].physical_execution_count).toBe(1);
      expect(releases[0].current_outcome).toBe(outcome);
      expect(releases[0].amount_fils).toBe(115000000);
      if (movement === "refund")
        expect(
          held.ledger.filter(
            (row: { operation_kind: string }) =>
              row.operation_kind === "release",
          ),
        ).toHaveLength(1);
      if (outcome !== "succeeded")
        expect(held.expiry.state).toBe("quarantined");
      harness.runSql(paymentEvidenceSql + ordinary);
      expect((await request.get("/__scheduled")).ok()).toBe(
        outcome !== "succeeded",
      );
      expect(observe().ledger).toEqual(held.ledger);
      expect(observe().notices).toHaveLength(0);
      harness.runSql(
        paymentEvidenceSql +
          clocked[
            signatures.indexOf(
              "resolve_simulated_payment_effect(jsonb,text,jsonb)",
            )
          ],
      );
      harness.runSql(
        paymentEvidenceSql +
          clocked[
            signatures.indexOf(
              "finalize_booking_request_payment_required_expiry(uuid)",
            )
          ],
      );
      expect((await request.get("/__scheduled")).ok()).toBe(true);
      const settled = observe();
      expect(settled.capture).toEqual(before.capture);
      expect(settled.confirmed).toBe(0);
      expect(settled.request.status).toBe(
        outcome !== "succeeded" ? "accepted" : "expired",
      );
      expect(settled.expiry.state).toBe(
        outcome !== "succeeded" ? "quarantined" : "complete",
      );
      expect(settled.hold).toBe(
        outcome !== "succeeded" ? "pending_hold" : "released_hold",
      );
      expect(settled.active).toBe(outcome !== "succeeded" ? 5 : 0);
      expect(settled.notices).toHaveLength(outcome !== "succeeded" ? 0 : 2);
      expect((await request.get("/__scheduled")).ok()).toBe(true);
      const replay = observe();
      expect(replay.ledger).toEqual(settled.ledger);
      expect(replay.notices).toEqual(settled.notices);
      expect(replay).toEqual(settled);
    } finally {
      harness.runSql(paymentEvidenceSql + ordinary);
      for (const definition of [
        ...definitions,
        ...captureDefinitions,
        ...recoveryDefinitions,
      ])
        harness.runSql(paymentEvidenceSql + definition);
      harness.runSql(restorePaymentDefaults);
      harness.runSql(
        paymentEvidenceSql +
          "drop function if exists public.scheduled_payment_expiry_now();",
      );
      if (seeded) harness.runSql(paymentEvidenceSql + cleanup);
    }
  });
}
