import { createClient } from "@supabase/supabase-js";

import { createLocalSupabaseConcurrencyHarness } from "../local-supabase-concurrency-harness.mjs";
import {
  findAccessFixtureUser,
  listAllAccessFixtureUsers,
} from "./access-fixture-users.mjs";

const projects = ["mobile", "desktop", "worker"];
const phases = ["ordinary", "forward", "reverse", "retry-proof", "boundary"];
const password = "Local-test-password-2026";
export const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const LOCAL_PROJECT_PATTERN = /^rentcottage(?:-[a-z0-9]+)*$/;

export const accessJourneyCases = Object.freeze([
  Object.freeze({
    id: 1,
    journey: "signin",
    file: "tests/access.spec.ts",
    title:
      "shared sign-in from the homepage returns a prospective owner to their private application",
    projects,
    recipe: "draft",
  }),
  Object.freeze({
    id: 2,
    journey: "owner-submit",
    file: "tests/access.spec.ts",
    title:
      "a Cottage Owner saves, resumes and submits a complete private application",
    projects,
    recipe: "new-account",
  }),
  Object.freeze({
    id: 3,
    journey: "owner-layout",
    file: "tests/access.spec.ts",
    title:
      "Owner Application keeps evidence controls aligned and accessible in every locale",
    projects,
    recipe: "new-account",
  }),
  Object.freeze({
    id: 9,
    journey: "shared-account",
    file: "tests/access.spec.ts",
    title:
      "one account returns to customer bookings, enrolls explicitly and signs out only this device",
    projects,
    recipe: "new-account",
  }),
]);

const identityKeys = [
  "journey",
  "project",
  "retry",
  "repeatEachIndex",
  "phase",
];

function boundedInteger(value, name, maximum) {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new RangeError(`${name} must be an integer from 0 to ${maximum}`);
  }
}

function fixtureCaseFor(journey) {
  const fixtureCase = accessJourneyCases.find(
    (candidate) => candidate.journey === journey,
  );
  if (!fixtureCase) throw new RangeError(`Unknown access journey: ${journey}`);
  return fixtureCase;
}

export function accessJourneyIdentity(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Access journey identity must be an object");
  }
  for (const key of Object.keys(input)) {
    if (!identityKeys.includes(key)) {
      throw new TypeError(`Unknown access journey identity key: ${key}`);
    }
  }
  for (const key of identityKeys) {
    if (!Object.hasOwn(input, key)) {
      throw new TypeError(`Missing access journey identity key: ${key}`);
    }
  }

  const { journey, project, retry, repeatEachIndex, phase } = input;
  const fixtureCase = fixtureCaseFor(journey);
  const projectIndex = projects.indexOf(project);
  if (projectIndex === -1) {
    throw new RangeError(`Unknown access journey project: ${project}`);
  }
  boundedInteger(retry, "retry", 2);
  boundedInteger(repeatEachIndex, "repeatEachIndex", 1);
  const phaseIndex = phases.indexOf(phase);
  if (phaseIndex === -1) {
    throw new RangeError(`Unknown access journey phase: ${phase}`);
  }

  const slot =
    ((((fixtureCase.id - 1) * projects.length + projectIndex) * 3 + retry) * 2 +
      repeatEachIndex) *
      phases.length +
    phaseIndex;
  const phone = `+9647${700000000 + slot * 256}`;
  return {
    allocation: { journey, project, retry, repeatEachIndex, phase },
    fixtureCase,
    phone,
    slot,
    draft: {
      applicantKind: "individual",
      legalName: "Access Journey Draft Owner",
      licensingBasis: "licence",
      cottageName: "Access Journey Draft Cottage",
      governorate: "Erbil",
      approximateLocation: "Synthetic test area",
      exactAddress: "Synthetic private access journey address",
      capacity: 4,
      bedrooms: 2,
      bathrooms: 1,
      amenities: ["garden"],
      description: "Synthetic private fixture for access verification.",
      houseRules: "Test fixture only.",
    },
  };
}

