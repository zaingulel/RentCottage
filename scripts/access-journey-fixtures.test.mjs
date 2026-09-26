import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import * as fixtures from "./lib/access-journey-fixtures.mjs";

const signinTitle =
  "shared sign-in from the homepage returns a prospective owner to their private application";
const ownerSubmitTitle =
  "a Cottage Owner saves, resumes and submits a complete private application";
const ownerLayoutTitle =
  "Owner Application keeps evidence controls aligned and accessible in every locale";
const sharedAccountTitle =
  "one account returns to customer bookings, enrolls explicitly and signs out only this device";
const inventory = [
  { id: 1, journey: "signin", title: signinTitle, recipe: "draft" },
  {
    id: 2,
    journey: "owner-submit",
    title: ownerSubmitTitle,
    recipe: "new-account",
  },
  {
    id: 3,
    journey: "owner-layout",
    title: ownerLayoutTitle,
    recipe: "new-account",
  },
  {
    id: 9,
    journey: "shared-account",
    title: sharedAccountTitle,
    recipe: "new-account",
  },
];
const allocation = (overrides = {}) => ({
  journey: "signin",
  project: "worker",
  retry: 0,
  repeatEachIndex: 0,
  phase: "ordinary",
  ...overrides,
});

it("access journey identities isolate all four owned attempts", () => {
  expect(fixtures.accessJourneyCases).toEqual(
    inventory.map((row) => ({
      ...row,
      file: "tests/access.spec.ts",
      projects: ["mobile", "desktop", "worker"],
    })),
  );
  const phones = [];
  for (const row of inventory) {
    for (const project of ["mobile", "desktop", "worker"]) {
      for (const retry of [0, 1, 2]) {
        for (const repeatEachIndex of [0, 1]) {
          for (const phase of [
            "ordinary",
            "forward",
            "reverse",
            "retry-proof",
            "boundary",
          ]) {
            const coordinates = {
              journey: row.journey,
              project,
              retry,
              repeatEachIndex,
              phase,
            };
            const identity = fixtures.accessJourneyIdentity(coordinates);
            expect(identity.allocation).toEqual(coordinates);
            expect(identity.fixtureCase.recipe).toBe(row.recipe);
            expect(identity.phone).toMatch(/^\+9647\d{9}$/);
            expect(identity.draft).toEqual({
              applicantKind: "individual",
              legalName: "Access Journey Draft Owner",
              companyName: "",
              licensingBasis: "licence",
              exemptionBasis: "",
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
            });
            phones.push(identity.phone.slice(1));
          }
        }
      }
    }
  }
  expect(phones).toHaveLength(360);
  expect(new Set(phones).size).toBe(360);
  const entries = fixtures.accessJourneyOtpEntries();
  expect(entries).toHaveLength(360);
  expect(entries.every(([, code]) => code === "123456")).toBe(true);
  expect(entries.map(([phone]) => phone).sort()).toEqual(phones.sort());
  const config = readFileSync("supabase/config.toml", "utf8");
  const legacyPhones = [...config.matchAll(/^(\d+)\s*=\s*"\d+"/gm)].map(
    (match) => match[1],
  );
  expect(legacyPhones.length).toBeGreaterThan(0);
  expect(phones.filter((phone) => legacyPhones.includes(phone))).toEqual([]);
  const extended = fixtures.addAccessJourneyTestOtps(config);
  for (const [phone, code] of entries)
    expect(extended).toContain(`${phone} = "${code}"`);
  for (const phone of legacyPhones) expect(extended).toContain(`${phone} = `);
});

const userId = "11111111-1111-4111-8111-111111111111";
const applicationId = "22222222-2222-4222-8222-222222222222";
const profileId = "33333333-3333-4333-8333-333333333333";
const otherId = "44444444-4444-4444-8444-444444444444";
function preparation() {
  const phone = fixtures.accessJourneyIdentity(allocation()).phone;
  const results = {
    create: { data: { user: { id: userId, phone } }, error: null },
    signin: { data: { user: { id: userId } }, error: null },
    claim: {
      data: {
        user_id: userId,
        role: "cottage_owner",
        owner_approval_state: "prospective",
      },
      error: null,
    },
    save: { data: null, error: null },
    application: {
      data: {
        id: applicationId,
        owner_user_id: userId,
        status: "draft",
        current_verification_record_id: null,
      },
      error: null,
    },
    profile: {
      data: {
        id: profileId,
        application_id: applicationId,
        owner_user_id: userId,
        status: "draft",
        current_publication_id: null,
        submitted_source_revision_id: null,
        current_shift_schedule_id: null,
      },
      error: null,
    },
  };
  const createUser = vi.fn(async () => results.create);
  const listUsers = vi
    .fn()
    .mockResolvedValue({ data: { users: [] }, error: null });
  const ownerClient = {
    auth: { signInWithPassword: vi.fn(async () => results.signin) },
    rpc: vi.fn(
      async (name) =>
        results[name === "claim_marketplace_role" ? "claim" : "save"],
    ),
    from: vi.fn((table) => ({
      select: () => ({
        eq: () => ({
          single: async () =>
            results[table === "owner_applications" ? "application" : "profile"],
        }),
      }),
    })),
  };
  const options = {
    allocation: allocation(),
    createSupabaseClient: vi.fn(() => ownerClient),
    environment: {
      APP_ENVIRONMENT: "test",
      SUPABASE_LOCAL_PROJECT: "rentcottage-verification-353",
      SUPABASE_LOCAL_WORKDIR: "/private/tmp/access-journey-admission",
      SUPABASE_URL: "http://127.0.0.1:55331",
    },
    guardDatabase: vi.fn(),
    privilegedClient: { auth: { admin: { createUser, listUsers } } },
    publishableKey: "local-publishable",
    selectedTitle: signinTitle,
    url: "http://127.0.0.1:55331",
  };
  return { options, results, createUser, listUsers, ownerClient };
}

