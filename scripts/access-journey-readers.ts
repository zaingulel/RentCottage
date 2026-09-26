import { createRequire } from "node:module";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { SupabaseAccountContextStore } from "../src/access/supabase-account-access";
import { SupabaseOwnerApplicationRepository } from "../src/owner-application/supabase-owner-application";

const require = createRequire(import.meta.url);
const { createLocalSupabaseConcurrencyHarness } =
  require("./local-supabase-concurrency-harness.mjs") as {
    createLocalSupabaseConcurrencyHarness(options: {
      environment: NodeJS.ProcessEnv;
    }): {
      guardDisposableLocalDatabase(): void;
      runSql(sql: string): string;
    };
  };

export type AccessJourneyInitialState = {
  readonly allocation: {
    readonly journey: string;
    readonly project: "mobile" | "desktop" | "worker";
    readonly retry: number;
    readonly repeatEachIndex: number;
    readonly phase:
      | "ordinary"
      | "forward"
      | "reverse"
      | "retry-proof"
      | "boundary";
  };
  readonly applicationId?: string;
  readonly draft: {
    readonly exactAddress: string;
    readonly legalName: string;
  };
  readonly fixtureCase: { readonly recipe: "draft" | "new-account" };
  readonly phone: string;
  readonly profileId?: string;
  readonly userId?: string;
  readonly ownerClient?: SupabaseClient;
};

const { findAccessFixtureUser, listAllAccessFixtureUsers } =
  require("./lib/access-fixture-users.mjs") as {
    listAllAccessFixtureUsers(
      admin: SupabaseClient["auth"]["admin"],
    ): Promise<Array<{ phone?: string }>>;
    findAccessFixtureUser(
      users: Array<{ phone?: string }>,
      phone: string,
    ): { phone?: string } | undefined;
  };

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const zeroCountKeySet =
  "cleanup,documentVersions,documents,informationRequests,marketplaceListings,notices,renewalWork,transitions,verificationRecords";

