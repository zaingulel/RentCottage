import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { createClient } from "@supabase/supabase-js";

import {
  accessBrowserFixture,
  ACCESS_REVIEW_DOCUMENT_FILENAME,
} from "./lib/access-browser-fixtures.mjs";
import {
  findAccessFixtureUser,
  listAllAccessFixtureUsers,
} from "./lib/access-fixture-users.mjs";
import { capture, describeThrown } from "./lib/trap-safe-diagnostics.mjs";
import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";

const USAGE = "Usage: node scripts/verify-access-fixture-contract.mjs";
const url = process.env.SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const password = "Local-test-password-2026";
const fixedOtp = "123456";

function localTestEnvironment() {
  if (process.argv.length !== 2) {
    console.error(USAGE);
    return false;
  }
  try {
    const target = new URL(url ?? "invalid:");
    return (
      process.env.APP_ENVIRONMENT === "test" &&
      (target.protocol === "http:" || target.protocol === "https:") &&
      target.hostname === "127.0.0.1" &&
      Boolean(secretKey) &&
      Boolean(publishableKey)
    );
  } catch {
    return false;
  }
}

async function signInFixtureOwner(phone, expectedUserId, description) {
  const ownerClient = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await ownerClient.auth.signInWithPassword({
    phone,
    password,
  });
  if (error || data.user?.id !== expectedUserId) {
    throw new Error(`${description} could not sign in`, { cause: error });
  }
  return ownerClient;
}

async function signInFixtureOwnerWithOtp(phone, expectedUserId, description) {
  const ownerClient = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const requested = await ownerClient.auth.signInWithOtp({ phone });
  if (requested.error) {
    throw new Error(`${description} could not request a fixed local OTP`, {
      cause: requested.error,
    });
  }
  const verified = await ownerClient.auth.verifyOtp({
    phone,
    token: fixedOtp,
    type: "sms",
  });
  if (verified.error || verified.data.user?.id !== expectedUserId) {
    throw new Error(
      `${description} could not authenticate with its fixed OTP`,
      {
        cause: verified.error,
      },
    );
  }
}

function requireUuid(value, description) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value ?? "",
    )
  ) {
    throw new Error(`${description} is not a UUID`);
  }
  return value;
}

function runFixtureCommand(mode, { browserFixturesOnly = false } = {}) {
  return spawnSync(
    process.execPath,
    [
      resolve(process.cwd(), "scripts/prepare-access-test.mjs"),
      mode,
      "worker",
      ...(browserFixturesOnly ? ["--browser-fixtures-only"] : []),
    ],
    { encoding: "utf8", env: process.env },
  );
}

function commandOutput(result) {
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
}

