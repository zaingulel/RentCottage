import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";
import { prepareIsolatedSupabaseWorkdir } from "./verify-access.mjs";

const shippedMigration = "20260922021110_customer_review_read_access_repair.sql";
const upgradeMigration = "20260927094658_administrator_records.sql";
const project = "rentcottage-admin-upgrade";
const stateRoot = mkdtempSync(join(tmpdir(), "rentcottage-administrator-records-upgrade-"));
const dockerConfig = join(stateRoot, "docker");
mkdirSync(dockerConfig);
let assertions = 0;
let started = false;

function check(actual, expected, message) {
  assert.deepEqual(actual, expected, message);
  assertions += 1;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      DOCKER_CONFIG: dockerConfig,
      DO_NOT_TRACK: "1",
      SUPABASE_TELEMETRY_DISABLED: "1",
    },
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
}

function markedFixture() {
  const source = readFileSync(
    new URL("../supabase/tests/database/administrator_records.test.sql", import.meta.url),
    "utf8",
  );
  const startMarker = "-- BEGIN ADMINISTRATOR RECORDS FIXTURE";
  const endMarker = "-- END ADMINISTRATOR RECORDS FIXTURE";
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, "Administrator fixture markers must be ordered");
  assert.equal(source.lastIndexOf(startMarker), start, "Administrator fixture start must be unique");
  assert.equal(source.lastIndexOf(endMarker), end, "Administrator fixture end must be unique");
  const fixture = source.slice(start + startMarker.length, end).trim();
  assert.ok(fixture.length > 0, "Administrator fixture must not be empty");
  return fixture;
}

const workingDirectory = resolve(process.cwd());
const localWorkdir = prepareIsolatedSupabaseWorkdir({
  localProject: project,
  stateRoot,
  workingDirectory,
});
const localSupabase = join(localWorkdir, "supabase");
const configPath = join(localSupabase, "config.toml");
writeFileSync(
  configPath,
  readFileSync(configPath, "utf8")
    .replaceAll("5533", "5733")
    .replace("8183", "8383"),
);
const isolatedMigrations = join(localSupabase, "migrations");
unlinkSync(isolatedMigrations);
mkdirSync(isolatedMigrations);
const sourceMigrations = join(workingDirectory, "supabase", "migrations");
for (const migration of readdirSync(sourceMigrations).sort()) {
  if (migration > shippedMigration) continue;
  symlinkSync(join(sourceMigrations, migration), join(isolatedMigrations, migration));
}
const environment = {
  ...process.env,
  DOCKER_CONFIG: dockerConfig,
  DO_NOT_TRACK: "1",
  SUPABASE_TELEMETRY_DISABLED: "1",
  SUPABASE_DB_CONTAINER: `supabase_db_${project}`,
  SUPABASE_LOCAL_PROJECT: project,
  SUPABASE_LOCAL_WORKDIR: localWorkdir,
};
const harness = createLocalSupabaseConcurrencyHarness({
  environment,
  workingDirectory: localWorkdir,
});
const supabaseArguments = (args) => [...args, "--workdir", localWorkdir];
const fixture = markedFixture();
const retainedDigestSql = `select md5(jsonb_build_object(
  'accounts',(select jsonb_agg(to_jsonb(value) order by value.user_id) from public.account_contexts value where value.user_id::text like '25000000-%'),
  'applications',(select jsonb_agg(to_jsonb(value) order by value.id) from public.owner_applications value where value.id::text like '25000000-%'),
  'transitions',(select jsonb_agg(to_jsonb(value) order by value.application_id,value.application_version) from public.owner_application_transitions value where value.application_id::text like '25000000-%'),
  'profiles',(select jsonb_agg(to_jsonb(value) order by value.id) from public.owner_application_cottage_profiles value where value.id::text like '25000000-%'),
  'cycles',(select jsonb_agg(to_jsonb(value) order by value.profile_id,value.cycle_number) from public.cottage_profile_review_cycles value where value.profile_id='25000000-0000-4000-8000-000000000401'),
  'localizedDecisions',(select jsonb_agg(to_jsonb(value) order by value.id) from public.cottage_profile_localized_decisions value where value.review_cycle_id in (select id from public.cottage_profile_review_cycles where profile_id='25000000-0000-4000-8000-000000000401')),
  'publicationDecisions',(select jsonb_agg(to_jsonb(value) order by value.id) from public.cottage_profile_publication_decisions value where value.review_cycle_id in (select id from public.cottage_profile_review_cycles where profile_id='25000000-0000-4000-8000-000000000401'))
)::text);`;
const adminClaims = `set local role authenticated;
set local request.jwt.claims = '{"sub":"25000000-0000-4000-8000-000000000201","role":"authenticated","aal":"aal2"}';`;