export async function validateAccessJourneyInitialState({
  environment = process.env,
  expectedLegalName,
  fixture,
  privilegedClient,
  publishableKey,
  url,
}: {
  environment?: NodeJS.ProcessEnv;
  expectedLegalName?: string;
  fixture: AccessJourneyInitialState;
  privilegedClient: SupabaseClient;
  publishableKey: string;
  url: string;
}) {
  const { journey, project, phase, retry } = fixture.allocation;
  const label = `${journey}/${project}/${phase}/retry ${retry}/${fixture.fixtureCase.recipe}`;
  try {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new Error(`${label} has an invalid readiness environment.`);
    }
    if (
      environment.APP_ENVIRONMENT !== "test" ||
      environment.SUPABASE_URL !== url ||
      parsedUrl.protocol !== "http:" ||
      parsedUrl.hostname !== "127.0.0.1" ||
      !/^rentcottage(?:-[a-z0-9]+)*$/.test(
        environment.SUPABASE_LOCAL_PROJECT ?? "",
      ) ||
      !environment.SUPABASE_LOCAL_WORKDIR
    ) {
      throw new Error(`${label} readiness environment is not disposable.`);
    }
    const harness = createLocalSupabaseConcurrencyHarness({ environment });
    harness.guardDisposableLocalDatabase();
    if (fixture.fixtureCase.recipe === "new-account") {
      const anonymous = createClient(url, publishableKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      if (await new SupabaseAccountContextStore(anonymous).resolve()) {
        throw new Error(`${label} unexpectedly has an account context.`);
      }
      let missingSession: unknown;
      try {
        await new SupabaseOwnerApplicationRepository(
          anonymous,
          privilegedClient,
        ).load();
      } catch (error) {
        missingSession = error;
      }
      const providerCause =
        missingSession instanceof Error ? missingSession.cause : undefined;
      if (
        !(missingSession instanceof Error) ||
        missingSession.message !==
          "Owner Application provider is unavailable" ||
        !providerCause ||
        typeof providerCause !== "object" ||
        !("name" in providerCause) ||
        (providerCause.name !== "AuthSessionMissingError" &&
          (!("code" in providerCause) ||
            providerCause.code !== "session_not_found"))
      ) {
        throw new Error(
          `${label} did not preserve the missing-session result.`,
        );
      }
      const users = await listAllAccessFixtureUsers(
        privilegedClient.auth.admin,
      );
      if (findAccessFixtureUser(users, fixture.phone)) {
        throw new Error(`${label} reserved phone is not absent.`);
      }
      return;
    }

    const applicationId = fixture.applicationId;
    const profileId = fixture.profileId;
    const userId = fixture.userId;
    if (
      !uuidPattern.test(userId ?? "") ||
      !uuidPattern.test(applicationId ?? "") ||
      !uuidPattern.test(profileId ?? "")
    ) {
      throw new Error(`${label} has incomplete issued identifiers.`);
    }
    const owner = fixture.ownerClient;
    if (!owner) {
      throw new Error(`${label} has no acknowledged authenticated client.`);
    }
    const context = await new SupabaseAccountContextStore(owner).resolve();
    const application = await new SupabaseOwnerApplicationRepository(
      owner,
      privilegedClient,
    ).load();
    if (!context || !application) {
      throw new Error(
        `${label} production readers found incorrect initial state.`,
      );
    }
    if (
      context.userId !== fixture.userId ||
      context.role !== "cottage_owner" ||
      context.approvalState !== "prospective" ||
      application?.applicationId !== fixture.applicationId ||
      application.ownerUserId !== fixture.userId ||
      application.status !== "draft" ||
      application.legalName !==
        (expectedLegalName ?? fixture.draft.legalName) ||
      application.cottage.exactAddress !== fixture.draft.exactAddress ||
      application.documents.length !== 0
    ) {
      throw new Error(
        `${label} production readers found incorrect initial state.`,
      );
    }
    let snapshot: unknown;
    try {
      snapshot = JSON.parse(
        harness.runSql(`begin transaction isolation level repeatable read read only;
select jsonb_build_object(
  'applications', (select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'ownerUserId', owner_user_id, 'status', status,
    'verificationRecordId', current_verification_record_id,
    'reviewStartedAt', review_started_at, 'reviewDueAt', review_due_at,
    'reviewPausedAt', review_paused_at, 'decidedAt', decided_at
  ) order by id), '[]'::jsonb) from public.owner_applications where owner_user_id='${userId}'::uuid),
  'profiles', (select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'applicationId', application_id, 'ownerUserId', owner_user_id,
    'status', status, 'publicationId', current_publication_id,
    'sourceRevisionId', submitted_source_revision_id,
    'shiftScheduleId', current_shift_schedule_id
  ) order by id), '[]'::jsonb) from public.owner_application_cottage_profiles
    where owner_user_id='${userId}'::uuid or application_id='${applicationId}'::uuid),
  'counts', jsonb_build_object(
    'documents', (select count(*)::integer from public.owner_verification_documents where application_id='${applicationId}'::uuid),
    'documentVersions', (select count(*)::integer from public.owner_verification_document_versions where application_id='${applicationId}'::uuid),
    'transitions', (select count(*)::integer from public.owner_application_transitions where application_id='${applicationId}'::uuid),
    'verificationRecords', (select count(*)::integer from public.owner_application_verification_records where application_id='${applicationId}'::uuid),
    'informationRequests', (select count(*)::integer from public.owner_application_information_requests where application_id='${applicationId}'::uuid),
    'notices', (select count(*)::integer from public.owner_application_notices where application_id='${applicationId}'::uuid),
    'renewalWork', (select count(*)::integer from public.owner_application_renewal_work where application_id='${applicationId}'::uuid),
    'cleanup', (select count(*)::integer from public.owner_verification_document_cleanup where application_id='${applicationId}'::uuid),
    'marketplaceListings', (select count(*)::integer from public.cottage_marketplace_listings where profile_id='${profileId}'::uuid)
  )
);
commit;`),
      );
    } catch (cause) {
      throw new Error(`${label} guarded readiness snapshot is unavailable.`, {
        cause,
      });
    }
    if (
      !snapshot ||
      typeof snapshot !== "object" ||
      !Array.isArray((snapshot as { applications?: unknown }).applications) ||
      !Array.isArray((snapshot as { profiles?: unknown }).profiles) ||
      !(snapshot as { counts?: unknown }).counts ||
      typeof (snapshot as { counts?: unknown }).counts !== "object"
    ) {
      throw new Error(`${label} guarded readiness snapshot is invalid.`);
    }
    const observed = snapshot as {
      applications: Array<Record<string, unknown>>;
      profiles: Array<Record<string, unknown>>;
      counts: Record<string, unknown>;
    };
    if (observed.applications.length !== 1 || observed.profiles.length !== 1) {
      throw new Error(`${label} private draft root cardinality is incorrect.`);
    }
    const applicationRow = observed.applications[0];
    const profileRow = observed.profiles[0];
    const invalidBindings = [
      applicationRow.id !== applicationId && "application id",
      applicationRow.ownerUserId !== userId && "application owner",
      applicationRow.status !== "draft" && "application status",
      applicationRow.verificationRecordId !== null &&
        "application verification pointer",
      applicationRow.reviewStartedAt !== null && "application review start",
      applicationRow.reviewDueAt !== null && "application review deadline",
      applicationRow.reviewPausedAt !== null && "application review pause",
      applicationRow.decidedAt !== null && "application decision",
      profileRow.id !== profileId && "profile id",
      profileRow.applicationId !== applicationId && "profile application",
      profileRow.ownerUserId !== userId && "profile owner",
      profileRow.status !== "draft" && "profile status",
      profileRow.publicationId !== null && "profile publication pointer",
      profileRow.sourceRevisionId !== null && "profile source pointer",
      profileRow.shiftScheduleId !== null && "profile schedule pointer",
    ].filter(Boolean);
    if (invalidBindings.length > 0) {
      throw new Error(
        `${label} private draft binding is incorrect: ${invalidBindings.join(", ")}.`,
      );
    }
    if (
      Object.keys(observed.counts).sort().join(",") !== zeroCountKeySet ||
      Object.values(observed.counts).some((count) => count !== 0)
    ) {
      throw new Error(`${label} has forbidden initial descendants.`);
    }
  } catch (cause) {
    const reason =
      cause instanceof Error ? cause.message : "Provider result unavailable.";
    throw new Error(
      `${label} readiness failed: ${reason} Discard the failed disposable run.`,
      { cause },
    );
  }
}
