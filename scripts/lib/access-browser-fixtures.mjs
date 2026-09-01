import { createHash } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import {
  findAccessFixtureUser,
  listAllAccessFixtureUsers,
} from "./access-fixture-users.mjs";

export const ACCESS_BROWSER_PROJECTS = ["mobile", "desktop", "worker"];

export const ACCESS_REVIEW_DOCUMENT_FILENAME =
  "syntheticlongprivateidentityevidencefilenamethatmustwrapwithouttruncation.pdf";

const projectIndex = new Map(
  ACCESS_BROWSER_PROJECTS.map((project, index) => [project, index]),
);

export function accessBrowserFixture(project) {
  const index = projectIndex.get(project);
  if (index === undefined) {
    throw new Error(`Unknown access browser fixture project: ${project}`);
  }
  const label = `${project[0].toUpperCase()}${project.slice(1)}`;
  return {
    project,
    exactAddress: "Synthetic private fixture address",
    reviewOwnerPhone: `+964753000000${index}`,
    reviewLegalName: `${label} Access Review Fixture`,
    reviewCottageName: `${label} Review Fixture Cottage`,
    bookingOwnerPhone: `+964754000000${index}`,
    bookingLegalName: `${label} Access Booking Fixture`,
    bookingCottageName: `${label} Booking Fixture Cottage`,
  };
}

const password = "Local-test-password-2026";
const pdfBytes = new TextEncoder().encode(
  "%PDF-1.7\nsynthetic access fixture\n%%EOF",
);
const pdfDigest = createHash("sha256").update(pdfBytes).digest("hex");
const pngBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const documents = [
  ["identity", ACCESS_REVIEW_DOCUMENT_FILENAME],
  ["authority_to_rent", "authority.pdf"],
  ["licensing_or_exemption", "licence.pdf"],
  ["payout_account", "payout.pdf"],
];
const standardShiftPrices = new Map([
  [1, 180000],
  [2, 190000],
]);
const standardFullDayPrice = 250000;

function requireData(result, message) {
  if (result.error) throw result.error;
  if (!result.data) throw new Error(message);
  return result.data;
}

function deterministicStandardPricing(schedule, shifts) {
  if (!schedule.full_day_bundle_id || shifts.length !== 2) return null;
  const units = shifts.map((shift) => {
    const standardPriceIqd = standardShiftPrices.get(shift.position);
    return standardPriceIqd
      ? {
          unitId: shift.id,
          unitKind: "shift",
          standardPriceIqd,
        }
      : null;
  });
  if (units.some((unit) => !unit)) return null;
  return [
    ...units,
    {
      unitId: schedule.full_day_bundle_id,
      unitKind: "full_day_bundle",
      standardPriceIqd: standardFullDayPrice,
    },
  ];
}

function hasExactStandardPricing(loadedPricing, expectedPricing) {
  if (
    !Array.isArray(loadedPricing?.units) ||
    loadedPricing.units.length !== expectedPricing.length
  ) {
    return false;
  }
  return expectedPricing.every((expected) =>
    loadedPricing.units.some(
      (actual) =>
        actual?.id === expected.unitId &&
        actual.kind === expected.unitKind &&
        actual.standardPriceIqd === expected.standardPriceIqd,
    ),
  );
}

async function loadBookingFixturePricing({ fixture, ownerClient, profile }) {
  const schedule = requireData(
    await ownerClient
      .from("cottage_shift_schedule_revisions")
      .select("id,full_day_bundle_id")
      .eq("id", profile.current_shift_schedule_id)
      .maybeSingle(),
    `${fixture.project} access booking fixture is incomplete: missing current Shift Schedule`,
  );
  const shifts = await ownerClient
    .from("cottage_shifts")
    .select("id,position")
    .eq("schedule_revision_id", schedule.id)
    .order("position");
  if (shifts.error) throw shifts.error;
  const expectedPricing = deterministicStandardPricing(schedule, shifts.data);
  if (!expectedPricing) {
    throw new Error(
      `${fixture.project} access booking fixture is incomplete: expected two Cottage Shifts and a full-day bundle`,
    );
  }
  const loadedPricing = requireData(
    await ownerClient.rpc("load_cottage_inventory_owner_editor_state", {
      target_profile_id: profile.id,
      target_schedule_revision_id: schedule.id,
      target_service_day: null,
    }),
    `${fixture.project} access booking fixture pricing is unavailable`,
  );
  return { expectedPricing, loadedPricing, scheduleId: schedule.id };
}