function requireSuccess(result, step) {
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${step} failed: ${commandOutput(result)}`);
  }
}

function requireNamedFailure(result, diagnostic) {
  if (result.error) throw result.error;
  if (result.status === 0 || !commandOutput(result).includes(diagnostic)) {
    throw new Error(
      `Fixture validation did not fail with "${diagnostic}": ${commandOutput(result)}`,
    );
  }
}

export async function runPricingProofWithRestoration({
  originalPricing,
  prove,
  restore,
}) {
  const NO_FAILURE = Symbol("NO_FAILURE");
  const preservedOriginalPricing = structuredClone(originalPricing);
  let proofFailure = NO_FAILURE;
  let restorationFailure = NO_FAILURE;
  try {
    await prove();
  } catch (error) {
    proofFailure = error;
  }
  try {
    await restore(structuredClone(preservedOriginalPricing));
  } catch (error) {
    restorationFailure = error;
  }
  if (proofFailure !== NO_FAILURE && restorationFailure !== NO_FAILURE) {
    throw new AggregateError(
      [proofFailure, restorationFailure],
      `Worker pricing proof and restoration failed: ${describeThrown(proofFailure)}; ${describeThrown(restorationFailure)}`,
    );
  }
  if (proofFailure !== NO_FAILURE) throw proofFailure;
  if (restorationFailure !== NO_FAILURE) throw restorationFailure;
}

function pricingUnitKey(unit) {
  return `${unit.unitKind}:${unit.unitId}`;
}

async function loadEditablePricingState({
  ownerClient,
  profileId,
  scheduleId,
  expectedUnitKeys,
}) {
  const { data, error } = await ownerClient.rpc(
    "load_cottage_inventory_owner_editor_state",
    {
      target_profile_id: profileId,
      target_schedule_revision_id: scheduleId,
      target_service_day: null,
    },
  );
  if (error) throw error;
  if (!Array.isArray(data?.units) || data.units.length !== 3) {
    throw new Error("Worker booking fixture editable pricing is incomplete");
  }
  const snapshot = data.units.map((unit) => {
    if (
      !unit ||
      !expectedUnitKeys.has(`${unit.kind}:${unit.id}`) ||
      !Number.isSafeInteger(unit.standardPriceIqd) ||
      !Array.isArray(unit.weekdayOverrides) ||
      !Array.isArray(unit.dateOverrides)
    ) {
      throw new Error("Worker booking fixture editable pricing is incomplete");
    }
    return {
      unitId: requireUuid(unit.id, "Worker booking pricing unit id"),
      unitKind: unit.kind,
      standardPriceIqd: unit.standardPriceIqd,
      weekdayOverrides: structuredClone(unit.weekdayOverrides),
      dateOverrides: structuredClone(unit.dateOverrides),
    };
  });
  if (new Set(snapshot.map(pricingUnitKey)).size !== expectedUnitKeys.size) {
    throw new Error("Worker booking fixture editable pricing is incomplete");
  }
  return snapshot;
}

async function saveEditablePricingState({
  ownerClient,
  profileId,
  scheduleId,
  snapshot,
}) {
  const { error } = await ownerClient.rpc("save_cottage_inventory_pricing", {
    target_profile_id: profileId,
    target_schedule_revision_id: scheduleId,
    requested_prices: { units: structuredClone(snapshot) },
  });
  if (error) throw error;
}

function requireSamePricingState(actual, expected, description) {
  if (!isDeepStrictEqual(actual, expected)) {
    throw new Error(`${description} changed editable pricing state`);
  }
}

function requireZeroAvailability(databaseHarness, scheduleId, description) {
  const availabilityCount = databaseHarness.runSql(`
    select count(*)::integer
    from public.cottage_inventory_availability
    where schedule_revision_id = '${scheduleId}'::uuid;
  `);
  if (availabilityCount !== "0") {
    throw new Error(`${description} wrote Cottage Inventory availability`);
  }
}

async function main() {
  if (!localTestEnvironment()) {
    console.error(
      "Fixture contract verification requires APP_ENVIRONMENT=test and loopback Supabase credentials",
    );
    return 2;
  }

  const privilegedClient = createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const databaseHarness = createLocalSupabaseConcurrencyHarness();
  databaseHarness.guardDisposableLocalDatabase();
  const fixture = accessBrowserFixture("worker");

  requireSuccess(runFixtureCommand("create"), "Worker fixture creation");
  requireSuccess(
    runFixtureCommand("validate"),
    "Clean Worker fixture validation",
  );

  const users = await listAllAccessFixtureUsers(privilegedClient.auth.admin);
  const reviewOwner = findAccessFixtureUser(users, fixture.reviewOwnerPhone);
  if (!reviewOwner)
    throw new Error("Worker review fixture identity is missing");
  await signInFixtureOwnerWithOtp(
    fixture.reviewOwnerPhone,
    reviewOwner.id,
    "Worker review fixture identity",
  );
  const reviewOwnerClient = await signInFixtureOwner(
    fixture.reviewOwnerPhone,
    reviewOwner.id,
    "Worker review fixture identity",
  );
  const { data: reviewApplication, error: reviewApplicationError } =
    await reviewOwnerClient.from("owner_applications").select("id").single();
  if (reviewApplicationError) throw reviewApplicationError;
  const { data: licence, error: licenceError } = await reviewOwnerClient
    .from("owner_verification_documents")
    .select("object_path")
    .eq("application_id", reviewApplication.id)
    .eq("original_filename", "licence.pdf")
    .single();
  if (licenceError) throw licenceError;
  const downloadedLicence = await privilegedClient.storage
    .from("owner-verification")
    .download(licence.object_path);
  if (downloadedLicence.error || !downloadedLicence.data) {
    throw downloadedLicence.error ?? new Error("licence.pdf is unavailable");
  }
  const licenceBytes = Buffer.from(await downloadedLicence.data.arrayBuffer());
  const { error: removeLicenceError } = await privilegedClient.storage
    .from("owner-verification")
    .remove([licence.object_path]);
  if (removeLicenceError) throw removeLicenceError;
  requireNamedFailure(
    runFixtureCommand("validate"),
    "missing licence.pdf object",
  );
  const { error: restoreLicenceError } = await privilegedClient.storage
    .from("owner-verification")
    .upload(licence.object_path, licenceBytes, {
      contentType: "application/pdf",
      upsert: false,
    });
  if (restoreLicenceError) throw restoreLicenceError;
  requireSuccess(
    runFixtureCommand("validate"),
    "Restored licence fixture validation",
  );

  const bookingOwner = findAccessFixtureUser(users, fixture.bookingOwnerPhone);
  if (!bookingOwner)
    throw new Error("Worker booking fixture identity is missing");
  await signInFixtureOwnerWithOtp(
    fixture.bookingOwnerPhone,
    bookingOwner.id,
    "Worker booking fixture identity",
  );
  const bookingOwnerClient = await signInFixtureOwner(
    fixture.bookingOwnerPhone,
    bookingOwner.id,
    "Worker booking fixture identity",
  );
  const { data: bookingProfile, error: bookingProfileError } =
    await bookingOwnerClient
      .from("owner_application_cottage_profiles")
      .select("id,current_shift_schedule_id")
      .eq("name", fixture.bookingCottageName)
      .single();
  if (bookingProfileError) throw bookingProfileError;
  const scheduleId = bookingProfile.current_shift_schedule_id;
  if (!scheduleId)
    throw new Error("Worker booking fixture schedule is missing");
  const profileId = requireUuid(bookingProfile.id, "Worker booking profile id");
  const exactScheduleId = requireUuid(
    scheduleId,
    "Worker booking schedule revision id",
  );
  const { data: schedule, error: scheduleError } = await bookingOwnerClient
    .from("cottage_shift_schedule_revisions")
    .select("full_day_bundle_id")
    .eq("id", exactScheduleId)
    .single();
  if (scheduleError) throw scheduleError;
  const fullDayBundleId = requireUuid(
    schedule.full_day_bundle_id,
    "Worker booking full-day bundle id",
  );
  const { data: shifts, error: shiftsError } = await bookingOwnerClient
    .from("cottage_shifts")
    .select("id,position")
    .eq("schedule_revision_id", exactScheduleId)
    .order("position");
  if (shiftsError) throw shiftsError;
  const firstShift = shifts.find((shift) => shift.position === 1);
  const secondShift = shifts.find((shift) => shift.position === 2);
  if (!firstShift || !secondShift || shifts.length !== 2) {
    throw new Error("Worker booking fixture shifts are incomplete");
  }
  const firstShiftId = requireUuid(
    firstShift.id,
    "Worker booking fixture first shift id",
  );
  const secondShiftId = requireUuid(
    secondShift.id,
    "Worker booking fixture second shift id",
  );
  const expectedUnitKeys = new Set([
    `shift:${firstShiftId}`,
    `shift:${secondShiftId}`,
    `full_day_bundle:${fullDayBundleId}`,
  ]);
  const originalPricing = await loadEditablePricingState({
    ownerClient: bookingOwnerClient,
    profileId,
    scheduleId: exactScheduleId,
    expectedUnitKeys,
  });
  requireZeroAvailability(
    databaseHarness,
    exactScheduleId,
    "Worker booking fixture before pricing proof",
  );

  await runPricingProofWithRestoration({
    originalPricing,
    prove: async () => {
      const seededPricing = originalPricing.map((unit, index) => ({
        ...unit,
        weekdayOverrides: [
          {
            weekday: index + 1,
            priceIqd: unit.standardPriceIqd + (index + 1) * 1_000,
          },
        ],
        dateOverrides: [
          {
            serviceDay: `2099-01-${String(index + 11).padStart(2, "0")}`,
            priceIqd: unit.standardPriceIqd + (index + 1) * 2_000,
          },
        ],
      }));
      await saveEditablePricingState({
        ownerClient: bookingOwnerClient,
        profileId,
        scheduleId: exactScheduleId,
        snapshot: seededPricing,
      });
      const seededSnapshot = await loadEditablePricingState({
        ownerClient: bookingOwnerClient,
        profileId,
        scheduleId: exactScheduleId,
        expectedUnitKeys,
      });
      requireSamePricingState(
        seededSnapshot,
        seededPricing,
        "Worker booking fixture override seed",
      );

      const deletedPrice = databaseHarness.runSql(`
      delete from public.cottage_inventory_standard_prices
      where schedule_revision_id = '${exactScheduleId}'::uuid
        and unit_kind = 'shift'
        and unit_id = '${firstShiftId}'::uuid
      returning unit_id;
    `);
      if (deletedPrice !== firstShiftId) {
        throw new Error(
          "Worker booking fixture standard price mutation failed",
        );
      }
      requireNamedFailure(
        runFixtureCommand("validate"),
        "expected deterministic standard pricing",
      );
      requireSuccess(
        runFixtureCommand("create", { browserFixturesOnly: true }),
        "Worker browser-only fixture pricing repair",
      );
      requireSuccess(
        runFixtureCommand("validate"),
        "Repaired Worker fixture pricing validation",
      );
      const repairedPricing = await loadEditablePricingState({
        ownerClient: bookingOwnerClient,
        profileId,
        scheduleId: exactScheduleId,
        expectedUnitKeys,
      });
      requireSamePricingState(
        repairedPricing,
        seededPricing,
        "Worker browser-only fixture pricing repair",
      );
      requireZeroAvailability(
        databaseHarness,
        exactScheduleId,
        "Worker browser-only fixture pricing repair",
      );

      requireSuccess(
        runFixtureCommand("create", { browserFixturesOnly: true }),
        "Idempotent Worker browser-only fixture creation",
      );
      requireSuccess(
        runFixtureCommand("validate"),
        "Idempotent Worker fixture pricing validation",
      );
      const repeatedPricing = await loadEditablePricingState({
        ownerClient: bookingOwnerClient,
        profileId,
        scheduleId: exactScheduleId,
        expectedUnitKeys,
      });
      requireSamePricingState(
        repeatedPricing,
        repairedPricing,
        "Idempotent Worker browser-only fixture creation",
      );
      requireZeroAvailability(
        databaseHarness,
        exactScheduleId,
        "Idempotent Worker browser-only fixture creation",
      );
    },
    restore: async (restorationPricing) => {
      await saveEditablePricingState({
        ownerClient: bookingOwnerClient,
        profileId,
        scheduleId: exactScheduleId,
        snapshot: restorationPricing,
      });
      const restoredPricing = await loadEditablePricingState({
        ownerClient: bookingOwnerClient,
        profileId,
        scheduleId: exactScheduleId,
        expectedUnitKeys,
      });
      requireSamePricingState(
        restoredPricing,
        restorationPricing,
        "Worker booking fixture pricing restoration",
      );
      requireZeroAvailability(
        databaseHarness,
        exactScheduleId,
        "Worker booking fixture pricing restoration",
      );
    },
  });

  databaseHarness.runSql(`
    begin;
    set local session_replication_role = replica;
    update public.owner_application_cottage_profiles
    set current_shift_schedule_id = null
    where id = '${profileId}'::uuid;
    commit;
  `);
  requireNamedFailure(
    runFixtureCommand("validate"),
    "missing current publication or Shift Schedule",
  );
  databaseHarness.runSql(`
    begin;
    set local session_replication_role = replica;
    update public.owner_application_cottage_profiles
    set current_shift_schedule_id = '${exactScheduleId}'::uuid
    where id = '${profileId}'::uuid;
    commit;
  `);
  requireSuccess(
    runFixtureCommand("validate"),
    "Restored booking fixture validation",
  );

  const { data: reviewDocument, error: reviewDocumentError } =
    await reviewOwnerClient
      .from("owner_verification_documents")
      .select("id")
      .eq("application_id", reviewApplication.id)
      .eq("original_filename", ACCESS_REVIEW_DOCUMENT_FILENAME)
      .single();
  if (reviewDocumentError || !reviewDocument) {
    throw (
      reviewDocumentError ?? new Error("Review document fixture is missing")
    );
  }
  const concurrencyReviewer = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: concurrencyReviewerError } =
    await concurrencyReviewer.auth.signInWithPassword({
      email: "cottage-profile-fixture-reviewer@rentcottage.test",
      password,
    });
  if (concurrencyReviewerError) {
    throw new Error(
      "Cottage Profile concurrency reviewer was not preserved by fixture creation",
      { cause: concurrencyReviewerError },
    );
  }
  console.log(
    "Verified clean Worker access fixture creation and named prerequisite failures.",
  );
  return 0;
}

export async function runFixtureContractCommand({
  command = main,
  stderr = console.error,
} = {}) {
  try {
    return await command();
  } catch (error) {
    const diagnostic = describeThrown(error);
    capture(() => stderr(diagnostic));
    return 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = await runFixtureContractCommand();
}
