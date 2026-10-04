import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

import * as fixtures from "./access-browser-fixtures.mjs";

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