async function ensureBookingFixtureStandardPricing({
  fixture,
  ownerClient,
  profile,
}) {
  const { expectedPricing, loadedPricing, scheduleId } =
    await loadBookingFixturePricing({
      fixture,
      ownerClient,
      profile,
    });
  if (hasExactStandardPricing(loadedPricing, expectedPricing)) return;
  const replacementPricing = expectedPricing.map((expected) => {
    const loaded = loadedPricing.units?.find(
      (unit) => unit?.id === expected.unitId && unit.kind === expected.unitKind,
    );
    if (
      !loaded ||
      !Array.isArray(loaded.weekdayOverrides) ||
      !Array.isArray(loaded.dateOverrides)
    ) {
      throw new Error(
        `${fixture.project} access booking fixture pricing is incomplete: missing complete override state`,
      );
    }
    return {
      ...expected,
      weekdayOverrides: loaded.weekdayOverrides.map((override) => ({
        ...override,
      })),
      dateOverrides: loaded.dateOverrides.map((override) => ({ ...override })),
    };
  });
  const { error } = await ownerClient.rpc("save_cottage_inventory_pricing", {
    target_profile_id: profile.id,
    target_schedule_revision_id: scheduleId,
    requested_prices: { units: replacementPricing },
  });
  if (error) throw error;
}

async function signInFixtureOwner({
  url,
  publishableKey,
  identity,
  phone,
  description,
}) {
  const ownerClient = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const signedIn = await ownerClient.auth.signInWithPassword({
    phone,
    password,
  });
  const signedInUser = requireData(
    signedIn,
    `${description}: identity could not sign in`,
  ).user;
  if (signedInUser?.id !== identity.id) {
    throw new Error(`${description}: identity signed in as another user`);
  }
  return ownerClient;
}

async function ensureOwnerIdentity({
  url,
  publishableKey,
  privilegedClient,
  phone,
}) {
  const users = await listAllAccessFixtureUsers(privilegedClient.auth.admin);
  let identity = findAccessFixtureUser(users, phone);
  if (!identity) {
    const result = await privilegedClient.auth.admin.createUser({
      phone,
      password,
      phone_confirm: true,
    });
    identity = requireData(
      result,
      `Fixture identity ${phone} was not created`,
    ).user;
  } else {
    const { error } = await privilegedClient.auth.admin.updateUserById(
      identity.id,
      { password },
    );
    if (error) throw error;
  }

  const ownerClient = await signInFixtureOwner({
    url,
    publishableKey,
    identity,
    phone,
    description: `Fixture identity ${phone}`,
  });
  return { identity, ownerClient };
}

async function ensureOwnerRole(ownerClient) {
  const context = await ownerClient
    .from("account_contexts")
    .select("role")
    .maybeSingle();
  if (context.error) throw context.error;
  if (!context.data) {
    const { error } = await ownerClient.rpc("claim_marketplace_role", {
      requested_role: "cottage_owner",
    });
    if (error) throw error;
    return;
  }
  if (context.data.role !== "cottage_owner") {
    throw new Error("Access browser fixture identity belongs to another role");
  }
}

async function saveApplication(ownerClient, fixture, kind) {
  const isReview = kind === "review";
  const { error } = await ownerClient.rpc("save_owner_application", {
    requested_applicant_kind: "individual",
    requested_legal_name: isReview
      ? fixture.reviewLegalName
      : fixture.bookingLegalName,
    requested_company_name: null,
    requested_licensing_basis: "licence",
    requested_exemption_basis: null,
    requested_cottage_name: isReview
      ? fixture.reviewCottageName
      : fixture.bookingCottageName,
    requested_governorate: "Erbil",
    requested_approximate_location: "Synthetic access fixture area",
    requested_exact_address: fixture.exactAddress,
    requested_capacity: 8,
    requested_bedrooms: 3,
    requested_bathrooms: 2,
    requested_amenities: ["garden", "parking"],
    requested_description: "Synthetic Cottage Profile for access verification.",
    requested_house_rules: "Synthetic fixture only. Respect neighbours.",
  });
  if (error) throw error;
  return requireData(
    await ownerClient.from("owner_applications").select("id").single(),
    `${fixture.project} ${kind} Owner Application was not created`,
  );
}