try {
  run("npx", supabaseArguments([
    "supabase", "start", "-x",
    "realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor",
  ]));
  harness.guardDisposableLocalDatabase();
  started = true;
  check(harness.runSql("select max(version) from supabase_migrations.schema_migrations;"),
    shippedMigration.slice(0, 14), "upgrade starts at the shipped migration cutoff");
  check(harness.runSql("select to_regprocedure('public.search_administrator_records(text,text,text,date,date,uuid,timestamptz,uuid)') is null;"),
    "t", "administrator reader is absent before upgrade");
  harness.runSql(`begin;\n${fixture}\ncommit;`);
  check(harness.runSql("select count(*)::integer from public.account_contexts where user_id::text like '25000000-%' and role in ('customer','cottage_owner');"),
    "32", "fixture retains 32 customer-capable accounts");
  check(harness.runSql("select count(*)::integer from public.cottage_profile_review_cycles where profile_id='25000000-0000-4000-8000-000000000401' and state='in_review';"),
    "1", "fixture retains the pending remediation cycle");
  const retainedBefore = harness.runSql(retainedDigestSql);
  harness.runSql(readFileSync(join(sourceMigrations, upgradeMigration), "utf8"));
  check(harness.runSql("select to_regprocedure('public.search_administrator_records(text,text,text,date,date,uuid,timestamptz,uuid)') is not null;"),
    "t", "administrator reader exists after upgrade");
  check(harness.runSql(retainedDigestSql), retainedBefore,
    "upgrade preserves accounts, applications, profiles and decision history");
  const search = JSON.parse(harness.runSql(`begin;\n${adminClaims}\nselect public.search_administrator_records('customers',null,null,null,null,null,null,null);\ncommit;`).split("\n")[0]);
  check([search.total, search.rows.length, search.pendingApplications, search.pendingApprovals],
    [32, 25, 2, 1], "AAL2 search returns bounded rows and authoritative counts");
  const approval = JSON.parse(harness.runSql(`begin;\n${adminClaims}\nselect public.get_administrator_record('approval',
    (select id from public.cottage_profile_review_cycles where profile_id='25000000-0000-4000-8000-000000000401' and cycle_number=1));\ncommit;`).split("\n")[0]);
  check([approval.state, approval.localizedDecisions.length, approval.publicationDecision.approved],
    ["approved", 3, true], "historical approval and decisions remain readable");
  check(harness.runSql(`begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"25000000-0000-4000-8000-000000000201","role":"authenticated","aal":"aal1"}';
do $$begin perform public.search_administrator_records('customers',null,null,null,null,null,null,null);
raise exception 'AAL1 unexpectedly admitted'; exception when insufficient_privilege then null; end$$;
commit;`), "", "AAL1 administrator remains denied");
  check(harness.runSql(`begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"25000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}';
do $$begin perform public.get_administrator_record('account','25000000-0000-4000-8000-000000000001');
raise exception 'customer unexpectedly admitted'; exception when insufficient_privilege then null; end$$;
commit;`), "", "customer remains denied even for own account");
  console.log(`Administrator records upgrade verification passed (${assertions} assertions).`);
} finally {
  if (started) {
    harness.guardDisposableLocalDatabase();
    run("npx", supabaseArguments(["supabase", "stop", "--no-backup", "--project-id", project]));
    rmSync(stateRoot, { recursive: true, force: true });
  } else {
    console.error(`Retained upgrade verifier state at ${stateRoot}.`);
  }
}
