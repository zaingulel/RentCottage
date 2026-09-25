import { triggerScheduled } from "./fixtures/trigger-scheduled";
import {
  expirySignatures,
  paymentEvidenceSql,
  test,
} from "./fixtures/scheduled-expiry";

import { expect } from "@playwright/test";

test("the test Worker expires due booking requests exactly once", async ({
  baseURL,
}) => {
  for (let invocation = 0; invocation < 2; invocation += 1) {
    const response = await triggerScheduled(
      baseURL,
      "/__scheduled?format=json&cron=%2A%20%2A%20%2A%20%2A%20%2A",
    );
    expect(response.ok).toBe(true);
  }
});

import { readFileSync } from "node:fs";
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
    baseURL,
    scheduledExpiry,
  }) => {
    const {
      harness,
      ordinary,
      captureDefinitions,
      recoveryDefinitions,
      clocked,
      setPaymentClock,
    } = scheduledExpiry;
    const signatures = expirySignatures;
    const id = "60000000-0000-4000-8000-000000001001";
    const source = readFileSync(
      "supabase/tests/database/booking_request_payment_recovery.test.sql",
      "utf8",
    )
      .split("select plan(")[0]
      .replace(/^begin;/, "");
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
    scheduledExpiry.seeded = true;
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
            `set role service_role;select pg_temp.recovery_execute(public.lease_booking_request_payment_recovery_step('${admitted.attemptId}','original-release','admitted')->'permit','${outcome}','blocked','unsafe-recovery-original-release-${outcome}');`,
        );
        expect(observe().expiry.state).toBe("quarantined");
      } else {
        harness.runSql(
          paymentEvidenceSql +
            `set role service_role;select pg_temp.recovery_execute(public.lease_booking_request_payment_recovery_step('${admitted.attemptId}','original-release','admitted')->'permit','succeeded','original_released');select pg_temp.recovery_execute(public.lease_booking_request_payment_recovery_step('${admitted.attemptId}','replacement-authorization','original_released')->'permit','succeeded','replacement_authorized');`,
        );
        const permit = JSON.parse(
          harness.runSql(
            paymentEvidenceSql +
              `set role service_role;select public.lease_booking_request_payment_recovery_step('${admitted.attemptId}','replacement-capture','replacement_authorized');`,
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
            `set role service_role;select pg_temp.correction_observe('${id}','${receipt.providerOperationId}','${JSON.stringify(receipt)}'::jsonb,'late_succeeded',null,'${receipt.providerOperationId}');`,
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
          `set role service_role;select pg_temp.expiry_execute(pg_temp.expiry_prepare('${id}','{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}',${movement === "refund" ? "jsonb_build_object('action','refund','captureId',(select entry->>'captureId' from jsonb_array_elements(public.get_booking_request_payment_facts('" + id + "')->'expiryOperations') entry where entry->>'kind'='refund'))" : "jsonb_build_object('action','release','authorizationLifecycleId',public.get_booking_request_payment_facts('" + id + "')->>'originalLifecycleId','recoveryOperationId',null)"})->'permit','${outcome}','expiry-${movement}-${outcome}');`,
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
    expect(
      (await scheduledExpiry.triggerScheduled(baseURL, "/__scheduled")).ok,
    ).toBe(false);
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
          (row: { operation_kind: string }) => row.operation_kind === "release",
        ),
      ).toHaveLength(1);
    if (outcome !== "succeeded") expect(held.expiry.state).toBe("quarantined");
    harness.runSql(paymentEvidenceSql + ordinary);
    expect(
      (await scheduledExpiry.triggerScheduled(baseURL, "/__scheduled")).ok,
    ).toBe(outcome !== "succeeded");
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
    expect(
      (await scheduledExpiry.triggerScheduled(baseURL, "/__scheduled")).ok,
    ).toBe(true);
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
    expect(
      (await scheduledExpiry.triggerScheduled(baseURL, "/__scheduled")).ok,
    ).toBe(true);
    const replay = observe();
    expect(replay.ledger).toEqual(settled.ledger);
    expect(replay.notices).toEqual(settled.notices);
    expect(replay).toEqual(settled);
  });
}