async function uploadApplicationDocuments({
  applicationId,
  ownerUserId,
  privilegedClient,
}) {
  for (const [kind, originalFilename] of documents) {
    const objectPath = `${ownerUserId}/${applicationId}/${kind}/${crypto.randomUUID()}.pdf`;
    const prepared = await privilegedClient.rpc(
      "prepare_owner_verification_document_upload_v2",
      {
        requested_owner_user_id: ownerUserId,
        requested_application_id: applicationId,
        requested_kind: kind,
        requested_object_path: objectPath,
        requested_original_filename: originalFilename,
        requested_media_type: "application/pdf",
        requested_size_bytes: pdfBytes.byteLength,
        requested_content_digest: pdfDigest,
      },
    );
    const cleanupId = requireData(
      prepared,
      `${kind} fixture upload was not prepared`,
    );
    const { error: uploadError } = await privilegedClient.storage
      .from("owner-verification")
      .upload(objectPath, pdfBytes, {
        contentType: "application/pdf",
        upsert: false,
      });
    if (uploadError) throw uploadError;
    const { error: registerError } = await privilegedClient.rpc(
      "register_owner_verification_document_v2",
      { target_cleanup_id: cleanupId },
    );
    if (registerError) throw registerError;
  }
}

async function createSubmittedReviewFixture({
  fixture,
  privilegedClient,
  publishableKey,
  url,
}) {
  const { identity, ownerClient } = await ensureOwnerIdentity({
    url,
    publishableKey,
    privilegedClient,
    phone: fixture.reviewOwnerPhone,
  });
  const existing = await ownerClient
    .from("owner_applications")
    .select("id,status")
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) {
    if (existing.data.status !== "submitted") {
      throw new Error(
        `${fixture.project} access review fixture is incomplete: expected submitted application`,
      );
    }
    return;
  }
  await ensureOwnerRole(ownerClient);
  const application = await saveApplication(ownerClient, fixture, "review");
  await uploadApplicationDocuments({
    applicationId: application.id,
    ownerUserId: identity.id,
    privilegedClient,
  });
  const { error } = await ownerClient.rpc("submit_owner_application");
  if (error) throw error;
}

async function approveApplication({
  applicationId,
  ownerClient,
  reviewerClient,
}) {
  const submitted = requireData(
    await ownerClient
      .from("owner_applications")
      .select("version")
      .eq("id", applicationId)
      .single(),
    "Submitted booking fixture application is unavailable",
  );
  const { error } = await reviewerClient.rpc("review_owner_application", {
    target_application_id: applicationId,
    expected_version: submitted.version,
    requested_action: "approve",
    requested_reason: "Approved synthetic access booking fixture.",
    requested_fields: [],
    requested_document_kinds: [],
    requested_jurisdiction: "Kurdistan Region, Iraq",
    requested_licensing_basis: "licence",
    requested_licence_or_exemption_basis: "Synthetic test licence",
    requested_expiry_dates: { licensing_or_exemption: "2035-12-31" },
  });
  if (error) throw error;
}

