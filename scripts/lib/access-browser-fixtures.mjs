import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";

import {
  findAccessFixtureUser,
  listAllAccessFixtureUsers,
} from "./access-fixture-users.mjs";

export const ACCESS_BROWSER_PROJECTS = ["mobile", "desktop", "worker"];

export function requireDemoEnvironment(environment = process.env) {
  const project = environment.SUPABASE_LOCAL_PROJECT;
  const workdir = environment.SUPABASE_LOCAL_WORKDIR;
  let safeUrl = false;
  try {
    const url = new URL(environment.SUPABASE_URL);
    safeUrl =
      url.origin === "http://127.0.0.1:56331" &&
      url.pathname === "/" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash;
  } catch {
    safeUrl = false;
  }
  if (
    environment.APP_ENVIRONMENT !== "test" ||
    environment.SUPABASE_PROJECT_REF !== "local-test" ||
    !safeUrl ||
    !/^rentcottage-demo-[A-Za-z0-9]+$/.test(project ?? "") ||
    !workdir ||
    !isAbsolute(workdir) ||
    basename(resolve(workdir)) !== project ||
    !environment.SUPABASE_SECRET_KEY ||
    !environment.SUPABASE_PUBLISHABLE_KEY
  ) {
    throw new Error(
      "Demo fixtures require an isolated test/local-test project at http://127.0.0.1:56331, matching rentcottage-demo workdir and local credentials; create a fresh owned project.",
    );
  }
  return resolve(workdir);
}

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

export function demoBrowserFixtures() {
  const houseRules = {
    en: "Respect neighbours, do not smoke indoors, and stay within the guest capacity.",
    ar: "احترم الجيران، ولا تدخن داخل الكوخ، ولا تتجاوز عدد الضيوف المسموح به.",
    ckb: "ڕێز لە دراوسێکان بگرە، لە ناو کۆخەکە جگەرە مەکێشە، و لە ژمارەی ڕێپێدراوی میوانان زیاتر مەبە.",
  };
  const cottages = [
    {
      name: "Palm Garden",
      governorate: "Erbil",
      approximateLocation: "Shaqlawa",
      capacity: 8,
      bedrooms: 3,
      bathrooms: 2,
      amenities: ["garden", "parking", "pool"],
      prices: [180000, 190000, 250000],
      photoFilename: "cottage-pool.png",
      descriptions: {
        en: "A fictional leisure cottage with a garden, parking and pool.",
        ar: "كوخ ترفيهي خيالي مع حديقة وموقف سيارات ومسبح.",
        ckb: "کۆخێکی خەیاڵی بۆ پشوودان بە باخچە و شوێنی پارککردن و مەلەوانگە.",
      },
    },
    {
      name: "Zab Riverside",
      governorate: "Erbil",
      approximateLocation: "Koya",
      capacity: 6,
      bedrooms: 2,
      bathrooms: 1,
      amenities: ["garden", "parking", "outdoor_seating"],
      prices: [140000, 150000, 220000],
      photoFilename: "cottage-river.png",
      descriptions: {
        en: "A fictional leisure cottage with a garden, parking and outdoor seating.",
        ar: "كوخ ترفيهي خيالي مع حديقة وموقف سيارات وجلسات خارجية.",
        ckb: "کۆخێکی خەیاڵی بۆ پشوودان بە باخچە و شوێنی پارککردن و دانیشتنی دەرەوە.",
      },
    },
    {
      name: "Dukan Hills",
      governorate: "Sulaymaniyah",
      approximateLocation: "Dukan",
      capacity: 12,
      bedrooms: 4,
      bathrooms: 3,
      amenities: ["garden", "pool", "wifi"],
      prices: [240000, 260000, 360000],
      photoFilename: "cottage-hills.png",
      descriptions: {
        en: "A fictional leisure cottage with a garden, pool and Wi-Fi.",
        ar: "كوخ ترفيهي خيالي مع حديقة ومسبح وخدمة واي فاي.",
        ckb: "کۆخێکی خەیاڵی بۆ پشوودان بە باخچە و مەلەوانگە و وایفای.",
      },
    },
    {
      name: "Orchard Retreat",
      governorate: "Duhok",
      approximateLocation: "Amedi",
      capacity: 4,
      bedrooms: 2,
      bathrooms: 1,
      amenities: ["garden", "parking", "wifi"],
      prices: [100000, 120000, 180000],
      photoFilename: "cottage-orchard.png",
      descriptions: {
        en: "A fictional leisure cottage with a garden, parking and Wi-Fi.",
        ar: "كوخ ترفيهي خيالي مع حديقة وموقف سيارات وخدمة واي فاي.",
        ckb: "کۆخێکی خەیاڵی بۆ پشوودان بە باخچە و شوێنی پارککردن و وایفای.",
      },
    },
    {
      name: "Tigris Courtyard",
      governorate: "Baghdad",
      approximateLocation: "Al-Tarmiyah",
      capacity: 10,
      bedrooms: 3,
      bathrooms: 2,
      amenities: ["pool", "parking", "air_conditioning"],
      prices: [210000, 230000, 320000],
      photoFilename: "cottage-garden.png",
      descriptions: {
        en: "A fictional leisure cottage with a pool, parking and air conditioning.",
        ar: "كوخ ترفيهي خيالي مع مسبح وموقف سيارات وتكييف.",
        ckb: "کۆخێکی خەیاڵی بۆ پشوودان بە مەلەوانگە و شوێنی پارککردن و ساردکەرەوە.",
      },
    },
    {
      name: "Date Palm Cottage",
      governorate: "Babil",
      approximateLocation: "Hillah",
      capacity: 16,
      bedrooms: 5,
      bathrooms: 3,
      amenities: ["garden", "pool", "outdoor_seating"],
      prices: [300000, 320000, 450000],
      photoFilename: "cottage-dusk.png",
      descriptions: {
        en: "A fictional leisure cottage with a garden, pool and outdoor seating.",
        ar: "كوخ ترفيهي خيالي مع حديقة ومسبح وجلسات خارجية.",
        ckb: "کۆخێکی خەیاڵی بۆ پشوودان بە باخچە و مەلەوانگە و دانیشتنی دەرەوە.",
      },
    },
  ];
  return cottages.map(({ name, ...content }, index) => ({
    ...accessBrowserFixture("desktop"),
    project: `demo-${index + 1}`,
    bookingOwnerPhone: index === 0 ? "+9647540000001" : `+964754000001${index}`,
    bookingLegalName: `Fictional ${name} Owner`,
    bookingCottageName: name,
    demoContent: { ...content, houseRules: { ...houseRules } },
  }));
}

