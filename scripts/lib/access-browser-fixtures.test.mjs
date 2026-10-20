import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import * as fixtures from "./access-browser-fixtures.mjs";
import { accessJourneyOtpEntries } from "./access-journey-fixtures.mjs";
import {
  browserBookingFixtureIdentity,
  bookingFixtureSource,
  confirmedBookingAccessFixtureSource,
  confirmedBookingCleanup,
  customerReviewCleanup,
  confirmedBookingAccessCleanup,
  captureCleanup,
  refundReset,
} from "./booking-fixture.mjs";
import * as notificationFixtures from "../booking-request-notification-fixture.mjs";

const demoEnvironment = {
  APP_ENVIRONMENT: "test",
  SUPABASE_PROJECT_REF: "local-test",
  SUPABASE_URL: "http://127.0.0.1:56331",
  SUPABASE_LOCAL_PROJECT: "rentcottage-demo-A1b2C3",
  SUPABASE_LOCAL_WORKDIR: "/tmp/rentcottage-demo-A1b2C3",
  SUPABASE_SECRET_KEY: "synthetic-secret-key",
  SUPABASE_PUBLISHABLE_KEY: "synthetic-publishable-key",
};

test("demo selection rejects unsafe environments and mixed projects before external work", () => {
  assert.equal(
    fixtures.requireDemoEnvironment(demoEnvironment),
    resolve("/tmp/rentcottage-demo-A1b2C3"),
  );
  const unsafeEnvironments = [
    { APP_ENVIRONMENT: "production" },
    { SUPABASE_PROJECT_REF: "hosted-project" },
    { SUPABASE_URL: "http://127.0.0.1:54331" },
    { SUPABASE_URL: "https://127.0.0.1:56331" },
    { SUPABASE_URL: "http://127.0.0.1:56331/rest/v1" },
    { SUPABASE_URL: "http://user:password@127.0.0.1:56331" },
    { SUPABASE_URL: "http://127.0.0.1:56331/?project=other" },
    { SUPABASE_URL: "http://127.0.0.1:56331/#other" },
    { SUPABASE_LOCAL_PROJECT: "" },
    { SUPABASE_LOCAL_PROJECT: "rentcottage-demo" },
    { SUPABASE_LOCAL_PROJECT: "rentcottage-access-owned" },
    { SUPABASE_LOCAL_WORKDIR: "/tmp/rentcottage-demo-Other" },
    { SUPABASE_LOCAL_WORKDIR: "rentcottage-demo-A1b2C3" },
    { SUPABASE_LOCAL_WORKDIR: "" },
    { SUPABASE_SECRET_KEY: "" },
    { SUPABASE_PUBLISHABLE_KEY: "" },
  ];
  for (const unsafe of unsafeEnvironments) {
    assert.throws(
      () => fixtures.requireDemoEnvironment({ ...demoEnvironment, ...unsafe }),
      /Demo fixtures require/,
    );
  }
  for (const mode of ["create", "validate"]) {
    for (const projects of [
      ["demo", "desktop"],
      ["demo", "demo"],
    ]) {
      const rejected = spawnSync(
        process.execPath,
        ["scripts/prepare-access-test.mjs", mode, ...projects],
        {
          env: { ...process.env, ...demoEnvironment },
          encoding: "utf8",
        },
      );
      assert.equal(rejected.status, 2, rejected.stderr);
      assert.match(rejected.stderr, /Usage:/);
    }
    const stale = spawnSync(
      process.execPath,
      ["scripts/prepare-access-test.mjs", mode, "demo"],
      {
        env: {
          ...process.env,
          ...demoEnvironment,
          SUPABASE_URL: "http://127.0.0.1:54331",
        },
        encoding: "utf8",
      },
    );
    assert.equal(stale.status, 2, stale.stderr);
    assert.match(stale.stderr, /Demo fixtures require/);
    assert.doesNotMatch(
      stale.stderr,
      /synthetic-secret-key|synthetic-publishable-key|fetch failed/,
    );
  }
  assert.deepEqual(fixtures.accessBrowserFixture("desktop"), {
    project: "desktop",
    exactAddress: "Synthetic private fixture address",
    reviewOwnerPhone: "+9647530000001",
    reviewLegalName: "Desktop Access Review Fixture",
    reviewCottageName: "Desktop Review Fixture Cottage",
    bookingOwnerPhone: "+9647540000001",
    bookingLegalName: "Desktop Access Booking Fixture",
    bookingCottageName: "Desktop Booking Fixture Cottage",
  });
});