export function accessJourneyOtpEntries() {
  const entries = [];
  for (const fixtureCase of accessJourneyCases) {
    for (const project of projects) {
      for (let retry = 0; retry <= 2; retry += 1) {
        for (
          let repeatEachIndex = 0;
          repeatEachIndex <= 1;
          repeatEachIndex += 1
        ) {
          for (const phase of phases) {
            const identity = accessJourneyIdentity({
              journey: fixtureCase.journey,
              project,
              retry,
              repeatEachIndex,
              phase,
            });
            entries.push([identity.phone.replace(/^\+/, ""), "123456"]);
          }
        }
      }
    }
  }
  return entries;
}

export function addAccessJourneyTestOtps(config) {
  const section = /^\[auth\.sms\.test_otp\]$/gm;
  const matches = [...config.matchAll(section)];
  if (matches.length !== 1) {
    throw new Error(
      "Local Supabase config must contain exactly one auth.sms.test_otp section.",
    );
  }
  const entries = accessJourneyOtpEntries();
  const sectionStart = matches[0].index + matches[0][0].length;
  const remainder = config.slice(sectionStart);
  const nextSection = remainder.search(/^\[/m);
  const sectionEnd =
    nextSection === -1 ? config.length : sectionStart + nextSection;
  const existing = config.slice(sectionStart, sectionEnd);
  for (const [phone] of entries) {
    if (new RegExp(`^${phone}\\s*=`, "m").test(existing)) {
      throw new Error(
        `Generated access journey OTP phone conflicts: ${phone}.`,
      );
    }
  }
  const lines = entries
    .map(([phone, code]) => `${phone} = "${code}"`)
    .join("\n");
  return `${config.slice(0, sectionStart)}\n${lines}${config.slice(sectionStart)}`;
}

export function validateEnvironment(environment, url) {
  if (environment.APP_ENVIRONMENT !== "test") {
    throw new Error("Access journey fixtures require APP_ENVIRONMENT=test.");
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Access journey fixtures require loopback Supabase.");
  }
  if (
    parsed.hostname !== "127.0.0.1" ||
    parsed.protocol !== "http:" ||
    environment.SUPABASE_URL !== url ||
    !LOCAL_PROJECT_PATTERN.test(environment.SUPABASE_LOCAL_PROJECT ?? "") ||
    typeof environment.SUPABASE_LOCAL_WORKDIR !== "string" ||
    environment.SUPABASE_LOCAL_WORKDIR.length === 0
  ) {
    throw new Error("Access journey fixture environment is not disposable.");
  }
}

function requireProvider(result, description) {
  if (
    !result ||
    typeof result !== "object" ||
    !Object.hasOwn(result, "data") ||
    !Object.hasOwn(result, "error")
  ) {
    throw new Error(`${description} returned malformed provider data.`);
  }
  if (result.error)
    throw new Error(`${description} failed.`, { cause: result.error });
  return result.data;
}

function requireUuid(value, description) {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new Error(`${description} did not return a valid identifier.`);
  }
  return value;
}

