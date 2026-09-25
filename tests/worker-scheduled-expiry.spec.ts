import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { expect } from "@playwright/test";

import { triggerScheduled } from "./fixtures/trigger-scheduled";
import {
  expirySignatures,
  paymentEvidenceSql,
  requestId,
  test,
} from "./fixtures/scheduled-expiry";

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

type ChildExit = {
  code: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
};
type ChildProbe = { directory: string; completion: Promise<ChildExit> };

const outerTest = test.extend<{ childProbe: ChildProbe }>({
  childProbe: async ({ baseURL }, use, testInfo) => {
    testInfo.setTimeout(390_000);
    if (!baseURL)
      throw new Error(
        "Scheduled expiry observer requires the existing Worker URL.",
      );
    const directory = testInfo.outputPath("interruption");
    mkdirSync(directory, { recursive: true });
    const playwrightPackage = createRequire(import.meta.url).resolve(
      "playwright/package.json",
    );
    const child = spawn(
      process.execPath,
      [
        join(dirname(playwrightPackage), "cli.js"),
        "test",
        "--config=tests/fixtures/scheduled-expiry-interruption.config.ts",
        "--project=worker",
        "--workers=1",
        "--retries=0",
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          SCHEDULED_EXPIRY_PROBE_BASE_URL: baseURL,
          SCHEDULED_EXPIRY_PROBE_OUTPUT_DIR: directory,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    let error: Error | undefined;
    let closed = false;
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    const completion = new Promise<ChildExit>((resolve) => {
      child.once("error", (cause) => {
        error = cause;
      });
      child.once("close", (code, signal) => {
        closed = true;
        writeFileSync(join(directory, "child-output.txt"), output);
        resolve({ code, signal, error });
      });
    });
    try {
      // Playwright's use owns fixture lifetime; this is not a React Hook.
      // eslint-disable-next-line react-hooks/rules-of-hooks
      await use({ directory, completion });
    } finally {
      if (!closed) child.kill("SIGINT");
      await completion;
      for (const name of [
        "report.json",
        "output/baseline.json",
        "child-output.txt",
      ]) {
        const path = join(directory, name);
        if (existsSync(path)) await testInfo.attach(name, { path });
      }
    }
  },
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function verifyInterruptionReport(value: unknown): void {
  if (!isRecord(value) || !isRecord(value.config) || !isRecord(value.stats)) {
    throw new Error("Scheduled expiry child report is malformed.");
  }
  const projects = value.config.projects;
  if (
    !Array.isArray(projects) ||
    projects.length !== 1 ||
    !isRecord(projects[0]) ||
    projects[0].name !== "worker" ||
    projects[0].timeout !== 30_000 ||
    !Array.isArray(value.errors) ||
    value.errors.length !== 0 ||
    value.stats.expected !== 3 ||
    value.stats.unexpected !== 1 ||
    value.stats.skipped !== 0 ||
    value.stats.flaky !== 0
  ) {
    throw new Error(
      "Scheduled expiry child runner result differs from the four-case contract.",
    );
  }
  const suites = value.suites;
  if (!Array.isArray(suites) || suites.length !== 1 || !isRecord(suites[0])) {
    throw new Error(
      "Scheduled expiry child report must contain one file suite.",
    );
  }
  const specs = suites[0].specs;
  const expected = [
    ["scheduled expiry times out with a pending trigger", "timedOut"],
    ["the next scheduled Worker starts with the real payment clock", "passed"],
    ["scheduled expiry refuses a missing payment default", "passed"],
    ["the corruption probe restores the real payment default", "passed"],
  ];
  if (!Array.isArray(specs) || specs.length !== expected.length) {
    throw new Error(
      "Scheduled expiry child report has the wrong case inventory.",
    );
  }
  for (const [index, [title, status]] of expected.entries()) {
    const spec = specs[index];
    const childTest =
      isRecord(spec) && Array.isArray(spec.tests) ? spec.tests[0] : null;
    const result =
      isRecord(childTest) && Array.isArray(childTest.results)
        ? childTest.results[0]
        : null;
    if (
      !isRecord(spec) ||
      spec.title !== title ||
      !Array.isArray(spec.tests) ||
      spec.tests.length !== 1 ||
      !isRecord(childTest) ||
      childTest.projectName !== "worker" ||
      !Array.isArray(childTest.results) ||
      childTest.results.length !== 1 ||
      !isRecord(result) ||
      result.status !== status ||
      result.retry !== 0 ||
      !Array.isArray(result.errors)
    ) {
      throw new Error(
        `Scheduled expiry child case ${index + 1} differs from its expected result.`,
      );
    }
    const messages = result.errors.map((entry: unknown) =>
      isRecord(entry) && typeof entry.message === "string" ? entry.message : "",
    );
    if (index === 0) {
      if (
        !messages[0]?.includes("Test timeout of 1ms exceeded") ||
        messages.length > 2 ||
        (messages.length === 2 &&
          !messages[1].startsWith("AbortError: The operation was aborted"))
      ) {
        throw new Error(
          "Scheduled expiry child timeout has an unexpected failure class.",
        );
      }
    } else if (messages.length !== 0) {
      throw new Error(
        `Scheduled expiry child case ${index + 1} has an unexpected error.`,
      );
    }
  }
}

// One four-case child run reuses the Worker; retire it if schema mutation ends or an equivalent timeout observer replaces it.
outerTest(
  "a timed-out scheduled-expiry case leaves the next Worker case independent",
  async ({ childProbe }) => {
    const exit = await childProbe.completion;
    expect(exit).toEqual({ code: 1, signal: null, error: undefined });
    const report: unknown = JSON.parse(
      readFileSync(join(childProbe.directory, "report.json"), "utf8"),
    );
    verifyInterruptionReport(report);
  },
);

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
      'request',(select to_jsonb(r) from public.booking_requests r where id='${requestId}'),
      'capture',(select to_jsonb(w) from public.booking_request_capture_work w where booking_request_id='${requestId}'),
      'expiry',(select to_jsonb(w) from public.booking_request_payment_required_expiry_work w where booking_request_id='${requestId}'),
      'ledger',(select jsonb_agg(pg_temp.payment_fixture_operation_json(o) order by id) from public.payment_provider_operations o where claim_id='72000000-0000-4000-8000-000000001001'),
      'notices',(select coalesce(jsonb_agg(to_jsonb(n) order by id),'[]') from public.booking_request_status_notifications n where booking_request_id='${requestId}' and status='expired'),
      'confirmed',(select count(*) from public.booking_confirmations where booking_request_id='${requestId}'),
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
    scheduledExpiry.seeded = true;
    for (const definition of captureDefinitions)
      harness.runSql(paymentEvidenceSql + definition);
    harness.runSql(
      paymentEvidenceSql +
        `create function public.scheduled_payment_expiry_now() returns timestamptz language sql volatile security definer set search_path='' as $$select payment_required_deadline from public.booking_request_capture_work where booking_request_id='${requestId}'$$;`,
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
              `select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000001002',false);set role authenticated;select public.claim_customer_booking_request_payment_recovery('${requestId}','81000000-0000-4000-8000-000000001001','simulated-replacement');`,
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
            `set role service_role;select pg_temp.correction_observe('${requestId}','${receipt.providerOperationId}','${JSON.stringify(receipt)}'::jsonb,'late_succeeded',null,'${receipt.providerOperationId}');`,
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
          `set role service_role;select pg_temp.expiry_execute(pg_temp.expiry_prepare('${requestId}','{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}',${movement === "refund" ? "jsonb_build_object('action','refund','captureId',(select entry->>'captureId' from jsonb_array_elements(public.get_booking_request_payment_facts('" + requestId + "')->'expiryOperations') entry where entry->>'kind'='refund'))" : "jsonb_build_object('action','release','authorizationLifecycleId',public.get_booking_request_payment_facts('" + requestId + "')->>'originalLifecycleId','recoveryOperationId',null)"})->'permit','${outcome}','expiry-${movement}-${outcome}');`,
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
          expirySignatures.indexOf(
            "resolve_simulated_payment_effect(jsonb,text,jsonb)",
          )
        ],
    );
    harness.runSql(
      paymentEvidenceSql +
        clocked[
          expirySignatures.indexOf(
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