const approvedCottages = [
  [
    "Palm Garden",
    "Erbil",
    "Shaqlawa",
    8,
    3,
    2,
    ["garden", "parking", "pool"],
    [180000, 190000, 250000],
    "cottage-pool.png",
    "+9647540000001",
  ],
  [
    "Zab Riverside",
    "Erbil",
    "Koya",
    6,
    2,
    1,
    ["garden", "parking", "outdoor_seating"],
    [140000, 150000, 220000],
    "cottage-river.png",
    "+9647540000011",
  ],
  [
    "Dukan Hills",
    "Sulaymaniyah",
    "Dukan",
    12,
    4,
    3,
    ["garden", "pool", "wifi"],
    [240000, 260000, 360000],
    "cottage-hills.png",
    "+9647540000012",
  ],
  [
    "Orchard Retreat",
    "Duhok",
    "Amedi",
    4,
    2,
    1,
    ["garden", "parking", "wifi"],
    [100000, 120000, 180000],
    "cottage-orchard.png",
    "+9647540000013",
  ],
  [
    "Tigris Courtyard",
    "Baghdad",
    "Al-Tarmiyah",
    10,
    3,
    2,
    ["pool", "parking", "air_conditioning"],
    [210000, 230000, 320000],
    "cottage-garden.png",
    "+9647540000014",
  ],
  [
    "Date Palm Cottage",
    "Babil",
    "Hillah",
    16,
    5,
    3,
    ["garden", "pool", "outdoor_seating"],
    [300000, 320000, 450000],
    "cottage-dusk.png",
    "+9647540000015",
  ],
];

test("demo readback rejects missing publications and malformed pricing", () => {
  const demoFixtures = fixtures.demoBrowserFixtures();
  assert.equal(demoFixtures.length, 6);
  assert.deepEqual(
    demoFixtures.map((fixture) => [
      fixture.bookingCottageName,
      fixture.demoContent.governorate,
      fixture.demoContent.approximateLocation,
      fixture.demoContent.capacity,
      fixture.demoContent.bedrooms,
      fixture.demoContent.bathrooms,
      fixture.demoContent.amenities,
      fixture.demoContent.prices,
      fixture.demoContent.photoFilename,
      fixture.bookingOwnerPhone,
    ]),
    approvedCottages,
  );
  assert.deepEqual(
    demoFixtures.map((fixture) => fixture.bookingLegalName),
    [
      "Fictional Palm Garden Owner",
      "Fictional Zab Riverside Owner",
      "Fictional Dukan Hills Owner",
      "Fictional Orchard Retreat Owner",
      "Fictional Tigris Courtyard Owner",
      "Fictional Date Palm Cottage Owner",
    ],
  );
  const fixture = demoFixtures[2];
  const profile = {
    id: "00000000-0000-4000-8000-000000000001",
    current_publication_id: "00000000-0000-4000-8000-000000000002",
    current_shift_schedule_id: "00000000-0000-4000-8000-000000000003",
  };
  const publications = {
    en: [
      {
        publication_id: profile.current_publication_id,
        name: "Dukan Hills",
        governorate: "Sulaymaniyah",
        approximate_location: "Dukan",
        capacity: 12,
        bedrooms: 4,
        bathrooms: 3,
        amenities: ["garden", "pool", "wifi"],
        description:
          "A fictional leisure cottage with a garden, pool and Wi-Fi.",
        house_rules:
          "Respect neighbours, do not smoke indoors, and stay within the guest capacity.",
        media_ids: ["00000000-0000-4000-8000-000000000004"],
      },
    ],
    ar: [
      {
        publication_id: profile.current_publication_id,
        name: "Dukan Hills",
        governorate: "Sulaymaniyah",
        approximate_location: "Dukan",
        capacity: 12,
        bedrooms: 4,
        bathrooms: 3,
        amenities: ["garden", "pool", "wifi"],
        description: "كوخ ترفيهي خيالي مع حديقة ومسبح وخدمة واي فاي.",
        house_rules:
          "احترم الجيران، ولا تدخن داخل الكوخ، ولا تتجاوز عدد الضيوف المسموح به.",
        media_ids: ["00000000-0000-4000-8000-000000000004"],
      },
    ],
    ckb: [
      {
        publication_id: profile.current_publication_id,
        name: "Dukan Hills",
        governorate: "Sulaymaniyah",
        approximate_location: "Dukan",
        capacity: 12,
        bedrooms: 4,
        bathrooms: 3,
        amenities: ["garden", "pool", "wifi"],
        description: "کۆخێکی خەیاڵی بۆ پشوودان بە باخچە و مەلەوانگە و وایفای.",
        house_rules:
          "ڕێز لە دراوسێکان بگرە، لە ناو کۆخەکە جگەرە مەکێشە، و لە ژمارەی ڕێپێدراوی میوانان زیاتر مەبە.",
        media_ids: ["00000000-0000-4000-8000-000000000004"],
      },
    ],
  };
  const pricing = {
    profileId: profile.id,
    scheduleRevisionId: profile.current_shift_schedule_id,
    serviceDay: null,
    units: [
      {
        id: "00000000-0000-4000-8000-000000000005",
        kind: "shift",
        standardPriceIqd: 240000,
        weekdayOverrides: [],
        dateOverrides: [],
      },
      {
        id: "00000000-0000-4000-8000-000000000006",
        kind: "shift",
        standardPriceIqd: 260000,
        weekdayOverrides: [],
        dateOverrides: [],
      },
      {
        id: "00000000-0000-4000-8000-000000000007",
        kind: "full_day_bundle",
        standardPriceIqd: 360000,
        weekdayOverrides: [],
        dateOverrides: [],
      },
    ],
  };
  const valid = { profile, publications, pricing };
  assert.doesNotThrow(() => fixtures.assertDemoFixtureReadback(valid, fixture));
  const malformed = [
    (data) => {
      data.profile = null;
    },
    (data) => {
      delete data.profile.current_publication_id;
    },
    (data) => {
      delete data.profile.current_shift_schedule_id;
    },
    (data) => {
      data.publications = [];
    },
    (data) => {
      delete data.publications.ar;
    },
    (data) => {
      data.publications.ckb = [];
    },
    (data) => {
      data.publications.en.push(data.publications.en[0]);
    },
    (data) => {
      data.publications.en[0].publication_id = "other";
    },
    (data) => {
      data.publications.en[0].governorate = "Erbil";
    },
    (data) => {
      data.publications.ar[0].description = "";
    },
    (data) => {
      data.publications.ckb[0].house_rules = "wrong rules";
    },
    (data) => {
      data.publications.en[0].media_ids = [];
    },
    (data) => {
      data.pricing = null;
    },
    (data) => {
      data.pricing.units.pop();
    },
    (data) => {
      data.pricing.units[1] = data.pricing.units[0];
    },
    (data) => {
      data.pricing.units[0].standardPriceIqd = 180000;
    },
  ];
  for (const corrupt of malformed) {
    const data = structuredClone(valid);
    corrupt(data);
    assert.throws(
      () => fixtures.assertDemoFixtureReadback(data, fixture),
      /Demo fixture readback/,
    );
  }
});