export async function prepareAccessJourney({
  allocation,
  createSupabaseClient = createClient,
  environment = process.env,
  guardDatabase = () =>
    createLocalSupabaseConcurrencyHarness({
      environment,
    }).guardDisposableLocalDatabase(),
  privilegedClient,
  publishableKey,
  selectedTitle,
  url,
}) {
  const identity = accessJourneyIdentity(allocation);
  try {
    if (selectedTitle !== identity.fixtureCase.title) {
      throw new Error(
        `Selected access journey title does not match ${identity.fixtureCase.journey}.`,
      );
    }
    validateEnvironment(environment, url);
    guardDatabase();

    const users = await listAllAccessFixtureUsers(privilegedClient.auth.admin);
    if (findAccessFixtureUser(users, identity.phone)) {
      throw new Error("Allocated access journey identity already exists.");
    }

    if (identity.fixtureCase.recipe === "new-account") {
      return identity;
    }

    const created = requireProvider(
      await privilegedClient.auth.admin.createUser({
        phone: identity.phone,
        password,
        phone_confirm: true,
      }),
      "Access journey Auth creation",
    );
    const userId = requireUuid(
      created?.user?.id,
      "Access journey Auth creation",
    );
    if (
      created.user.phone?.replace(/^\+/, "") !==
      identity.phone.replace(/^\+/, "")
    ) {
      throw new Error("Access journey Auth creation returned another phone.");
    }

    const ownerClient = createSupabaseClient(url, publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const signedIn = requireProvider(
      await ownerClient.auth.signInWithPassword({
        phone: identity.phone,
        password,
      }),
      "Access journey sign-in",
    );
    if (signedIn?.user?.id !== userId) {
      throw new Error("Access journey sign-in returned another identity.");
    }

    const context = requireProvider(
      await ownerClient.rpc("claim_marketplace_role", {
        requested_role: "cottage_owner",
      }),
      "Access journey owner enrollment",
    );
    if (
      context?.user_id !== userId ||
      context.role !== "cottage_owner" ||
      context.owner_approval_state !== "prospective"
    ) {
      throw new Error(
        "Access journey owner enrollment returned incorrect facts.",
      );
    }

    requireProvider(
      await ownerClient.rpc("save_owner_application", {
        requested_applicant_kind: identity.draft.applicantKind,
        requested_legal_name: identity.draft.legalName,
        requested_company_name: null,
        requested_licensing_basis: identity.draft.licensingBasis,
        requested_exemption_basis: null,
        requested_cottage_name: identity.draft.cottageName,
        requested_governorate: identity.draft.governorate,
        requested_approximate_location: identity.draft.approximateLocation,
        requested_exact_address: identity.draft.exactAddress,
        requested_capacity: identity.draft.capacity,
        requested_bedrooms: identity.draft.bedrooms,
        requested_bathrooms: identity.draft.bathrooms,
        requested_amenities: identity.draft.amenities,
        requested_description: identity.draft.description,
        requested_house_rules: identity.draft.houseRules,
      }),
      "Access journey private draft",
    );
    const application = requireProvider(
      await ownerClient
        .from("owner_applications")
        .select("id,owner_user_id,status,current_verification_record_id")
        .eq("owner_user_id", userId)
        .single(),
      "Access journey application acknowledgement",
    );
    const profile = requireProvider(
      await ownerClient
        .from("owner_application_cottage_profiles")
        .select(
          "id,application_id,owner_user_id,status,current_publication_id,submitted_source_revision_id,current_shift_schedule_id",
        )
        .eq("owner_user_id", userId)
        .single(),
      "Access journey profile acknowledgement",
    );
    const applicationId = requireUuid(
      application?.id,
      "Access journey application acknowledgement",
    );
    const profileId = requireUuid(
      profile?.id,
      "Access journey profile acknowledgement",
    );
    if (
      application.owner_user_id !== userId ||
      application.status !== "draft" ||
      application.current_verification_record_id !== null ||
      profile.owner_user_id !== userId ||
      profile.application_id !== applicationId ||
      profile.status !== "draft" ||
      profile.current_publication_id !== null ||
      profile.submitted_source_revision_id !== null ||
      profile.current_shift_schedule_id !== null
    ) {
      throw new Error(
        "Access journey private draft acknowledgement was incorrect.",
      );
    }
    return {
      ...identity,
      applicationId,
      ownerClient,
      profileId,
      userId,
    };
  } catch (cause) {
    const { journey, project, phase, retry } = identity.allocation;
    const reason =
      cause instanceof Error ? cause.message : "Provider result unavailable.";
    throw new Error(
      `${journey}/${project}/${phase}/retry ${retry} preparation failed: ${reason} Discard the failed disposable run.`,
      { cause },
    );
  }
}