describe("access journey fixture admission", () => {
  it.each([
    null,
    [],
    "invalid",
    {},
    allocation({ unexpected: true }),
    allocation({ journey: "unknown" }),
    allocation({ project: "tablet" }),
    allocation({ phase: "unknown" }),
    allocation({ phase: undefined }),
    allocation({ order: "ordinary" }),
    allocation({ retry: -1 }),
    allocation({ retry: 3 }),
    allocation({ retry: 0.5 }),
    allocation({ retry: "0" }),
    allocation({ repeatEachIndex: -1 }),
    allocation({ repeatEachIndex: 2 }),
    allocation({ repeatEachIndex: 0.5 }),
    ...["journey", "project", "retry", "repeatEachIndex", "phase"].map(
      (key) => {
        const coordinates = allocation();
        delete coordinates[key];
        return coordinates;
      },
    ),
  ])(
    "rejects illegal coordinates before external work: %j",
    async (coordinates) => {
      const { options, listUsers, createUser } = preparation();
      await expect(
        fixtures.prepareAccessJourney({ ...options, allocation: coordinates }),
      ).rejects.toThrow();
      expect(options.guardDatabase).not.toHaveBeenCalled();
      expect(listUsers).not.toHaveBeenCalled();
      expect(createUser).not.toHaveBeenCalled();
    },
  );
  it("rejects title mismatch before external work", async () => {
    const { options, listUsers } = preparation();
    await expect(
      fixtures.prepareAccessJourney({
        ...options,
        selectedTitle: sharedAccountTitle,
      }),
    ).rejects.toThrow("Selected access journey title does not match signin");
    expect(options.guardDatabase).not.toHaveBeenCalled();
    expect(listUsers).not.toHaveBeenCalled();
  });
  it.each([
    { APP_ENVIRONMENT: "production" },
    { SUPABASE_URL: "http://127.0.0.1:54331" },
    { SUPABASE_LOCAL_PROJECT: "demo_project" },
    { SUPABASE_LOCAL_WORKDIR: "" },
  ])("rejects non-disposable environment: %j", async (overrides) => {
    const { options, listUsers } = preparation();
    await expect(
      fixtures.prepareAccessJourney({
        ...options,
        environment: { ...options.environment, ...overrides },
      }),
    ).rejects.toThrow();
    expect(options.guardDatabase).not.toHaveBeenCalled();
    expect(listUsers).not.toHaveBeenCalled();
  });
  it.each(["invalid", "https://127.0.0.1:55331", "http://example.com:55331"])(
    "rejects unsafe URL %s",
    async (url) => {
      const { options, listUsers } = preparation();
      await expect(
        fixtures.prepareAccessJourney({
          ...options,
          url,
          environment: { ...options.environment, SUPABASE_URL: url },
        }),
      ).rejects.toThrow();
      expect(options.guardDatabase).not.toHaveBeenCalled();
      expect(listUsers).not.toHaveBeenCalled();
    },
  );
  it("rejects lost database ownership before privileged activity", async () => {
    const { options, listUsers } = preparation();
    options.guardDatabase.mockImplementation(() => {
      throw new Error("Database ownership lost");
    });
    await expect(fixtures.prepareAccessJourney(options)).rejects.toThrow(
      "Database ownership lost",
    );
    expect(listUsers).not.toHaveBeenCalled();
  });
  it("rejects an existing phone on a later Auth page without mutation", async () => {
    const { options, listUsers, createUser } = preparation();
    listUsers
      .mockResolvedValueOnce({
        data: {
          users: Array.from({ length: 1000 }, () => ({
            phone: "9647000000000",
          })),
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          users: [
            {
              id: otherId,
              phone: fixtures
                .accessJourneyIdentity(allocation())
                .phone.slice(1),
            },
          ],
        },
        error: null,
      });
    await expect(fixtures.prepareAccessJourney(options)).rejects.toThrow(
      "Allocated access journey identity already exists",
    );
    expect(listUsers).toHaveBeenNthCalledWith(2, { page: 2, perPage: 1000 });
    expect(createUser).not.toHaveBeenCalled();
  });
  it.each([
    { data: { users: null }, error: null },
    { data: null, error: null },
    { data: { users: [] }, error: new Error("Auth listing unavailable") },
  ])(
    "does not treat failed Auth enumeration as absence: %j",
    async (result) => {
      const { options, listUsers, createUser } = preparation();
      listUsers.mockResolvedValue(result);
      await expect(fixtures.prepareAccessJourney(options)).rejects.toThrow(
        "Discard the failed disposable run",
      );
      expect(createUser).not.toHaveBeenCalled();
    },
  );
  it.each(inventory.filter((row) => row.recipe === "new-account"))(
    "reserves $journey without creating state",
    async (row) => {
      const { options, createUser } = preparation();
      const coordinates = allocation({ journey: row.journey });
      const fixture = await fixtures.prepareAccessJourney({
        ...options,
        allocation: coordinates,
        selectedTitle: row.title,
      });
      expect(fixture).toEqual(fixtures.accessJourneyIdentity(coordinates));
      expect(createUser).not.toHaveBeenCalled();
      expect(options.createSupabaseClient).not.toHaveBeenCalled();
    },
  );
  it("returns acknowledged draft identifiers without a disk ledger", async () => {
    const { options, ownerClient, createUser } = preparation();
    const fixture = await fixtures.prepareAccessJourney(options);
    expect(fixture).toEqual({
      ...fixtures.accessJourneyIdentity(allocation()),
      userId,
      applicationId,
      profileId,
      ownerClient,
    });
    expect(createUser).toHaveBeenCalledOnce();
    expect(ownerClient.rpc).toHaveBeenCalledWith(
      "save_owner_application",
      expect.objectContaining({
        requested_legal_name: "Access Journey Draft Owner",
        requested_exact_address: "Synthetic private access journey address",
      }),
    );
  });
  it.each(["create", "signin", "claim", "save", "application", "profile"])(
    "rejects failed and malformed %s acknowledgements",
    async (stage) => {
      for (const result of [
        null,
        {},
        { data: null },
        { data: null, error: new Error("Provider unavailable") },
      ]) {
        const { options, results } = preparation();
        results[stage] = result;
        await expect(fixtures.prepareAccessJourney(options)).rejects.toThrow(
          /signin\/worker\/ordinary\/retry 0 preparation failed:.*Discard the failed disposable run/,
        );
      }
    },
  );
  it.each([
    ["create", "user", null],
    ["create", "user", { id: "invalid", phone: "9647000000000" }],
    ["create", "user", { id: userId, phone: "9647000000000" }],
    ["signin", "user", null],
    ["signin", "user", { id: otherId }],
    ["claim", "user_id", otherId],
    ["claim", "role", "customer"],
    ["claim", "owner_approval_state", "approved"],
    ["application", "id", "invalid"],
    ["application", "owner_user_id", otherId],
    ["application", "status", "submitted"],
    ["application", "current_verification_record_id", otherId],
    ["profile", "id", "invalid"],
    ["profile", "application_id", otherId],
    ["profile", "owner_user_id", otherId],
    ["profile", "status", "submitted"],
    ["profile", "current_publication_id", otherId],
    ["profile", "submitted_source_revision_id", otherId],
    ["profile", "current_shift_schedule_id", otherId],
  ])("rejects incorrect %s %s facts", async (stage, field, value) => {
    const { options, results } = preparation();
    results[stage].data[field] = value;
    await expect(fixtures.prepareAccessJourney(options)).rejects.toThrow(
      "Discard the failed disposable run",
    );
  });
  it("rejects missing, duplicate and conflicting OTP config sections", () => {
    expect(() => fixtures.addAccessJourneyTestOtps("[auth.sms]\n")).toThrow(
      "exactly one",
    );
    expect(() =>
      fixtures.addAccessJourneyTestOtps(
        "[auth.sms.test_otp]\n[auth.sms.test_otp]\n",
      ),
    ).toThrow("exactly one");
    const [phone] = fixtures.accessJourneyOtpEntries()[0];
    expect(() =>
      fixtures.addAccessJourneyTestOtps(
        `[auth.sms.test_otp]\n${phone} = "123456"\n`,
      ),
    ).toThrow("conflicts");
  });
});