test("demo inventory readback rejects missing units and leaked private reasons", () => {
  const expectedUnits = [
    {
      id: "morning",
      kind: "shift",
      calendarState: "private_blocked",
      available: false,
    },
    { id: "evening", kind: "shift", calendarState: "open", available: true },
    {
      id: "bundle",
      kind: "full_day_bundle",
      calendarState: "closed",
      available: false,
    },
  ];
  const envelope = {
    profileId: "fictional-cottage",
    scheduleRevisionId: "fictional-schedule",
    serviceDay: "2026-11-03",
  };
  const valid = {
    expectedUnits,
    ownerCalendar: {
      ...envelope,
      units: expectedUnits.map((unit) => ({
        ...unit,
        priceIqd: 300000,
        commitmentReference: null,
        editable: true,
      })),
    },
    publicAvailability: {
      ...envelope,
      units: [
        { id: "morning", kind: "shift", available: false },
        { id: "evening", kind: "shift", available: true },
        { id: "bundle", kind: "full_day_bundle", available: false },
      ],
    },
  };
  assert.doesNotThrow(() => fixtures.assertDemoInventoryReadback(valid));
  const malformed = [
    (data) => {
      data.ownerCalendar = null;
    },
    (data) => {
      data.publicAvailability = null;
    },
    (data) => {
      data.ownerCalendar.serviceDay = null;
    },
    (data) => {
      data.publicAvailability.profileId = "other-cottage";
    },
    (data) => {
      data.publicAvailability.scheduleRevisionId = "old-schedule";
    },
    (data) => {
      data.publicAvailability.serviceDay = "2026-11-04";
    },
    (data) => {
      delete data.ownerCalendar.units;
    },
    (data) => {
      data.publicAvailability.units = [];
    },
    (data) => {
      data.ownerCalendar.units.pop();
    },
    (data) => {
      data.publicAvailability.units.pop();
    },
    (data) => {
      data.publicAvailability.units[1] = data.publicAvailability.units[0];
    },
    (data) => {
      data.ownerCalendar.units[0].calendarState = "open";
    },
    (data) => {
      data.ownerCalendar.units[0].available = true;
    },
    (data) => {
      data.publicAvailability.units[0].available = true;
    },
    (data) => {
      data.publicAvailability.units[0].available = "false";
    },
    (data) => {
      data.publicAvailability.units[2].kind = "shift";
    },
    (data) => {
      data.publicAvailability.units[0].id = "other-unit";
    },
    (data) => {
      data.publicAvailability.units[0].ownerState = "private_blocked";
    },
    (data) => {
      data.publicAvailability.units[0].reason = "Synthetic private reason";
    },
    (data) => {
      data.publicAvailability.units[0].priceIqd = 300000;
    },
    (data) => {
      data.publicAvailability.commitmentReference = "private-reference";
    },
  ];
  for (const corrupt of malformed) {
    const data = structuredClone(valid);
    corrupt(data);
    assert.throws(
      () => fixtures.assertDemoInventoryReadback(data),
      /Demo inventory readback/,
    );
  }
});