export function assertDemoFixtureReadback(
  { profile, publications, pricing },
  fixture,
) {
  const fail = (reason) => {
    throw new Error(
      `Demo fixture readback for ${fixture.bookingCottageName}: ${reason}; create a fresh owned demo project.`,
    );
  };
  if (
    typeof profile?.id !== "string" ||
    !profile.id ||
    typeof profile.current_publication_id !== "string" ||
    !profile.current_publication_id ||
    typeof profile.current_shift_schedule_id !== "string" ||
    !profile.current_shift_schedule_id
  ) {
    fail("missing current profile, publication or Shift Schedule");
  }
  const content = fixture.demoContent;
  if (
    !publications ||
    Array.isArray(publications) ||
    Object.keys(publications).length !== 3
  ) {
    fail("expected exactly three locale readbacks");
  }
  for (const locale of ["en", "ar", "ckb"]) {
    const rows = publications[locale];
    if (!Array.isArray(rows) || rows.length !== 1)
      fail(`expected one ${locale} publication`);
    const row = rows[0];
    if (
      row?.publication_id !== profile.current_publication_id ||
      row.name !== fixture.bookingCottageName ||
      row.governorate !== content.governorate ||
      row.approximate_location !== content.approximateLocation ||
      row.capacity !== content.capacity ||
      row.bedrooms !== content.bedrooms ||
      row.bathrooms !== content.bathrooms ||
      !Array.isArray(row.amenities) ||
      row.amenities.length !== content.amenities.length ||
      new Set(row.amenities).size !== row.amenities.length ||
      content.amenities.some((amenity) => !row.amenities.includes(amenity)) ||
      row.description !== content.descriptions[locale] ||
      row.house_rules !== content.houseRules[locale] ||
      !Array.isArray(row.media_ids) ||
      row.media_ids.length === 0 ||
      row.media_ids.some((id) => typeof id !== "string" || !id)
    )
      fail(`wrong or incomplete ${locale} publication facts`);
  }
  if (
    pricing?.profileId !== profile.id ||
    pricing.scheduleRevisionId !== profile.current_shift_schedule_id ||
    !Array.isArray(pricing.units) ||
    pricing.units.length !== 3 ||
    new Set(pricing.units.map((unit) => unit?.id)).size !== 3
  )
    fail("expected pricing for the current schedule with three unique units");
  for (const [index, unit] of pricing.units.entries()) {
    if (
      typeof unit?.id !== "string" ||
      !unit.id ||
      unit.kind !== (index === 2 ? "full_day_bundle" : "shift") ||
      unit.standardPriceIqd !== content.prices[index] ||
      !Array.isArray(unit.weekdayOverrides) ||
      unit.weekdayOverrides.length !== 0 ||
      !Array.isArray(unit.dateOverrides) ||
      unit.dateOverrides.length !== 0
    )
      fail("wrong or incomplete standard pricing");
  }
}

