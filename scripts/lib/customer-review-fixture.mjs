import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const completionSource = readFileSync(
  new URL(
    "../../supabase/tests/database/booking_completion.test.sql",
    import.meta.url,
  ),
  "utf8",
);

function markedBlock(name) {
  const startMarker = `-- BEGIN ${name}`;
  const endMarker = `-- END ${name}`;
  const start = completionSource.indexOf(startMarker);
  const end = completionSource.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `Missing ${name}`);
  assert.equal(
    completionSource.lastIndexOf(startMarker),
    start,
    `Duplicate ${name} start`,
  );
  assert.equal(
    completionSource.lastIndexOf(endMarker),
    end,
    `Duplicate ${name} end`,
  );
  return completionSource.slice(start, end + endMarker.length);
}

const sourceFixture = `${markedBlock("PAYMENT EVIDENCE FIXTURE")}\n${markedBlock("COMPLETION FIXTURE")}`;

function fixtureUuid(namespace, sequence) {
  return `${namespace}000000-0000-4000-8000-00000000${String(sequence).padStart(4, "0")}`;
}

export function customerReviewFixture({
  namespace,
  startDaySql,
  accessRangesSql,
  complete = true,
  confirm = complete,
  publish = false,
  sharedCottage,
}) {
  assert.match(namespace, /^[0-9]{2}$/);
  assert.equal(typeof startDaySql, "string");
  assert.ok(startDaySql.length > 0);
  assert.equal(typeof complete, "boolean");
  assert.equal(typeof confirm, "boolean");
  assert.ok(!complete || confirm, "Completion requires confirmation");
  if (sharedCottage) {
    assert.equal(publish, false, "A shared cottage is already published");
    assert.match(sharedCottage.namespace, /^[0-9]{2}$/);
    assert.notEqual(sharedCottage.namespace, namespace);
    assert.match(
      sharedCottage.ownerUserId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    assert.match(
      sharedCottage.profileId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    assert.match(sharedCottage.publicSlug, /^cottage-[0-9a-f]{32}$/);
  }

  const suffix = (sequence) =>
    `00000000${namespace}${String(sequence).padStart(2, "0")}`;
  const replacements = new Map([
    ["000000001001", suffix(1)],
    ["000000001002", suffix(2)],
    ["000000001003", suffix(3)],
    ["000000003801", suffix(81)],
    ["0000000000001001", `000000000000${namespace}01`],
    ["seed_completion_booking", `seed_customer_review_booking_${namespace}`],
    ["confirmation_capture_lease", `review_${namespace}_capture_lease`],
    ["confirmation_capture_result", `review_${namespace}_capture_result`],
    ["confirmation_capture", `review_${namespace}_capture`],
    ["+9647500001001", `+964750000${namespace}01`],
    ["+9647500001002", `+964750000${namespace}02`],
    ["+9647500001003", `+964750000${namespace}03`],
    ["CONFIRMATION-HOLD-1", `CUSTOMER-REVIEW-HOLD-${namespace}`],
    ["confirmation-cottage", `customer-review-cottage-${namespace}`],
    ["confirmation-auth-request-1", `review-${namespace}-auth-request`],
    ["confirmation-auth-reference-1", `review-${namespace}-auth-reference`],
    ["confirmation-auth-movement-1", `review-${namespace}-auth-movement`],
    [
      "cancellation-admin@example.test",
      `customer-review-${namespace}-admin@example.test`,
    ],
  ]);
  let sql = sourceFixture;
  for (const [from, to] of replacements) sql = sql.replaceAll(from, to);
  if (accessRangesSql) {
    const fixedRanges =
      `'{["2101-01-01 05:00+00","2101-01-01 09:00+00"),` +
      `["2101-01-01 17:00+00","2101-01-01 23:00+00"),` +
      `["2101-01-02 05:00+00","2101-01-02 23:00+00")}'::tstzmultirange`;
    assert.equal(
      sql.split(fixedRanges).length - 1,
      2,
      "The fixture commitment and authorization claim share fixed ranges",
    );
    sql = sql.replaceAll(fixedRanges, accessRangesSql);
  }

  const requestId = `60000000-0000-4000-8000-${suffix(1)}`;
  const customerUserId = `10000000-0000-4000-8000-${suffix(2)}`;
  const otherCustomerUserId = `10000000-0000-4000-8000-${suffix(3)}`;
  const fixtureOwnerUserId = `10000000-0000-4000-8000-${suffix(1)}`;
  const administratorUserId = `10000000-0000-4000-8000-${suffix(81)}`;
  const fixtureProfileId = `20000000-0000-4000-8000-${suffix(1)}`;
  const fixtureScheduleId = `30000000-0000-4000-8000-${suffix(1)}`;
  const ownerUserId = sharedCottage?.ownerUserId ?? fixtureOwnerUserId;
  const profileId = sharedCottage?.profileId ?? fixtureProfileId;
  const scheduleId = sharedCottage
    ? `30000000-0000-4000-8000-00000000${sharedCottage.namespace}01`
    : fixtureScheduleId;
  const bookingReference = `RC-REQ-000000000000${namespace}01`;
  const paymentLifecycleId = `73000000-0000-4000-8000-${suffix(1)}`;
  const captureFingerprint = createHash("sha256")
    .update(
      `{"provider":{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"},"kind":"capture","paymentLifecycleId":"${paymentLifecycleId}","logicalOperationId":"${paymentLifecycleId}:capture","attemptId":"${paymentLifecycleId}:capture:attempt-2","amountFils":115000000,"currency":"IQD"}`,
      "utf8",
    )
    .digest("hex");
  sql = sql.replace(
    "6f86ac037886a0823766736c1c1ffb409cd9c98be93f038e0cfe5219c2a4a99d",
    captureFingerprint,
  );
  if (sharedCottage) {
    const ownerAuthRow = `('${fixtureOwnerUserId}','authenticated','authenticated','+964750000${namespace}01',now()),\n`;
    const ownerContextRow = `('${fixtureOwnerUserId}','cottage_owner','approved'),\n`;
    const cottageSetup =
      /insert into public\.owner_application_cottage_profiles[\s\S]*?select set_config\('rentcottage\.shift_schedule_write_revision_id','',true\);\n/;
    const withoutOwnerAuth = sql.replace(ownerAuthRow, "");
    assert.notEqual(
      withoutOwnerAuth,
      sql,
      "Customer review owner identity fixture changed",
    );
    const withoutOwnerContext = withoutOwnerAuth.replace(ownerContextRow, "");
    assert.notEqual(
      withoutOwnerContext,
      withoutOwnerAuth,
      "Customer review owner context fixture changed",
    );
    const withoutCottageSetup = withoutOwnerContext.replace(cottageSetup, "");
    assert.notEqual(
      withoutCottageSetup,
      withoutOwnerContext,
      "Customer review shared-cottage fixture changed",
    );
    sql = withoutCottageSetup
      .replaceAll(fixtureOwnerUserId, ownerUserId)
      .replaceAll(fixtureProfileId, profileId)
      .replaceAll(fixtureScheduleId, scheduleId)
      .replaceAll(
        `31000000-0000-4000-8000-${suffix(1)}`,
        `31000000-0000-4000-8000-00000000${sharedCottage.namespace}01`,
      );
    for (const sequence of [1, 2, 3]) {
      sql = sql.replaceAll(
        `32000000-0000-4000-8000-${suffix(sequence)}`,
        `32000000-0000-4000-8000-00000000${sharedCottage.namespace}${String(sequence).padStart(2, "0")}`,
      );
    }
  }

  sql += `
select pg_temp.seed_customer_review_booking_${namespace}(
  ${startDaySql},${confirm ? "true" : "false"}
);
`;
  if (complete) {
    sql += `
set role service_role;
select public.commit_booking_completion(
  '${requestId}',
  (
    select value->>'revision'
    from public.list_due_booking_completions(50) value
    where value->>'bookingRequestId'='${requestId}'
  )
);
reset role;
`;
  }

  if (publish) {
    const sourceRevisionId = fixtureUuid(namespace, 901);
    const reviewCycleId = fixtureUuid(namespace, 902);
    const publicationId = fixtureUuid(namespace, 903);
    const localizedIds = [
      fixtureUuid(namespace, 911),
      fixtureUuid(namespace, 912),
      fixtureUuid(namespace, 913),
    ];
    sql += `
insert into public.cottage_profile_source_revisions(
  id,profile_id,owner_user_id,source_language,description,house_rules,revision
) values ('${sourceRevisionId}','${profileId}','${ownerUserId}','en',
  'Review fixture description','Review fixture rules',1);
insert into public.cottage_profile_review_cycles(
  id,profile_id,owner_user_id,source_revision_id,name,governorate,
  approximate_location,capacity,bedrooms,bathrooms,amenities,cycle_number,state,decided_at
) values ('${reviewCycleId}','${profileId}','${ownerUserId}','${sourceRevisionId}',
  'Review Cottage','Baghdad','Karrada',8,3,2,array['garden'],1,'approved',clock_timestamp());
insert into public.cottage_profile_localized_revisions(
  id,review_cycle_id,locale,revision,origin,description,house_rules,
  provider,model,effort,prompt_version
) values
  ('${localizedIds[0]}','${reviewCycleId}','en',1,'owner_source','English description','English rules',null,null,null,null),
  ('${localizedIds[1]}','${reviewCycleId}','ar',1,'generated','وصف عربي','قواعد عربية','fictional','fixture-model','low','fixture-v1'),
  ('${localizedIds[2]}','${reviewCycleId}','ckb',1,'generated','وەسفی کوردی','یاساکانی کوردی','fictional','fixture-model','low','fixture-v1');
insert into public.cottage_profile_publication_decisions(
  review_cycle_id,administrator_user_id,approved,reason
) values ('${reviewCycleId}','${administratorUserId}',true,'Approved fictional review fixture');
insert into public.cottage_publication_snapshots(
  id,profile_id,review_cycle_id,publication_number,name,governorate,
  approximate_location,capacity,bedrooms,bathrooms,amenities
) values ('${publicationId}','${profileId}','${reviewCycleId}',1,
  'Review Cottage','Baghdad','Karrada',8,3,2,array['garden']);
insert into public.cottage_publication_localizations(
  publication_id,locale,localized_revision_id,description,house_rules
) values
  ('${publicationId}','en','${localizedIds[0]}','English description','English rules'),
  ('${publicationId}','ar','${localizedIds[1]}','وصف عربي','قواعد عربية'),
  ('${publicationId}','ckb','${localizedIds[2]}','وەسفی کوردی','یاساکانی کوردی');
update public.owner_application_cottage_profiles
set current_shift_schedule_id='${scheduleId}',current_publication_id='${publicationId}'
where id='${profileId}';
`;
  }

  return {
    sql,
    ids: {
      administratorUserId,
      bookingReference,
      customerUserId,
      otherCustomerUserId,
      ownerUserId,
      profileId,
      requestId,
    },
    publicSlug:
      sharedCottage?.publicSlug ?? `cottage-${profileId.replaceAll("-", "")}`,
  };
}
