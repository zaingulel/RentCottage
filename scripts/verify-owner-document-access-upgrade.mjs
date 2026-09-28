import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";
import { prepareIsolatedSupabaseWorkdir } from "./verify-access.mjs";

const shippedMigration = "20260927094658_administrator_records.sql";
const upgradeMigration = "20260927222958_owner_document_review_access.sql";
const project = "rentcottage-owner-doc-upgrade";
const suppliedStateRoot = process.env.OWNER_DOCUMENT_UPGRADE_STATE_ROOT;
const stateRoot =
  suppliedStateRoot ??
  mkdtempSync(join(tmpdir(), "rentcottage-owner-document-upgrade-"));
if (suppliedStateRoot) {
  if (
    !isAbsolute(suppliedStateRoot) ||
    resolve(suppliedStateRoot) !== suppliedStateRoot ||
    realpathSync(suppliedStateRoot) !== suppliedStateRoot ||
    !statSync(suppliedStateRoot).isDirectory() ||
    readdirSync(suppliedStateRoot).length !== 0
  ) {
    throw new Error(
      "Owner document upgrade state root must be an existing canonical empty directory.",
    );
  }
}
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
    throw new Error(
      `${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`,
    );
  }
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
    .replaceAll("5533", "5833")
    .replace("8183", "8483"),
);
const isolatedMigrations = join(localSupabase, "migrations");
unlinkSync(isolatedMigrations);
mkdirSync(isolatedMigrations);
const sourceMigrations = join(workingDirectory, "supabase", "migrations");
for (const migration of readdirSync(sourceMigrations).sort()) {
  if (migration > shippedMigration) continue;
  symlinkSync(
    join(sourceMigrations, migration),
    join(isolatedMigrations, migration),
  );
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
const adminClaims = `set local role authenticated;
set local request.jwt.claims = '{"sub":"26000000-0000-4000-8000-000000000201","role":"authenticated","aal":"aal2"}';`;
const submittedDocument = "46000000-0000-4000-8000-000000000101";
const reviewDocument = "46000000-0000-4000-8000-000000000102";
const draftDocument = "46000000-0000-4000-8000-000000000103";
const retainedDigestSql = `select md5(jsonb_build_object(
  'users',(select jsonb_agg(to_jsonb(value) order by value.id) from auth.users value where value.id::text like '26000000-%'),
  'accounts',(select jsonb_agg(to_jsonb(value) order by value.user_id) from public.account_contexts value where value.user_id::text like '26000000-%'),
  'applications',(select jsonb_agg(to_jsonb(value) order by value.id) from public.owner_applications value where value.id::text like '36000000-%'),
  'documents',(select jsonb_agg(to_jsonb(value) order by value.id) from public.owner_verification_documents value where value.id::text like '46000000-%'),
  'versions',(select jsonb_agg(to_jsonb(value) order by value.document_id,value.version) from public.owner_verification_document_versions value where value.document_id::text like '46000000-%'),
  'audit',(select jsonb_agg(to_jsonb(value) order by value.id) from public.owner_verification_document_audit value where value.document_id::text like '46000000-%'),
  'priorGrant',(select to_jsonb(value) from public.owner_verification_document_access_grants value where value.id = '%PRIOR_GRANT%'::uuid)
)::text);`;

function prepare(documentId) {
  return JSON.parse(
    harness
      .runSql(
        `begin;\n${adminClaims}\nselect public.prepare_owner_verification_document_access('${documentId}');\ncommit;`,
      )
      .split("\n")[0],
  );
}

function denied(documentId, claims = adminClaims) {
  return harness.runSql(`begin;
${claims}
do $$begin
  perform public.prepare_owner_verification_document_access('${documentId}');
  raise exception 'Unexpected access';
exception when sqlstate 'RC204' then null;
end$$;
commit;`);
}

try {
  run(
    "npx",
    supabaseArguments([
      "supabase",
      "start",
      "-x",
      "realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor",
    ]),
  );
  harness.guardDisposableLocalDatabase();
  started = true;
  check(
    harness.runSql(
      "select max(version) from supabase_migrations.schema_migrations;",
    ),
    shippedMigration.slice(0, 14),
    "upgrade starts at the shipped migration cutoff",
  );
  harness.runSql(`insert into auth.users (id, aud, role, email, email_confirmed_at)
values
  ('26000000-0000-4000-8000-000000000101','authenticated','authenticated','submitted-owner@example.test',now()),
  ('26000000-0000-4000-8000-000000000102','authenticated','authenticated','review-owner@example.test',now()),
  ('26000000-0000-4000-8000-000000000103','authenticated','authenticated','draft-owner@example.test',now()),
  ('26000000-0000-4000-8000-000000000201','authenticated','authenticated','review-admin@example.test',now());
insert into public.account_contexts (user_id, role, owner_approval_state)
values
  ('26000000-0000-4000-8000-000000000101','cottage_owner','prospective'),
  ('26000000-0000-4000-8000-000000000102','cottage_owner','prospective'),
  ('26000000-0000-4000-8000-000000000103','cottage_owner','prospective'),
  ('26000000-0000-4000-8000-000000000201','platform_administrator',null);
insert into public.owner_applications (
  id, owner_user_id, applicant_kind, legal_name, licensing_basis,
  status, submitted_at, review_started_at, review_due_at
) values
  ('36000000-0000-4000-8000-000000000101','26000000-0000-4000-8000-000000000101','individual','Submitted Owner','licence','submitted',now(),now(),now()+interval '72 hours'),
  ('36000000-0000-4000-8000-000000000102','26000000-0000-4000-8000-000000000102','individual','Review Owner','licence','under_review',now(),now(),now()+interval '72 hours'),
  ('36000000-0000-4000-8000-000000000103','26000000-0000-4000-8000-000000000103','individual','Draft Owner','licence','draft',null,null,null);
insert into public.owner_verification_documents (
  id, application_id, kind, object_path, original_filename, media_type, size_bytes
) values
  ('${submittedDocument}','36000000-0000-4000-8000-000000000101','identity','owner/upgrade/submitted.pdf','submitted.pdf','application/pdf',128),
  ('${reviewDocument}','36000000-0000-4000-8000-000000000102','identity','owner/upgrade/review.pdf','review.pdf','application/pdf',128),
  ('${draftDocument}','36000000-0000-4000-8000-000000000103','identity','owner/upgrade/draft.pdf','draft.pdf','application/pdf',128);
insert into public.owner_verification_document_audit (
  document_id, actor_user_id, actor_subject_id, action, object_path
) values
  ('${reviewDocument}','26000000-0000-4000-8000-000000000102','26000000-0000-4000-8000-000000000102','uploaded','owner/upgrade/review.pdf');`);
  check(
    harness.runSql(
      "select count(*) from public.owner_verification_document_versions where document_id::text like '46000000-%';",
    ),
    "3",
    "shipped database retains all three document versions",
  );
  const oldFunctionDefinition = harness.runSql(
    "select pg_get_functiondef('public.prepare_owner_verification_document_access(uuid)'::regprocedure);",
  );
  const priorGrant = prepare(submittedDocument);
  check(
    priorGrant.object_path,
    "owner/upgrade/submitted.pdf",
    "Submitted works before upgrade",
  );
  harness.runSql(`begin;
set local role service_role;
select public.complete_owner_verification_document_access('${priorGrant.grant_id}', 60);
commit;`);
  check(
    harness.runSql(`select object_path || '|' || actor_user_id::text
      from public.owner_verification_document_audit
      where access_grant_id = '${priorGrant.grant_id}';`),
    "owner/upgrade/submitted.pdf|26000000-0000-4000-8000-000000000201",
    "shipped history includes the original completed access audit",
  );
  check(
    denied(reviewDocument),
    "",
    "Under review is denied by the shipped predicate",
  );
  const retainedBefore = harness.runSql(
    retainedDigestSql.replace("%PRIOR_GRANT%", priorGrant.grant_id),
  );
  const upgradeSql = readFileSync(
    join(sourceMigrations, upgradeMigration),
    "utf8",
  );
  harness.runSql(upgradeSql);
  check(
    prepare(reviewDocument).object_path,
    "owner/upgrade/review.pdf",
    "Under review gets its exact current object after upgrade",
  );
  check(
    prepare(submittedDocument).object_path,
    "owner/upgrade/submitted.pdf",
    "Submitted remains permitted after upgrade",
  );
  check(denied(draftDocument), "", "Draft remains denied after upgrade");
  check(
    harness.runSql(
      retainedDigestSql.replace("%PRIOR_GRANT%", priorGrant.grant_id),
    ),
    retainedBefore,
    "upgrade preserves users, applications, documents, versions, audit and old grant",
  );
  harness.runSql(oldFunctionDefinition);
  check(
    prepare(submittedDocument).object_path,
    "owner/upgrade/submitted.pdf",
    "rollback restores Submitted access",
  );
  check(denied(reviewDocument), "", "rollback restores Under review denial");
  check(
    harness.runSql(
      retainedDigestSql.replace("%PRIOR_GRANT%", priorGrant.grant_id),
    ),
    retainedBefore,
    "rollback preserves retained documents and audit history",
  );
  harness.runSql(upgradeSql);
  check(
    prepare(reviewDocument).object_path,
    "owner/upgrade/review.pdf",
    "reapplication restores review-stage access",
  );
  check(
    harness.runSql(
      retainedDigestSql.replace("%PRIOR_GRANT%", priorGrant.grant_id),
    ),
    retainedBefore,
    "reapplication preserves retained documents and audit history",
  );
  console.log(
    `Owner document access upgrade verification passed (${assertions} assertions).`,
  );
} finally {
  if (started) {
    harness.guardDisposableLocalDatabase();
    run(
      "npx",
      supabaseArguments([
        "supabase",
        "stop",
        "--no-backup",
        "--project-id",
        project,
      ]),
    );
    if (!suppliedStateRoot) rmSync(stateRoot, { recursive: true, force: true });
  } else {
    console.error(`Retained upgrade verifier state at ${stateRoot}.`);
  }
}