export function assertDemoInventoryReadback({
  ownerCalendar,
  publicAvailability,
  expectedUnits,
}) {
  const fail = (reason) => {
    throw new Error(
      `Demo inventory readback: ${reason}; create a fresh owned demo project.`,
    );
  };
  if (
    typeof ownerCalendar?.profileId !== "string" ||
    !ownerCalendar.profileId ||
    typeof ownerCalendar.scheduleRevisionId !== "string" ||
    !ownerCalendar.scheduleRevisionId ||
    typeof ownerCalendar.serviceDay !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(ownerCalendar.serviceDay) ||
    publicAvailability?.profileId !== ownerCalendar.profileId ||
    publicAvailability.scheduleRevisionId !==
      ownerCalendar.scheduleRevisionId ||
    publicAvailability.serviceDay !== ownerCalendar.serviceDay ||
    Object.keys(publicAvailability).sort().join(",") !==
      "profileId,scheduleRevisionId,serviceDay,units"
  )
    fail("missing or mismatched inventory envelope");
  for (const units of [
    ownerCalendar.units,
    publicAvailability.units,
    expectedUnits,
  ]) {
    if (
      !Array.isArray(units) ||
      units.length !== 3 ||
      new Set(units.map((unit) => unit?.id)).size !== 3 ||
      units.some((unit) => typeof unit?.id !== "string" || !unit.id) ||
      units.filter((unit) => unit.kind === "shift").length !== 2 ||
      units.filter((unit) => unit.kind === "full_day_bundle").length !== 1
    )
      fail("expected three unique inventory units");
  }
  for (const expected of expectedUnits) {
    const owner = ownerCalendar.units.find((unit) => unit.id === expected.id);
    const publicUnit = publicAvailability.units.find(
      (unit) => unit.id === expected.id,
    );
    if (
      owner?.kind !== expected.kind ||
      owner.calendarState !== expected.calendarState ||
      typeof expected.available !== "boolean" ||
      owner.available !== expected.available ||
      publicUnit?.kind !== expected.kind ||
      publicUnit.available !== expected.available
    )
      fail("inventory state does not match the prepared unit");
    if (Object.keys(publicUnit).sort().join(",") !== "available,id,kind")
      fail("public availability leaked a private field or reason");
  }
}

const password = "Local-test-password-2026";
const pdfBytes = new TextEncoder().encode(
  "%PDF-1.7\nsynthetic access fixture\n%%EOF",
);
const pdfDigest = createHash("sha256").update(pdfBytes).digest("hex");
const cottagePhotoFilenames = new Map([
  ["mobile", "cottage-garden.png"],
  ["desktop", "cottage-pool.png"],
  ["worker", "cottage-river.png"],
]);
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

async function cottagePhoto(project, demoContent) {
  const filename =
    demoContent?.photoFilename ?? cottagePhotoFilenames.get(project);
  if (!filename) {
    throw new Error(`Unknown access browser fixture project: ${project}`);
  }
  return {
    bytes: await readFile(resolve("public/uploads", filename)),
    filename,
  };
}

function requireData(result, message) {
  if (result.error) throw result.error;
  if (!result.data) throw new Error(message);
  return result.data;
}