async function preparePublishedProfile({
  fixture,
  ownerClient,
  privilegedClient,
  reviewerClient,
}) {
  const profile = requireData(
    await ownerClient
      .from("owner_application_cottage_profiles")
      .select("id,version")
      .single(),
    `${fixture.project} booking Cottage Profile is unavailable`,
  );
  const updated = requireData(
    await ownerClient.rpc("update_owner_cottage_profile_draft", {
      target_profile_id: profile.id,
      target_expected_version: profile.version,
      requested_name: fixture.bookingCottageName,
      requested_governorate: "Erbil",
      requested_approximate_location: "Synthetic access fixture area",
      requested_exact_address: "Synthetic private fixture address",
      requested_exact_latitude: "36.408333",
      requested_exact_longitude: "44.385834",
      requested_private_directions: "Synthetic private directions.",
      requested_capacity: 8,
      requested_bedrooms: 3,
      requested_bathrooms: 2,
      requested_amenities: ["garden", "parking"],
      requested_source_language: "en",
      requested_description:
        "Synthetic published Cottage Profile for access verification.",
      requested_house_rules: "Synthetic fixture only. Respect neighbours.",
    }),
    `${fixture.project} booking Cottage Profile was not updated`,
  );
  const schedule = await ownerClient.rpc("replace_cottage_shift_schedule", {
    target_profile_id: profile.id,
    target_expected_revision: 0,
    requested_shifts: [
      { name: "Morning", startTime: "08:00", endTime: "12:00" },
      { name: "Evening", startTime: "18:00", endTime: "23:00" },
    ],
  });
  if (schedule.error) throw schedule.error;

  const preparedPhoto = requireData(
    await ownerClient.rpc("prepare_cottage_profile_photo_upload", {
      target_profile_id: profile.id,
      requested_original_filename: "synthetic-access-cottage.png",
      requested_media_type: "image/png",
      requested_size_bytes: pngBytes.byteLength,
    }),
    `${fixture.project} booking Cottage Profile photo was not prepared`,
  );
  const { error: photoUploadError } = await privilegedClient.storage
    .from("cottage-profile-photos")
    .upload(preparedPhoto.object_path, pngBytes, {
      contentType: "image/png",
      upsert: false,
    });
  if (photoUploadError) throw photoUploadError;
  const { error: photoRegisterError } = await privilegedClient.rpc(
    "register_cottage_profile_photo",
    { target_photo_id: preparedPhoto.id },
  );
  if (photoRegisterError) throw photoRegisterError;

  const submittedProfile = requireData(
    await ownerClient.rpc("submit_cottage_profile_for_content_approval", {
      target_profile_id: profile.id,
      target_expected_version: updated.version,
    }),
    `${fixture.project} booking Cottage Profile was not submitted`,
  );
  const cycle = requireData(
    await privilegedClient
      .from("cottage_profile_review_cycles")
      .select("id")
      .eq("profile_id", submittedProfile.id)
      .eq("state", "in_review")
      .single(),
    `${fixture.project} booking Cottage Profile review cycle is unavailable`,
  );

  const runtimeReady = {
    production_ready: true,
    approved_evaluation_artifact_digest: "a".repeat(64),
    production_approval_digest: "b".repeat(64),
    provider_terms_approval_reference: "access-browser-fixture",
    native_review_approval_reference: "access-browser-fixture",
    quality_threshold_approval_reference: "access-browser-fixture",
    ordinary_model: "deterministic-fixture",
    ordinary_effort: "none",
    ordinary_prompt_version: "access-browser-v1",
    stronger_model: "deterministic-fixture",
    stronger_effort: "none",
    stronger_prompt_version: "access-browser-v1",
    judge_model: "deterministic-fixture",
    judge_effort: "none",
    judge_prompt_version: "access-browser-v1",
    monthly_request_limit: 100,
    monthly_token_limit: 100_000,
    monthly_spend_microusd_limit: 1_000_000,
  };
  const { error: readyError } = await privilegedClient
    .from("cottage_translation_runtime_control")
    .update(runtimeReady)
    .eq("singleton", true);
  if (readyError) throw readyError;
  try {
    for (const locale of ["ar", "ckb"]) {
      const attempt = requireData(
        await privilegedClient.rpc(
          "begin_cottage_profile_translation_execution",
          {
            target_review_cycle_id: cycle.id,
            target_language: locale,
            target_route: "ordinary",
            target_lease_milliseconds: 50_000,
          },
        ),
        `${fixture.project} ${locale} fixture translation did not start`,
      );
      const completed = requireData(
        await privilegedClient.rpc(
          "complete_cottage_profile_translation_execution",
          {
            target_attempt_id: attempt.id,
            target_lease_token: attempt.lease_token,
            translated_description: `${locale} synthetic description`,
            translated_house_rules: `${locale} synthetic House Rules`,
            returned_provider: "access-browser-fixture",
            returned_model: "deterministic-fixture",
            returned_effort: "test",
            returned_prompt_version: "access-browser-v1",
          },
        ),
        `${fixture.project} ${locale} fixture translation did not complete`,
      );
      if (completed !== true) {
        throw new Error(
          `${fixture.project} ${locale} fixture translation was superseded`,
        );
      }
    }
    for (const locale of ["en", "ar", "ckb"]) {
      const { error } = await reviewerClient.rpc(
        "decide_cottage_profile_localization",
        {
          target_review_cycle_id: cycle.id,
          target_locale: locale,
          target_approved: true,
          target_reason: "Approved synthetic access fixture localization.",
        },
      );
      if (error) throw error;
    }
    const { error: publicationError } = await reviewerClient.rpc(
      "approve_cottage_profile_publication",
      {
        target_review_cycle_id: cycle.id,
        target_reason: "Approved synthetic access booking fixture.",
      },
    );
    if (publicationError) throw publicationError;
  } finally {
    const { error } = await privilegedClient
      .from("cottage_translation_runtime_control")
      .update({ production_ready: false })
      .eq("singleton", true);
    if (error) throw error;
  }
}