test("browser account fixtures are disjoint by file and project", async () => {
  // Phone and name ownership is the approved plan's table, independent of allocation.
  const ownership = [
    [
      "access",
      "mobile",
      "+9647530000000",
      "+9647540000000",
      "Mobile Access Review Fixture",
      "Mobile Review Fixture Cottage",
      "Mobile Access Booking Fixture",
      "Mobile Booking Fixture Cottage",
    ],
    [
      "access",
      "desktop",
      "+9647530000001",
      "+9647540000001",
      "Desktop Access Review Fixture",
      "Desktop Review Fixture Cottage",
      "Desktop Access Booking Fixture",
      "Desktop Booking Fixture Cottage",
    ],
    [
      "access",
      "worker",
      "+9647530000002",
      "+9647540000002",
      "Worker Access Review Fixture",
      "Worker Review Fixture Cottage",
      "Worker Access Booking Fixture",
      "Worker Booking Fixture Cottage",
    ],
    [
      "booking-request",
      "mobile",
      "+9647570000000",
      "+9647520000000",
      "+9647592700000",
      "booking-request Mobile Booking Fixture",
      "booking-request Mobile Booking Fixture Cottage",
    ],
    [
      "booking-request",
      "desktop",
      "+9647570000001",
      "+9647520000001",
      "+9647592700001",
      "booking-request Desktop Booking Fixture",
      "booking-request Desktop Booking Fixture Cottage",
    ],
    [
      "booking-request",
      "worker",
      "+9647570000002",
      "+9647520000002",
      "+9647592700002",
      "booking-request Worker Booking Fixture",
      "booking-request Worker Booking Fixture Cottage",
    ],
    [
      "messaging",
      "mobile",
      "+9647580000000",
      "+9647560000000",
      "messaging Mobile Booking Fixture",
      "messaging Mobile Booking Fixture Cottage",
    ],
    [
      "messaging",
      "desktop",
      "+9647580000001",
      "+9647560000001",
      "messaging Desktop Booking Fixture",
      "messaging Desktop Booking Fixture Cottage",
    ],
    [
      "messaging",
      "worker",
      "+9647580000002",
      "+9647560000002",
      "messaging Worker Booking Fixture",
      "messaging Worker Booking Fixture Cottage",
    ],
    [
      "scheduled-expiry",
      "worker",
      "+9647592800002",
      "+9647592900002",
      "scheduled-expiry Worker Booking Fixture",
      "scheduled-expiry Worker Booking Fixture Cottage",
    ],
  ];
  const phones = [];
  const names = [];
  for (const [owner, project, ...expected] of ownership) {
    const fixture = fixtures.accessBrowserFixture(project, owner);
    const actual =
      owner === "access"
        ? [
            fixture.reviewOwnerPhone,
            fixture.bookingOwnerPhone,
            fixture.reviewLegalName,
            fixture.reviewCottageName,
            fixture.bookingLegalName,
            fixture.bookingCottageName,
          ]
        : [
            fixture.bookingOwnerPhone,
            fixture.customerPhone,
            ...(owner === "booking-request"
              ? [fixture.secondaryCustomerPhone]
              : []),
            fixture.bookingLegalName,
            fixture.bookingCottageName,
          ];
    assert.deepEqual(actual, expected, `${owner}/${project}`);
    assert.equal(fixture.exactAddress, "Synthetic private fixture address");
    phones.push(...actual.filter((value) => value.startsWith("+")));
    names.push(...actual.filter((value) => !value.startsWith("+")));
  }
  const otherOwnedPhones = [
    "+9647510000000",
    "+9647510000001",
    "+9647510000002",
    "+9647550000000",
    "+9647550000001",
    "+9647550000002",
    "+9647592500000",
    "+9647592500001",
    "+9647592500002",
    "+9647592600000",
    "+9647592600001",
    "+9647592600002",
    "+9647500000008",
    "+9647500000009",
  ];
  const journeyPhones = accessJourneyOtpEntries().map(([phone]) => `+${phone}`);
  const allPhones = [...phones, ...otherOwnedPhones, ...journeyPhones];
  assert.equal(new Set(allPhones).size, allPhones.length);
  assert.equal(new Set(names).size, names.length);
  const config = readFileSync("supabase/config.toml", "utf8");
  const otpSection = config.match(
    /\[auth\.sms\.test_otp\]\n([\s\S]*?)(?=\n\[|$)/,
  )?.[1];
  assert.ok(otpSection, "synthetic OTP section must exist");
  const passwordOnlyPhones = new Set([
    "+9647580000000",
    "+9647580000001",
    "+9647580000002",
    "+9647592800002",
    "+9647592900002",
  ]);
  for (const phone of [...phones, ...otherOwnedPhones]) {
    if (!passwordOnlyPhones.has(phone)) {
      assert.match(
        otpSection,
        new RegExp(`^${phone.slice(1)} = "123456"$`, "m"),
      );
    }
  }
  const historySource = readFileSync("tests/booking-history.spec.ts", "utf8");
  assert.match(historySource, /const customerPhone = "\+9647500000008"/);
  assert.match(historySource, /const ownerPhone = "\+9647500000009"/);
  const accessSource = readFileSync("tests/access.spec.ts", "utf8");
  for (const [project, phone] of [
    ["mobile", "+9647592600000"],
    ["desktop", "+9647592600001"],
    ["worker", "+9647592600002"],
  ]) {
    assert.ok(accessSource.includes(`${project}: "${phone}"`));
  }
  assert.match(
    accessSource,
    /const customerPhone = quoteCustomerPhone\(testInfo.project.name\)/,
  );
  for (const unknown of [
    "",
    "unknown",
    "../worker",
    "worker'; select 1;--",
    "__proto__",
    null,
    {},
  ]) {
    assert.throws(
      () => fixtures.accessBrowserFixture(unknown),
      /Unknown access browser fixture project/,
    );
    assert.throws(
      () => fixtures.accessBrowserFixture("worker", unknown),
      /Unknown access browser fixture owner/,
    );
    for (const prepare of [
      fixtures.createAccessBrowserFixtures,
      fixtures.validateAccessBrowserFixtures,
    ]) {
      await assert.rejects(
        prepare({ projects: ["worker", unknown] }),
        /Unknown access browser fixture project/,
      );
      await assert.rejects(
        prepare({ projects: ["worker"], owner: unknown }),
        /Unknown access browser fixture owner/,
      );
    }
  }
  for (const project of ["mobile", "desktop"]) {
    assert.throws(
      () => fixtures.accessBrowserFixture(project, "scheduled-expiry"),
      /require worker project/,
    );
  }
});

test("browser booking fixtures own disjoint graphs and cleanup", () => {
  // Literal reservations come from the approved ownership table, not the allocator.
  const ownership = [
    ["cancellation", "mobile", "810", "8101", "8102", "8103", "8108"],
    ["cancellation", "desktop", "811", "8111", "8112", "8113", "8118"],
    ["cancellation", "worker", "812", "8121", "8122", "8123", "8128"],
    ["completion", "mobile", "820", "8201", "8202", "8203", "8208"],
    ["completion", "desktop", "821", "8211", "8212", "8213", "8218"],
    ["completion", "worker", "822", "8221", "8222", "8223", "8228"],
    ["refund", "mobile", "830", "8301", "8302", "8303", "8308"],
    ["refund", "desktop", "831", "8311", "8312", "8313", "8318"],
    ["refund", "worker", "832", "8321", "8322", "8323", "8328"],
    ["request-notification", "mobile", "840", "8401", "8402", "8403", "8408"],
    ["request-notification", "desktop", "841", "8411", "8412", "8413", "8418"],
    ["request-notification", "worker", "842", "8421", "8422", "8423", "8428"],
    ["expiry", "mobile", "850", "8501", "8502", "8503", "8508"],
    ["expiry", "desktop", "851", "8511", "8512", "8513", "8518"],
    ["expiry", "worker", "852", "8521", "8522", "8523", "8528"],
    ["reminder", "mobile", "860", "8601", "8602", "8603", "8608"],
    ["reminder", "desktop", "861", "8611", "8612", "8613", "8618"],
    ["reminder", "worker", "862", "8621", "8622", "8623", "8628"],
    ["capture", "mobile", "870", "8701", "8702", "8703", "8708"],
    ["capture", "desktop", "871", "8711", "8712", "8713", "8718"],
    ["capture", "worker", "872", "8721", "8722", "8723", "8728"],
  ];
  const primaryPrefixes = {
    profile: "20000000",
    schedule: "30000000",
    snapshot: "40000000",
    commitment: "50000000",
    request: "60000000",
    attempt: "70000000",
    claim: "72000000",
    paymentLifecycle: "73000000",
    confirmation: "80000000",
    operation: "81000000",
  };
  const assertMessagingCleanup = (sql, request) => {
    assert.ok(
      sql.includes(
        `select conversation_id from public.booking_request_submission_attempts where booking_request_id='${request}' and conversation_id is not null`,
      ),
    );
    assert.ok(
      sql.includes(
        `select conversation_id from public.messaging_conversation_booking_requests where booking_request_id='${request}'`,
      ),
    );
    const statements = [
      "select array_agg(selected.conversation_id) into conversation_ids",
      "delete from public.messaging_translation_reports",
      "delete from public.messaging_translations",
      "delete from public.messaging_messages where conversation_id=any(conversation_ids)",
      "delete from public.messaging_send_attempts where conversation_id=any(conversation_ids)",
      "delete from public.messaging_conversation_booking_requests where conversation_id=any(conversation_ids)",
      `update public.booking_request_submission_attempts set conversation_id=null where booking_request_id='${request}'`,
      "delete from public.messaging_conversations where id=any(conversation_ids)",
      `delete from public.booking_requests where id='${request}'`,
    ];
    let previous = -1;
    for (const statement of statements) {
      const position = sql.indexOf(statement);
      assert.ok(
        position > previous,
        `Missing or out-of-order messaging cleanup: ${statement}`,
      );
      previous = position;
    }
  };
  const ids = [];
  const phones = [];
  const allocations = ownership.map(([file, project]) =>
    browserBookingFixtureIdentity(file, project),
  );
  for (const [
    file,
    project,
    stem,
    owner,
    customer,
    third,
    administrator,
  ] of ownership) {
    const actual = browserBookingFixtureIdentity(file, project);
    assert.equal(actual.stem, stem, `${file}/${project}`);
    assert.deepEqual(
      [actual.owner, actual.customer, actual.third, actual.administrator],
      [owner, customer, third, administrator].map(
        (row) => `10000000-0000-4000-8000-00000000${row}`,
      ),
    );
    assert.deepEqual(
      [actual.ownerPhone, actual.customerPhone, actual.thirdPhone],
      [owner, customer, third].map((row) => `+964750000${row}`),
    );
    assert.equal(actual.reference, `RC-REQ-000000000000${owner}`);
    for (const [key, prefix] of Object.entries(primaryPrefixes)) {
      assert.equal(actual[key], `${prefix}-0000-4000-8000-00000000${owner}`);
      ids.push(actual[key]);
    }
    ids.push(actual.owner, actual.customer, actual.third, actual.administrator);
    phones.push(actual.ownerPhone, actual.customerPhone, actual.thirdPhone);
    const cleanups = [
      confirmedBookingCleanup({
        stem,
        administrator: actual.administrator,
        completion: true,
        settlement: true,
        terminalRequest: true,
      }),
      confirmedBookingAccessCleanup({ stem, lifecycle: true }),
      captureCleanup({ stem, paymentRecovery: true, releaseOperations: true }),
      refundReset({ stem }),
    ];
    for (const sql of cleanups) {
      assert.ok(sql.includes(actual.request));
      for (const foreign of allocations.filter(
        (allocation) => allocation.stem !== stem,
      )) {
        for (const key of [
          "owner",
          "customer",
          "third",
          "administrator",
          "request",
          "snapshot",
          "claim",
          "commitment",
          "operation",
        ]) {
          assert.ok(
            !sql.includes(foreign[key]),
            `${file}/${project} cleanup contains foreign ${key}`,
          );
        }
      }
      assert.ok(!sql.includes("10000000-0000-4000-8000-000000003801"));
      assert.ok(!sql.includes("000000001001"));
      assert.ok(!sql.includes("000000003501"));
    }
    const confirmed = cleanups[0];
    assertMessagingCleanup(confirmed, actual.request);
    for (const user of [
      actual.owner,
      actual.customer,
      actual.third,
      actual.administrator,
    ])
      assert.ok(confirmed.includes(user));
    for (const key of [
      "owner",
      "customer",
      "third",
      "request",
      "snapshot",
      "commitment",
      "operation",
    ])
      assert.ok(cleanups[1].includes(actual[key]));
    if (file === "request-notification") {
      const fixture =
        notificationFixtures.browserBookingRequestNotificationFixture(project);
      assert.equal(fixture.request, actual.request);
      assert.equal(fixture.owner, actual.owner);
      assert.equal(fixture.customer, actual.customer);
      for (const key of [
        "owner",
        "customer",
        "third",
        "request",
        "snapshot",
        "commitment",
        "claim",
        "paymentLifecycle",
      ])
        assert.ok(fixture.baselineFixture.includes(actual[key]));
      assert.ok(fixture.baselineFixture.includes(actual.reference));
      for (const phone of [
        actual.ownerPhone,
        actual.customerPhone,
        actual.thirdPhone,
      ])
        assert.ok(fixture.baselineFixture.includes(phone));
      assert.ok(!fixture.baselineFixture.includes("000000001001"));
      assert.ok(
        !fixture.baselineFixture.includes("confirmation-auth-request-1"),
      );
      assert.ok(fixture.cleanup.includes(actual.administrator));
    }
  }
  // Retained review, history, payment and records reservations are independent of the new table.
  for (const namespace of [
    "61",
    "62",
    "63",
    "64",
    "65",
    "66",
    "67",
    "68",
    "69",
    "70",
    "71",
    "72",
    "73",
    "74",
    "75",
    "76",
    "77",
    "78",
  ]) {
    const reviewCleanup = customerReviewCleanup(namespace);
    assertMessagingCleanup(
      reviewCleanup,
      `60000000-0000-4000-8000-00000000${namespace}01`,
    );
    for (const otherNamespace of ["61", "64"].filter(
      (other) => other !== namespace,
    ))
      assert.ok(
        !reviewCleanup.includes(
          `60000000-0000-4000-8000-00000000${otherNamespace}01`,
        ),
      );
    for (const prefix of Object.values(primaryPrefixes))
      ids.push(`${prefix}-0000-4000-8000-00000000${namespace}01`);
    for (const row of ["01", "02", "03", "81", "82"])
      ids.push(`10000000-0000-4000-8000-00000000${namespace}${row}`);
    for (const row of ["01", "02", "03"])
      phones.push(`+964750000${namespace}${row}`);
  }
  for (const stem of ["350", "351", "137", "151"]) {
    for (const prefix of Object.values(primaryPrefixes))
      ids.push(`${prefix}-0000-4000-8000-00000000${stem}1`);
    for (const row of ["1", "2", "3"])
      ids.push(`10000000-0000-4000-8000-00000000${stem}${row}`);
  }
  ids.push("10000000-0000-4000-8000-000000003801");
  for (const suffix of ["000101", "000201", "000301", "000303"])
    ids.push(`25000000-0000-4000-8000-000000${suffix}`);
  phones.push(
    "+9647500000008",
    "+9647500000009",
    "+9647592500000",
    "+9647592500001",
    "+9647592500002",
  );
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(phones).size, phones.length);
  // SHA-256 of the existing capture recipe with the literal Worker expiry lifecycle 8521.
  assert.equal(
    browserBookingFixtureIdentity("expiry", "worker").captureFingerprint,
    "7e702db46040f3e72d7bada63d856d26057d2caf4036e2f8a692e370f178993e",
  );
  const defaultHashes = [
    [
      refundReset(),
      "6014e5e186059fc6eebf3967632a145f85aef2e994c89c10e719c1a56bcc8f95",
    ],
    [
      confirmedBookingCleanup(),
      "3a771fa17e67c0be2cb89656489e581ec69f5586d24acc9c60e3185e57e1bea0",
    ],
    [
      confirmedBookingAccessCleanup(),
      "d4930c3ad9970f8bd20c0805de09067c84a311973fd2e5cef11826c868c3fc46",
    ],
    [
      captureCleanup(),
      "3b0f473044c366067bcb1697c085559d11b569d7b1b2fee7b09f4fb801766757",
    ],
  ];
  for (const [sql, hash] of defaultHashes)
    assert.equal(createHash("sha256").update(sql).digest("hex"), hash);
  const notificationSource = readFileSync(
    "supabase/tests/database/booking_request_notification.test.sql",
    "utf8",
  );
  assert.equal(
    notificationFixtures.request,
    "60000000-0000-4000-8000-000000001001",
  );
  assert.equal(
    notificationFixtures.baselineFixture,
    notificationSource.slice(
      0,
      notificationSource.indexOf("create function pg_temp.notice_call"),
    ),
  );
  assert.equal(
    notificationFixtures.fixture,
    notificationSource.slice(
      0,
      notificationSource.indexOf("select no_plan();"),
    ),
  );
  assert.equal(
    notificationFixtures.cleanup,
    refundReset() + confirmedBookingCleanup({ terminalRequest: true }),
  );
  for (const [file, path] of [
    ["cancellation", "tests/booking-cancellation-refund.spec.ts"],
    ["completion", "tests/worker-scheduled-completion.spec.ts"],
    ["refund", "tests/worker-scheduled-refund.spec.ts"],
    ["capture", "tests/worker-scheduled-capture.spec.ts"],
    ["reminder", "tests/worker-scheduled-reminder.spec.ts"],
    ["expiry", "tests/fixtures/scheduled-expiry.ts"],
  ]) {
    const source = readFileSync(path, "utf8");
    assert.match(
      source,
      new RegExp(`browserBookingFixtureIdentity\\(\\s*"${file}"`),
    );
    assert.match(source, /testInfo\.project\.name/);
    assert.doesNotMatch(
      source,
      /[0-9a-f]{8}-0000-4000-8000-00000000(?:100[123]|350[123])/,
    );
    assert.match(source, /stem: identity\.stem/);
  }
  const reminderSource = readFileSync(
    "supabase/tests/database/booking_confirmation_access.test.sql",
    "utf8",
  );
  const reminderSeed = confirmedBookingAccessFixtureSource(reminderSource);
  assert.ok(reminderSeed.startsWith("set session_replication_role = replica;"));
  assert.ok(reminderSeed.endsWith("set session_replication_role = origin;"));
  for (const token of [
    "10000000-0000-4000-8000-000000003501",
    "10000000-0000-4000-8000-000000003502",
    "10000000-0000-4000-8000-000000003503",
    "20000000-0000-4000-8000-000000003501",
    "40000000-0000-4000-8000-000000003501",
    "50000000-0000-4000-8000-000000003501",
    "60000000-0000-4000-8000-000000003501",
    "73000000-0000-4000-8000-000000003501",
    "80000000-0000-4000-8000-000000003501",
    "82000000-0000-4000-8000-000000003502",
    "RC-REQ-0000000000003501",
    "CONFIRMED-BOOKING-35",
  ])
    assert.ok(
      reminderSeed.includes(token),
      `confirmed reminder graph must contain ${token}`,
    );
  assert.doesNotMatch(
    reminderSeed,
    /select\s+(?:plan|has_function|ok|is|throws_ok)\s*\(/i,
  );
  const reminderConsumer = readFileSync(
    "tests/worker-scheduled-reminder.spec.ts",
    "utf8",
  );
  assert.equal(
    [
      ...reminderConsumer.matchAll(
        /confirmedBookingAccessFixtureSource\(\s*source\s*\)/g,
      ),
    ].length,
    1,
  );
  assert.equal(
    [...reminderConsumer.matchAll(/reminderSeed\(identity\)/g)].length,
    2,
  );
  for (const corrupt of [
    "",
    reminderSource.replaceAll("set session_replication_role = replica;", ""),
    reminderSource.replaceAll("set session_replication_role = origin;", ""),
    "set session_replication_role = replica;\n \nset session_replication_role = origin;",
    reminderSource.replaceAll(
      "RC-REQ-0000000000003501",
      "missing-request-reference",
    ),
  ])
    assert.throws(
      () => confirmedBookingAccessFixtureSource(corrupt),
      /fixture source/,
    );
  const requestNotification = readFileSync(
    "tests/worker-scheduled-request-notification.spec.ts",
    "utf8",
  );
  assert.match(
    requestNotification,
    /browserBookingRequestNotificationFixture\(testInfo\.project\.name\)/,
  );
  const expiry = readFileSync("tests/worker-scheduled-expiry.spec.ts", "utf8");
  assert.match(expiry, /const requestId = identity\.request/);
  assert.doesNotMatch(expiry, /[0-9a-f]{8}-0000-4000-8000-00000000100[123]/);
  const restoration = readFileSync(
    "tests/fixtures/scheduled-expiry.ts",
    "utf8",
  );
  assert.match(restoration, /scheduledExpiry\.seeded,\s*identity/);
  for (const unknown of [
    "",
    "other",
    "../capture",
    "capture'; select 1;--",
    "__proto__",
    null,
    {},
  ]) {
    assert.throws(
      () => browserBookingFixtureIdentity(unknown, "worker"),
      /Unknown browser booking fixture file/,
    );
    assert.throws(
      () => browserBookingFixtureIdentity("capture", unknown),
      /Unknown browser booking fixture project/,
    );
    assert.throws(
      () =>
        notificationFixtures.browserBookingRequestNotificationFixture(unknown),
      /Unknown browser booking fixture project/,
    );
  }
  const marker = {
    start: "-- BEGIN FIXTURE",
    end: "-- END FIXTURE",
    required: ["owned-token"],
  };
  assert.equal(
    bookingFixtureSource(
      "-- BEGIN FIXTURE\nowned-token\n-- END FIXTURE",
      marker,
    ).trim(),
    "owned-token",
  );
  for (const corrupt of [
    "owned-token\n-- END FIXTURE",
    "-- BEGIN FIXTURE\nowned-token",
    "-- BEGIN FIXTURE\n-- BEGIN FIXTURE\nowned-token\n-- END FIXTURE",
    "-- BEGIN FIXTURE\nowned-token\n-- END FIXTURE\n-- END FIXTURE",
    "-- BEGIN FIXTURE\n  \n-- END FIXTURE",
    "-- END FIXTURE\nowned-token\n-- BEGIN FIXTURE",
    "-- BEGIN FIXTURE\nforeign-token\n-- END FIXTURE",
  ])
    assert.throws(
      () => bookingFixtureSource(corrupt, marker),
      /Booking fixture source/,
    );
  for (const corrupt of [
    "-- END FIXTURE",
    "-- BEGIN FIXTURE\n-- BEGIN FIXTURE\nowned-token\n-- END FIXTURE",
    "-- BEGIN FIXTURE\n \n-- END FIXTURE",
  ])
    assert.throws(
      () => bookingFixtureSource(corrupt, { end: marker.end }),
      /Booking fixture source/,
    );
  for (const [path, boundaries] of [
    [
      "supabase/tests/database/booking_cancellation.test.sql",
      { end: "-- END CANCELLATION FIXTURE" },
    ],
    [
      "supabase/tests/database/booking_completion.test.sql",
      {
        start: "-- BEGIN COMPLETION FIXTURE",
        end: "-- END COMPLETION FIXTURE",
      },
    ],
    [
      "supabase/tests/database/booking_request_confirmation.test.sql",
      {
        start: "-- BEGIN CAPTURE RECOVERY SOURCE",
        end: "-- END CAPTURE RECOVERY SOURCE",
      },
    ],
    [
      "supabase/tests/database/booking_request_payment_recovery.test.sql",
      { end: "select plan(" },
    ],
    [
      "supabase/tests/database/booking_request_notification.test.sql",
      { end: "create function pg_temp.notice_call" },
    ],
  ]) {
    const block = bookingFixtureSource(readFileSync(path, "utf8"), {
      ...boundaries,
      required: [
        "00000000100",
        "964750000100",
        "confirmation-auth-",
        "CONFIRMATION-HOLD-1",
        "Confirmation Cottage",
      ],
    });
    assert.ok(block.trim());
  }
});