function deterministicStandardPricing(schedule, shifts, demoContent) {
  if (!schedule.full_day_bundle_id || shifts.length !== 2) return null;
  const units = shifts.map((shift) => {
    const standardPriceIqd = demoContent
      ? demoContent.prices[shift.position - 1]
      : standardShiftPrices.get(shift.position);
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
      standardPriceIqd: demoContent?.prices[2] ?? standardFullDayPrice,
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
  const expectedPricing = deterministicStandardPricing(
    schedule,
    shifts.data,
    fixture.demoContent,
  );
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
  const demoContent = fixture.demoContent;
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
    requested_governorate: demoContent?.governorate ?? "Erbil",
    requested_approximate_location:
      demoContent?.approximateLocation ?? "Synthetic access fixture area",
    requested_exact_address: fixture.exactAddress,
    requested_capacity: demoContent?.capacity ?? 8,
    requested_bedrooms: demoContent?.bedrooms ?? 3,
    requested_bathrooms: demoContent?.bathrooms ?? 2,
    requested_amenities: demoContent?.amenities ?? ["garden", "parking"],
    requested_description:
      demoContent?.descriptions.en ??
      "Synthetic Cottage Profile for access verification.",
    requested_house_rules:
      demoContent?.houseRules.en ??
      "Synthetic fixture only. Respect neighbours.",
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

export async function createSubmittedReviewFixture({
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
  demoContent,
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
    requested_reason: demoContent
      ? "Approved fictional demo owner fixture."
      : "Approved synthetic access booking fixture.",
    requested_fields: [],
    requested_document_kinds: [],
    requested_jurisdiction: demoContent
      ? "Iraq (fictional demo)"
      : "Kurdistan Region, Iraq",
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
  const demoContent = fixture.demoContent;
  const samplePhoto = await cottagePhoto(fixture.project, demoContent);
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
      requested_governorate: demoContent?.governorate ?? "Erbil",
      requested_approximate_location:
        demoContent?.approximateLocation ?? "Synthetic access fixture area",
      requested_exact_address: "Synthetic private fixture address",
      requested_exact_latitude: "36.408333",
      requested_exact_longitude: "44.385834",
      requested_private_directions: "Synthetic private directions.",
      requested_capacity: demoContent?.capacity ?? 8,
      requested_bedrooms: demoContent?.bedrooms ?? 3,
      requested_bathrooms: demoContent?.bathrooms ?? 2,
      requested_amenities: demoContent?.amenities ?? ["garden", "parking"],
      requested_source_language: "en",
      requested_description:
        demoContent?.descriptions.en ??
        "Synthetic published Cottage Profile for access verification.",
      requested_house_rules:
        demoContent?.houseRules.en ??
        "Synthetic fixture only. Respect neighbours.",
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
      requested_original_filename: samplePhoto.filename,
      requested_media_type: "image/png",
      requested_size_bytes: samplePhoto.bytes.byteLength,
    }),
    `${fixture.project} booking Cottage Profile photo was not prepared`,
  );
  const { error: photoUploadError } = await privilegedClient.storage
    .from("cottage-profile-photos")
    .upload(preparedPhoto.object_path, samplePhoto.bytes, {
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
  const originalRuntime = demoContent
    ? requireData(
        await privilegedClient
          .from("cottage_translation_runtime_control")
          .select(Object.keys(runtimeReady).join(","))
          .eq("singleton", true)
          .single(),
        "Demo fixture translation runtime control is unavailable",
      )
    : null;
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
            translated_description:
              demoContent?.descriptions[locale] ??
              `${locale} synthetic description`,
            translated_house_rules:
              demoContent?.houseRules[locale] ??
              `${locale} synthetic House Rules`,
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
      .update(originalRuntime ?? { production_ready: false })
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
      demoContent: fixture.demoContent,
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

export async function createDemoBrowserFixtures({
  privilegedClient,
  publishableKey,
  reviewerClient,
  url,
}) {
  const fixtures = demoBrowserFixtures();
  const users = await listAllAccessFixtureUsers(privilegedClient.auth.admin);
  const snapshots = requireData(
    await privilegedClient
      .from("cottage_publication_snapshots")
      .select("id,profile_id,name"),
    "Demo fixture preflight could not read publication snapshots",
  );
  if (
    fixtures.some((fixture) =>
      findAccessFixtureUser(users, fixture.bookingOwnerPhone),
    ) ||
    !Array.isArray(snapshots) ||
    snapshots.length !== 0
  ) {
    throw new Error(
      "Demo fixtures already exist or are partial; create a fresh owned demo project.",
    );
  }
  for (const fixture of fixtures) {
    await createPublishedBookingFixture({
      fixture,
      privilegedClient,
      publishableKey,
      reviewerClient,
      url,
    });
  }
  return validateDemoBrowserFixtures({ privilegedClient, publishableKey, url });
}

export async function validateDemoBrowserFixtures({
  privilegedClient,
  publishableKey,
  url,
}) {
  const fixtures = demoBrowserFixtures();
  const snapshots = requireData(
    await privilegedClient
      .from("cottage_publication_snapshots")
      .select("id,profile_id,name"),
    "Demo publications are unavailable",
  );
  if (
    !Array.isArray(snapshots) ||
    snapshots.length !== 6 ||
    snapshots.some(
      (snapshot) =>
        typeof snapshot?.id !== "string" ||
        !snapshot.id ||
        typeof snapshot.profile_id !== "string" ||
        !snapshot.profile_id ||
        typeof snapshot.name !== "string" ||
        !snapshot.name,
    ) ||
    new Set(snapshots.map((snapshot) => snapshot.profile_id)).size !== 6 ||
    new Set(snapshots.map((snapshot) => snapshot.name)).size !== 6 ||
    fixtures.some(
      (fixture) =>
        !snapshots.some(
          (snapshot) => snapshot.name === fixture.bookingCottageName,
        ),
    )
  )
    throw new Error(
      "Demo validation requires exactly the six approved fictional publications; create a fresh owned demo project.",
    );
  const validated = [];
  for (const fixture of fixtures) {
    const identity = await fixtureIdentity(
      privilegedClient,
      fixture.bookingOwnerPhone,
      fixture.bookingCottageName,
    );
    const ownerClient = await signInFixtureOwner({
      url,
      publishableKey,
      identity,
      phone: fixture.bookingOwnerPhone,
      description: fixture.bookingCottageName,
    });
    const context = requireData(
      await ownerClient
        .from("account_contexts")
        .select("role,owner_approval_state")
        .single(),
      "Demo owner access context is unavailable",
    );
    const application = requireData(
      await ownerClient
        .from("owner_applications")
        .select(
          "id,status,legal_name,submitted_at,decided_at,current_verification_record_id",
        )
        .single(),
      "Demo Owner Application is unavailable",
    );
    if (
      context.role !== "cottage_owner" ||
      context.owner_approval_state !== "approved" ||
      application.status !== "approved" ||
      application.legal_name !== fixture.bookingLegalName ||
      !application.submitted_at ||
      !application.decided_at ||
      !application.current_verification_record_id
    )
      throw new Error(
        `Demo owner approval is incomplete for ${fixture.bookingCottageName}`,
      );
    const documentRows = requireData(
      await ownerClient
        .from("owner_verification_documents")
        .select("kind,object_path")
        .eq("application_id", application.id),
      "Demo verification documents are unavailable",
    );
    if (
      documentRows.length !== documents.length ||
      new Set(documentRows.map((document) => document.kind)).size !==
        documents.length
    ) {
      throw new Error(
        `Demo verification documents are incomplete for ${fixture.bookingCottageName}`,
      );
    }
    for (const [kind] of documents) {
      const document = documentRows.find((row) => row.kind === kind);
      if (!document?.object_path)
        throw new Error(`Demo verification document ${kind} is missing`);
      const downloaded = requireData(
        await privilegedClient.storage
          .from("owner-verification")
          .download(document.object_path),
        `Demo verification document ${kind} object is missing`,
      );
      if (
        Buffer.from(await downloaded.arrayBuffer())
          .subarray(0, 4)
          .toString() !== "%PDF"
      ) {
        throw new Error(`Demo verification document ${kind} is not a PDF`);
      }
    }
    const profile = requireData(
      await ownerClient
        .from("owner_application_cottage_profiles")
        .select(
          "id,name,owner_user_id,current_publication_id,current_shift_schedule_id",
        )
        .eq("application_id", application.id)
        .single(),
      "Demo Cottage Profile is unavailable",
    );
    if (
      profile.owner_user_id !== identity.id ||
      profile.name !== fixture.bookingCottageName ||
      snapshots.filter(
        (snapshot) =>
          snapshot.profile_id === profile.id &&
          snapshot.id === profile.current_publication_id &&
          snapshot.name === fixture.bookingCottageName,
      ).length !== 1
    ) {
      throw new Error(
        `Demo Cottage Profile does not match ${fixture.bookingCottageName}`,
      );
    }
    const publications = {};
    for (const locale of ["en", "ar", "ckb"]) {
      publications[locale] = requireData(
        await ownerClient.rpc("get_current_cottage_publication", {
          target_profile_id: profile.id,
          target_locale: locale,
        }),
        `Demo ${locale} publication is unavailable`,
      );
    }
    const { loadedPricing } = await loadBookingFixturePricing({
      fixture,
      ownerClient,
      profile,
    });
    assertDemoFixtureReadback(
      { profile, publications, pricing: loadedPricing },
      fixture,
    );
    validated.push({ fixture, profile });
  }
  return validated;
}
