import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { triggerScheduled } from "./fixtures/trigger-scheduled";

const { createLocalSupabaseConcurrencyHarness } = createRequire(
  import.meta.url,
)("../scripts/local-supabase-concurrency-harness.mjs") as {
  createLocalSupabaseConcurrencyHarness(): {
    guardDisposableLocalDatabase(): void;
    runSql(sql: string): string;
  };
};

test.describe.configure({ mode: "serial" });

test("scheduled worker delivers both due preparation reminders once", async ({
  baseURL,
}) => {
  const harness = createLocalSupabaseConcurrencyHarness();
  harness.guardDisposableLocalDatabase();
  const request = "60000000-0000-4000-8000-000000003501";
  const source = readFileSync(
    "supabase/tests/database/booking_confirmation_access.test.sql",
    "utf8",
  );
  const seedStart = source.indexOf("set session_replication_role = replica;");
  const seedEnd =
    source.indexOf("set session_replication_role = origin;", seedStart) +
    "set session_replication_role = origin;".length;
  const seed = source.slice(seedStart, seedEnd);
  const cleanupSource = readFileSync(
    "scripts/verify-booking-confirmation-notification-concurrency.mjs",
    "utf8",
  );
  const cleanup = cleanupSource
    .split("const cleanup = `")[1]
    .split("`;\n\n")[0]
    .replaceAll("${customerReceipt}", "82000000-0000-4000-8000-000000003502")
    .replaceAll("${ownerReceipt}", "82000000-0000-4000-8000-000000003501")
    .replaceAll("${request}", request)
    .replaceAll("${operation}", "81000000-0000-4000-8000-000000003501")
    .replaceAll("${confirmation}", "80000000-0000-4000-8000-000000003501")
    .replace(
      "delete from public.booking_request_confirmation_invalidations",
      `delete from public.booking_notification_events where booking_request_id='${request}';\ndelete from public.booking_request_confirmation_invalidations`,
    );
  const observe = () =>
    JSON.parse(
      harness.runSql(
        `select jsonb_build_object('events',(select jsonb_agg(jsonb_build_object('id',e.id,'recipientRole',e.recipient_role,'dueAt',e.due_at,'firstStartsAt',e.first_starts_at) order by e.recipient_role) from public.booking_notification_events e where e.booking_request_id='${request}' and e.event_kind='preparation_reminder'),'work',(select jsonb_agg(jsonb_build_object('eventId',w.event_id,'state',w.state,'payload',w.payload,'reference',w.supplier_delivery_reference) order by w.recipient_role) from public.booking_confirmation_notification_work w join public.booking_notification_events e on e.id=w.event_id where w.booking_request_id='${request}' and e.event_kind='preparation_reminder'),'effects',(select count(*) from public.fictional_booking_confirmation_notification_effects f join public.booking_notification_events e on e.id=f.event_id where f.booking_request_id='${request}' and e.event_kind='preparation_reminder'))`,
      ),
    ) as {
      events: Array<{
        id: string;
        recipientRole: string;
        dueAt: string;
        firstStartsAt: string;
      }>;
      work: Array<{
        eventId: string;
        state: string;
        payload: Record<string, unknown>;
        reference: string;
      }> | null;
      effects: number;
    };
  try {
    harness.runSql(cleanup);
    harness.runSql(seed);
    const anchor = harness.runSql("select clock_timestamp()");
    harness.runSql(`set session_replication_role=replica;
      update public.booking_snapshots set quote_payload=jsonb_set(quote_payload,'{items,0,startsAt}',to_jsonb('${anchor}'::timestamptz+interval '23 hours')) where id='40000000-0000-4000-8000-000000003501';
      update public.cottage_booking_period_commitments set access_ranges=tstzmultirange(tstzrange('${anchor}'::timestamptz+interval '23 hours','${anchor}'::timestamptz+interval '27 hours','[)')) where id='50000000-0000-4000-8000-000000003501';
      insert into public.booking_notification_events(id,booking_request_id,receipt_id,event_kind,recipient_user_id,recipient_role,notice_locale,due_at,first_starts_at,created_at)
      select gen_random_uuid(),'${request}',receipt.id,'preparation_reminder',receipt.recipient_user_id,receipt.recipient_role,'en','${anchor}'::timestamptz-interval '1 hour','${anchor}'::timestamptz+interval '23 hours',clock_timestamp()
      from public.booking_receipts receipt where receipt.booking_confirmation_id='80000000-0000-4000-8000-000000003501';
      set session_replication_role=origin;`);
    const before = observe();
    expect(before.events).toHaveLength(2);
    expect(before.work).toBeNull();
    expect(before.effects).toBe(0);

    const firstTick = await triggerScheduled(baseURL, "/__scheduled");
    expect(
      firstTick.ok,
      JSON.stringify({ response: await firstTick.text(), state: observe() }),
    ).toBe(true);
    const delivered = observe();
    expect(delivered.work).toHaveLength(2);
    expect(delivered.effects).toBe(2);
    for (const item of delivered.work ?? []) {
      expect(item.state).toBe("delivered");
      expect(item.payload).toMatchObject({
        kind: "preparation_reminder",
        fictional: true,
      });
      expect(item.payload).not.toHaveProperty("allocation");
      expect(JSON.stringify(item.payload)).not.toContain(
        "Current private address",
      );
      expect(item.reference).toBe(`fictional-booking-event-${item.eventId}`);
    }
    const repeatTick = await triggerScheduled(baseURL, "/__scheduled");
    expect(repeatTick.ok, await repeatTick.text()).toBe(true);
    expect(observe()).toEqual(delivered);
  } finally {
    harness.runSql(cleanup);
  }
});

