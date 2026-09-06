import { expect, test } from "@playwright/test";
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

test("the actual Worker settles capture despite expiry failure and repeated scheduling preserves one paid booking", async ({
  request,
}) => {
  const harness = createLocalSupabaseConcurrencyHarness();
  harness.guardDisposableLocalDatabase();
  const id = "60000000-0000-4000-8000-000000001001";
  const source = readFileSync(
    "supabase/tests/database/booking_request_confirmation.test.sql",
    "utf8",
  )
    .split("-- BEGIN CAPTURE RECOVERY SOURCE\n")[1]
    .split("-- END CAPTURE RECOVERY SOURCE")[0];
  const pending = source.slice(
    0,
    source.indexOf("insert into public.booking_request_capture_work"),
  );
  const cleanup = readFileSync(
    "scripts/verify-booking-request-capture-concurrency.mjs",
    "utf8",
  )
    .split("const cleanup = `")[1]
    .split("`;")[0]
    .replaceAll("${requestId}", id);
  const expiryDefinition = harness.runSql(
    "select pg_get_functiondef('public.claim_due_booking_request_releases(integer)'::regprocedure);",
  );
  const observe = () =>
    JSON.parse(
      harness.runSql(`select jsonb_build_object(
    'work', (select to_jsonb(work) from public.booking_request_capture_work work where booking_request_id = '${id}'),
    'execution', (select to_jsonb(operation) from public.simulated_payment_provider_operations operation where payment_lifecycle_id = '73000000-0000-4000-8000-000000001001' and operation_kind = 'capture'),
    'confirmation', (select to_jsonb(confirmation) from public.booking_confirmations confirmation where booking_request_id = '${id}'),
    'receipts', (select jsonb_agg(to_jsonb(receipt) order by receipt.id) from public.booking_receipts receipt join public.booking_confirmations confirmation on confirmation.id = receipt.booking_confirmation_id where confirmation.booking_request_id = '${id}'),
    'occupancies', (select jsonb_agg(to_jsonb(occupancy) order by shift_id, service_day) from public.cottage_booking_period_occupancies occupancy where booking_period_commitment_id = '50000000-0000-4000-8000-000000001001'),
    'commitment', (select to_jsonb(commitment) from public.cottage_booking_period_commitments commitment where id = '50000000-0000-4000-8000-000000001001')
  );`),
    );
  let seeded = false;
  try {
    harness.runSql(`begin; ${pending}
      update public.booking_requests set status = 'pending', settled_at = null where id = '${id}';
      set local role service_role;
      select public.claim_booking_request_action('10000000-0000-4000-8000-000000001001', '${id}', 'accept'); commit;`);
    seeded = true;
    const before = observe();
    expect(before.work.state).toBe("queued");
    expect(before.execution).toBeNull();
    expect(before.confirmation).toBeNull();
    harness.runSql(`create or replace function public.claim_due_booking_request_releases(target_limit integer)
      returns jsonb language plpgsql security definer set search_path = '' as $$ begin raise exception 'Injected local expiry failure'; end; $$;`);
    expect((await request.get("/__scheduled")).ok()).toBe(false);
    const confirmed = observe();
    expect(confirmed.work.state).toBe("complete");
    expect(confirmed.execution.physical_execution_count).toBe(1);
    expect(confirmed.execution.amount_fils).toBe(115000000);
    expect(confirmed.confirmation.booking_request_id).toBe(id);
    expect(confirmed.receipts).toHaveLength(2);
    expect(confirmed.occupancies).toEqual(before.occupancies);
    expect(confirmed.occupancies).toHaveLength(5);
    expect(confirmed.commitment.status).toBe("confirmed_booking");
    harness.runSql(expiryDefinition);
    for (let replay = 0; replay < 2; replay++)
      expect((await request.get("/__scheduled")).ok()).toBe(true);
    expect(observe()).toEqual(confirmed);
  } finally {
    harness.runSql(expiryDefinition);
    if (seeded) harness.runSql(cleanup);
  }
});