async function createPublishedBookingFixture({
  fixture,
  privilegedClient,
  publishableKey,
  reviewerClient,
  url,
}) {
  const { identity, ownerClient } = await ensureOwnerIdentity({
    url,
    publishableKey,
    privilegedClient,
    phone: fixture.bookingOwnerPhone,
  });
  const existing = await ownerClient
    .from("owner_applications")
    .select("id,status")
    .maybeSingle();
  if (existing.error) throw existing.error;
  let applicationId;
  if (existing.data) {
    if (existing.data.status !== "approved") {
      throw new Error(
        `${fixture.project} access booking fixture is incomplete: expected approved published profile with current Shift Schedule`,
      );
    }
    applicationId = existing.data.id;
  } else {
    await ensureOwnerRole(ownerClient);
    const application = await saveApplication(ownerClient, fixture, "booking");
    applicationId = application.id;
    await uploadApplicationDocuments({
      applicationId: application.id,
      ownerUserId: identity.id,
      privilegedClient,
    });
    const { error: submitError } = await ownerClient.rpc(
      "submit_owner_application",
    );
    if (submitError) throw submitError;
    await approveApplication({
      applicationId: application.id,
      ownerClient,
      reviewerClient,
    });
    await preparePublishedProfile({
      fixture,
      ownerClient,
      privilegedClient,
      reviewerClient,
    });
  }

  const profile = requireData(
    await ownerClient
      .from("owner_application_cottage_profiles")
      .select("id,current_publication_id,current_shift_schedule_id")
      .eq("application_id", applicationId)
      .maybeSingle(),
    `${fixture.project} access booking fixture is incomplete: expected approved published profile with current Shift Schedule`,
  );
  if (!profile.current_publication_id || !profile.current_shift_schedule_id) {
    throw new Error(
      `${fixture.project} access booking fixture is incomplete: expected approved published profile with current Shift Schedule`,
    );
  }
  await ensureBookingFixtureStandardPricing({
    fixture,
    ownerClient,
    profile,
  });
}

export async function createAccessBrowserFixtures({
  projects,
  privilegedClient,
  publishableKey,
  reviewerClient,
  url,
}) {
  for (const project of projects) {
    const fixture = accessBrowserFixture(project);
    await createSubmittedReviewFixture({
      fixture,
      privilegedClient,
      publishableKey,
      url,
    });
    await createPublishedBookingFixture({
      fixture,
      privilegedClient,
      publishableKey,
      reviewerClient,
      url,
    });
  }
}

async function fixtureIdentity(privilegedClient, phone, description) {
  const users = await listAllAccessFixtureUsers(privilegedClient.auth.admin);
  const identity = findAccessFixtureUser(users, phone);
  if (!identity) throw new Error(`${description}: missing identity`);
  return identity;
}