test("scheduled reminders suppress invalid work and recover existing effects", async ({
  baseURL,
}) => {
  const harness = createLocalSupabaseConcurrencyHarness();
  harness.guardDisposableLocalDatabase();
  const request = "60000000-0000-4000-8000-000000003501";
  const owner = "10000000-0000-4000-8000-000000003501";
  const customer = "10000000-0000-4000-8000-000000003502";
  const source = readFileSync(
    "supabase/tests/database/booking_confirmation_access.test.sql",
    "utf8",
  );
  const seedStart = source.indexOf("set session_replication_role = replica;");
  const seedEnd =
    source.indexOf("set session_replication_role = origin;", seedStart) +
    "set session_replication_role = origin;".length;
  const seed = source.slice(seedStart, seedEnd);
  const cleanupSource = readFileSync(
    "scripts/verify-booking-confirmation-notification-concurrency.mjs",
    "utf8",
  );
  const cleanup = cleanupSource
    .split("const cleanup = `")[1]
    .split("`;\n\n")[0]
    .replaceAll("${customerReceipt}", "82000000-0000-4000-8000-000000003502")
    .replaceAll("${ownerReceipt}", "82000000-0000-4000-8000-000000003501")
    .replaceAll("${request}", request)
    .replaceAll("${operation}", "81000000-0000-4000-8000-000000003501")
    .replaceAll("${confirmation}", "80000000-0000-4000-8000-000000003501")
    .replace(
      "delete from public.booking_request_confirmation_invalidations",
      `delete from public.booking_notification_events where booking_request_id='${request}';
delete from public.booking_cancellation_incidents where cancellation_id in (select id from public.booking_cancellations where booking_request_id='${request}');
delete from public.booking_cancellations where booking_request_id='${request}';
delete from public.booking_incidents where booking_request_id='${request}';
delete from public.booking_lifecycle_outcomes where booking_request_id='${request}';
delete from public.booking_request_confirmation_invalidations`,
    );
  const state = () =>
    JSON.parse(
      harness.runSql(
        `select jsonb_build_object(
          'work',coalesce((select jsonb_agg(jsonb_build_object('role',w.recipient_role,'state',w.state,'reference',w.supplier_delivery_reference) order by w.recipient_role) from public.booking_confirmation_notification_work w join public.booking_notification_events e on e.id=w.event_id where e.booking_request_id='${request}' and e.event_kind='preparation_reminder'),'[]'),
          'effects',(select count(*) from public.fictional_booking_confirmation_notification_effects f join public.booking_notification_events e on e.id=f.event_id where e.booking_request_id='${request}' and e.event_kind='preparation_reminder'),
          'recoveredQueries',(select count(*) from public.booking_confirmation_notification_attempts a join public.booking_notification_events e on e.id=a.event_id where e.booking_request_id='${request}' and e.event_kind='preparation_reminder' and a.action='query' and a.outcome='delivered'))`,
      ),
    ) as {
      work: Array<{ role: string; state: string; reference: string | null }>;
      effects: number;
      recoveredQueries: number;
    };
  function resetAt(offset: string) {
    harness.runSql(cleanup);
    harness.runSql(seed);
    const firstStartsAt = harness.runSql(
      `select clock_timestamp()+interval '${offset}'`,
    );
    harness.runSql(`set session_replication_role=replica;
      update public.booking_snapshots set quote_payload=jsonb_set(quote_payload,'{items,0,startsAt}',to_jsonb('${firstStartsAt}'::timestamptz)) where id='40000000-0000-4000-8000-000000003501';
      update public.cottage_booking_period_commitments set access_ranges=tstzmultirange(tstzrange('${firstStartsAt}'::timestamptz,'${firstStartsAt}'::timestamptz+interval '4 hours','[)')) where id='50000000-0000-4000-8000-000000003501';
      insert into public.booking_notification_events(id,booking_request_id,receipt_id,event_kind,recipient_user_id,recipient_role,notice_locale,due_at,first_starts_at,created_at)
      select gen_random_uuid(),'${request}',receipt.id,'preparation_reminder',receipt.recipient_user_id,receipt.recipient_role,'en','${firstStartsAt}'::timestamptz-interval '24 hours','${firstStartsAt}',clock_timestamp()
      from public.booking_receipts receipt where receipt.booking_confirmation_id='80000000-0000-4000-8000-000000003501';
      set session_replication_role=origin;`);
    return firstStartsAt;
  }
  async function tick() {
    const response = await triggerScheduled(baseURL, "/__scheduled");
    expect(response.ok, await response.text()).toBe(true);
  }
  try {
    resetAt("25 hours");
    expect(state()).toMatchObject({ work: [], effects: 0 });
    await tick();
    expect(state()).toMatchObject({ work: [], effects: 0 });

    const cancelledStart = resetAt("23 hours");
    expect(state().work).toEqual([]);
    harness.runSql(`set session_replication_role=replica;
      insert into public.booking_cancellations(id,booking_request_id,booking_confirmation_id,capture_operation_id,command_id,command_fingerprint,actor_user_id,actor_role,first_starts_at,occurred_at,refund_booking_price_fils,refund_booking_service_fee_fils)
      values('86000000-0000-4000-8000-000000003501','${request}','80000000-0000-4000-8000-000000003501','81000000-0000-4000-8000-000000003501','87000000-0000-4000-8000-000000003501',repeat('c',64),'${customer}','customer','${cancelledStart}',clock_timestamp(),0,0);
      update public.account_contexts set owner_approval_state='suspended' where user_id='${owner}';
      set session_replication_role=origin;`);
    await tick();
    expect(state()).toMatchObject({
      work: [
        { role: "cottage_owner", state: "suppressed", reference: null },
        { role: "customer", state: "suppressed", reference: null },
      ],
      effects: 0,
    });

    resetAt("-1 hour");
    expect(state().work).toEqual([]);
    await tick();
    expect(state()).toMatchObject({
      work: [
        { role: "cottage_owner", state: "suppressed" },
        { role: "customer", state: "suppressed" },
      ],
      effects: 0,
    });

    resetAt("23 hours");
    await tick();
    expect(state()).toMatchObject({ effects: 2 });
    harness.runSql(`set session_replication_role=replica;
      update public.booking_confirmation_notification_work set state='uncertain',lease_token=null,lease_expires_at=null,last_outcome='unknown',supplier_delivery_reference=null,delivered_at=null where recipient_role='customer' and event_id is not null;
      set session_replication_role=origin;`);
    const beforeRecovery = state();
    await tick();
    const recovered = state();
    expect(recovered.effects).toBe(beforeRecovery.effects);
    expect(recovered.recoveredQueries).toBeGreaterThan(
      beforeRecovery.recoveredQueries,
    );
    expect(recovered.work).toContainEqual(
      expect.objectContaining({ role: "customer", state: "delivered" }),
    );

    resetAt("23 hours");
    await tick();
    harness.runSql(`set session_replication_role=replica;
      delete from public.booking_confirmation_notification_attempts where event_id is not null;
      delete from public.fictional_booking_confirmation_notification_effects where event_id is not null;
      update public.booking_confirmation_notification_work set state='retryable',lease_token=null,lease_expires_at=null,last_outcome='failed',supplier_delivery_reference=null,delivered_at=null where event_id is not null;
      set session_replication_role=origin;`);
    await tick();
    expect(state()).toMatchObject({
      work: [
        { role: "cottage_owner", state: "retryable" },
        { role: "customer", state: "retryable" },
      ],
      effects: 0,
    });
    harness.runSql(
      `update public.account_contexts set owner_approval_state='suspended' where user_id='${owner}'`,
    );
    await tick();
    expect(state()).toMatchObject({
      work: [
        { role: "cottage_owner", state: "suppressed" },
        { role: "customer", state: "retryable" },
      ],
      effects: 0,
    });
  } finally {
    harness.runSql(cleanup);
  }
});