test("the actual Worker recovers a persisted definitive failure into one fixed Payment Required window", async ({
  request,
}) => {
  const harness = createLocalSupabaseConcurrencyHarness();
  harness.guardDisposableLocalDatabase();
  const id = "60000000-0000-4000-8000-000000001001";
  const source = readFileSync(
    "supabase/tests/database/booking_request_confirmation.test.sql",
    "utf8",
  )
    .split("-- BEGIN CAPTURE RECOVERY SOURCE\n")[1]
    .split("-- END CAPTURE RECOVERY SOURCE")[0];
  const pending = source.slice(
    0,
    source.indexOf("insert into public.booking_request_capture_work"),
  );
  const cleanup = readFileSync(
    "scripts/verify-booking-request-capture-concurrency.mjs",
    "utf8",
  )
    .split("const cleanup = `")[1]
    .split("`;")[0]
    .replaceAll("${requestId}", id);
  const observe = () =>
    JSON.parse(
      harness.runSql(`select jsonb_build_object(
        'work',(select to_jsonb(work) from public.booking_request_capture_work work where booking_request_id='${id}'),
        'execution',(select to_jsonb(operation) from public.simulated_payment_provider_operations operation where operation_kind='capture' and payment_lifecycle_id='73000000-0000-4000-8000-000000001001'),
        'confirmation',(select to_jsonb(confirmation) from public.booking_confirmations confirmation where booking_request_id='${id}'),
        'paymentRequiredNotifications',(select count(*) from public.booking_request_status_notifications notification where booking_request_id='${id}' and status='payment-required'),
        'commitment',(select to_jsonb(commitment) from public.cottage_booking_period_commitments commitment where id='50000000-0000-4000-8000-000000001001'),
        'occupancies',(select jsonb_agg(to_jsonb(occupancy) order by shift_id,service_day) from public.cottage_booking_period_occupancies occupancy where booking_period_commitment_id='50000000-0000-4000-8000-000000001001'),
        'intentActive',(select intent_dedupe_active from public.booking_request_submission_attempts where booking_request_id='${id}')
      );`),
    );
  let seeded = false;
  try {
    harness.runSql(`begin; ${pending}
      update public.booking_requests set status='pending',settled_at=null where id='${id}';
      set local role service_role;
      select public.claim_booking_request_action('10000000-0000-4000-8000-000000001001','${id}','accept'); commit;`);
    seeded = true;
    harness.runSql(`set role service_role;
      with leased as (select public.lease_booking_request_capture_work('${id}',
        '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb) result)
      select public.execute_simulated_booking_request_capture(result->'permit','failed') from leased;
      reset role;
      update public.booking_request_capture_work set lease_expires_at=clock_timestamp()-interval '1 second' where booking_request_id='${id}';`);
    const before = observe();
    expect(before.execution.original_outcome).toBe("failed");
    expect(before.execution.movement_reference).toBeNull();
    expect(before.work.state).toBe("processing");
    expect((await request.get("/__scheduled")).ok()).toBe(true);
    const paymentRequired = observe();
    expect(paymentRequired.work.state).toBe("payment_required");
    expect(
      Date.parse(paymentRequired.work.payment_required_deadline) -
        Date.parse(paymentRequired.work.payment_required_recorded_at),
    ).toBe(1_200_000);
    expect(paymentRequired.paymentRequiredNotifications).toBe(1);
    expect(paymentRequired.confirmation).toBeNull();
    expect(paymentRequired.commitment.status).toBe("pending_hold");
    expect(paymentRequired.occupancies).toEqual(before.occupancies);
    expect(paymentRequired.occupancies).toHaveLength(5);
    expect(paymentRequired.intentActive).toBe(true);
    expect((await request.get("/__scheduled")).ok()).toBe(true);
    expect(observe()).toEqual(paymentRequired);
  } finally {
    if (seeded) harness.runSql(cleanup);
  }
});