export async function validateAccessBrowserFixtures({
  projects,
  privilegedClient,
  publishableKey,
  url,
}) {
  for (const project of projects) {
    const fixture = accessBrowserFixture(project);
    const reviewIdentity = await fixtureIdentity(
      privilegedClient,
      fixture.reviewOwnerPhone,
      `${project} access review fixture is incomplete`,
    );
    const reviewOwnerClient = await signInFixtureOwner({
      url,
      publishableKey,
      identity: reviewIdentity,
      phone: fixture.reviewOwnerPhone,
      description: `${project} access review fixture is incomplete`,
    });
    const reviewApplication = requireData(
      await reviewOwnerClient
        .from("owner_applications")
        .select("id,status,legal_name")
        .maybeSingle(),
      `${project} access review fixture is incomplete: missing submitted Owner Application`,
    );
    if (
      reviewApplication.status !== "submitted" ||
      reviewApplication.legal_name !== fixture.reviewLegalName
    ) {
      throw new Error(
        `${project} access review fixture is incomplete: expected submitted Owner Application`,
      );
    }
    const documentResult = await reviewOwnerClient
      .from("owner_verification_documents")
      .select("kind,object_path,original_filename")
      .eq("application_id", reviewApplication.id);
    if (documentResult.error) throw documentResult.error;
    const byKind = new Map(
      documentResult.data.map((document) => [document.kind, document]),
    );
    for (const [kind, filename] of documents) {
      const document = byKind.get(kind);
      if (!document || document.original_filename !== filename) {
        throw new Error(
          `${project} access review fixture is incomplete: missing ${filename} record`,
        );
      }
      const downloaded = await privilegedClient.storage
        .from("owner-verification")
        .download(document.object_path);
      if (downloaded.error || !downloaded.data) {
        throw new Error(
          `${project} access review fixture is incomplete: missing ${filename} object`,
          { cause: downloaded.error },
        );
      }
      if (filename === "licence.pdf") {
        const prefix = Buffer.from(await downloaded.data.arrayBuffer())
          .subarray(0, 4)
          .toString();
        if (prefix !== "%PDF") {
          throw new Error(
            `${project} access review fixture is incomplete: licence.pdf is not a PDF`,
          );
        }
      }
    }

    const bookingIdentity = await fixtureIdentity(
      privilegedClient,
      fixture.bookingOwnerPhone,
      `${project} access booking fixture is incomplete`,
    );
    const bookingOwnerClient = await signInFixtureOwner({
      url,
      publishableKey,
      identity: bookingIdentity,
      phone: fixture.bookingOwnerPhone,
      description: `${project} access booking fixture is incomplete`,
    });
    const bookingProfile = requireData(
      await bookingOwnerClient
        .from("owner_application_cottage_profiles")
        .select("id,name,current_publication_id,current_shift_schedule_id")
        .eq("name", fixture.bookingCottageName)
        .maybeSingle(),
      `${project} access booking fixture is incomplete: missing exact Cottage Profile`,
    );
    if (
      !bookingProfile.current_publication_id ||
      !bookingProfile.current_shift_schedule_id
    ) {
      throw new Error(
        `${project} access booking fixture is incomplete: missing current publication or Shift Schedule`,
      );
    }
    for (const locale of ["en", "ar", "ckb"]) {
      const currentPublication = await bookingOwnerClient.rpc(
        "get_current_cottage_publication",
        {
          target_profile_id: bookingProfile.id,
          target_locale: locale,
        },
      );
      if (currentPublication.error) throw currentPublication.error;
      const publication = currentPublication.data?.[0];
      if (
        publication?.publication_id !== bookingProfile.current_publication_id ||
        publication.name !== fixture.bookingCottageName
      ) {
        throw new Error(
          `${project} access booking fixture is incomplete: missing public ${locale} publication`,
        );
      }
    }
    const { expectedPricing, loadedPricing } = await loadBookingFixturePricing({
      fixture,
      ownerClient: bookingOwnerClient,
      profile: bookingProfile,
    });
    if (!hasExactStandardPricing(loadedPricing, expectedPricing)) {
      throw new Error(
        `${project} access booking fixture is incomplete: expected deterministic standard pricing`,
      );
    }
  }
}
