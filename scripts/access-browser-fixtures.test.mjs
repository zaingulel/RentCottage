import { afterEach, describe, expect, it, vi } from "vitest";

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));

vi.mock("@supabase/supabase-js", () => ({ createClient }));

import {
  accessBrowserFixture,
  ACCESS_REVIEW_DOCUMENT_FILENAME,
  createAccessBrowserFixtures,
  validateAccessBrowserFixtures,
} from "./lib/access-browser-fixtures.mjs";

const profileId = "70000000-0000-4000-8000-000000000001";
const publicationId = "71000000-0000-4000-8000-000000000001";
const scheduleId = "72000000-0000-4000-8000-000000000001";
const firstShiftId = "73000000-0000-4000-8000-000000000001";
const secondShiftId = "73000000-0000-4000-8000-000000000002";
const fullDayBundleId = "74000000-0000-4000-8000-000000000001";

const fixture = accessBrowserFixture("worker");
const reviewIdentity = { id: "review-owner", phone: fixture.reviewOwnerPhone };
const bookingIdentity = {
  id: "booking-owner",
  phone: fixture.bookingOwnerPhone,
};
const fixtureUsers = [reviewIdentity, bookingIdentity];
const shifts = [
  { id: firstShiftId, position: 1 },
  { id: secondShiftId, position: 2 },
];
const schedule = { id: scheduleId, full_day_bundle_id: fullDayBundleId };

const expectedPricing = [
  {
    unitId: firstShiftId,
    unitKind: "shift",
    standardPriceIqd: 180000,
  },
  {
    unitId: secondShiftId,
    unitKind: "shift",
    standardPriceIqd: 190000,
  },
  {
    unitId: fullDayBundleId,
    unitKind: "full_day_bundle",
    standardPriceIqd: 250000,
  },
];

function query(data, error = null) {
  const result = { data, error };
  const builder = {
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => result),
    order: vi.fn(() => builder),
    select: vi.fn(() => builder),
    single: vi.fn(async () => result),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

function privilegedClient() {
  return {
    auth: {
      admin: {
        listUsers: vi.fn(async () => ({
          data: { users: fixtureUsers },
          error: null,
        })),
        updateUserById: vi.fn(async () => ({ error: null })),
      },
    },
    storage: {
      from: vi.fn(() => ({
        download: vi.fn(async () => ({
          data: new Blob(["%PDF-1.7\nfixture\n%%EOF"]),
          error: null,
        })),
      })),
    },
  };
}

function reviewOwnerClient({ validate = false } = {}) {
  return {
    auth: {
      signInWithPassword: vi.fn(async () => ({
        data: { user: reviewIdentity },
        error: null,
      })),
    },
    from: vi.fn((table) => {
      if (table === "owner_applications") {
        return query({
          id: "review-application",
          status: "submitted",
          ...(validate ? { legal_name: fixture.reviewLegalName } : {}),
        });
      }
      if (table === "owner_verification_documents") {
        return query([
          {
            kind: "identity",
            object_path: "review/identity.pdf",
            original_filename: ACCESS_REVIEW_DOCUMENT_FILENAME,
          },
          {
            kind: "authority_to_rent",
            object_path: "review/authority.pdf",
            original_filename: "authority.pdf",
          },
          {
            kind: "licensing_or_exemption",
            object_path: "review/licence.pdf",
            original_filename: "licence.pdf",
          },
          {
            kind: "payout_account",
            object_path: "review/payout.pdf",
            original_filename: "payout.pdf",
          },
        ]);
      }
      throw new Error(`Unexpected review-owner table: ${table}`);
    }),
  };
}

function bookingOwnerClient(pricingUnits) {
  const rpc = vi.fn(async (name) => {
    if (name === "get_current_cottage_publication") {
      return {
        data: [
          {
            publication_id: publicationId,
            name: fixture.bookingCottageName,
          },
        ],
        error: null,
      };
    }
    if (name === "load_cottage_inventory_owner_editor_state") {
      return {
        data: {
          profileId,
          scheduleRevisionId: scheduleId,
          units: pricingUnits,
        },
        error: null,
      };
    }
    if (name === "save_cottage_inventory_pricing") {
      return {
        data: { profileId, scheduleRevisionId: scheduleId },
        error: null,
      };
    }
    throw new Error(`Unexpected booking-owner RPC: ${name}`);
  });
  return {
    auth: {
      signInWithPassword: vi.fn(async () => ({
        data: { user: bookingIdentity },
        error: null,
      })),
    },
    from: vi.fn((table) => {
      if (table === "owner_applications") {
        return query({ id: "booking-application", status: "approved" });
      }
      if (table === "owner_application_cottage_profiles") {
        return query({
          id: profileId,
          name: fixture.bookingCottageName,
          current_publication_id: publicationId,
          current_shift_schedule_id: scheduleId,
        });
      }
      if (table === "cottage_shift_schedule_revisions") {
        return query(schedule);
      }
      if (table === "cottage_shifts") return query(shifts);
      throw new Error(`Unexpected booking-owner table: ${table}`);
    }),
    rpc,
  };
}

function loadedPricing(overrides = false) {
  return expectedPricing.map((unit) => ({
    id: unit.unitId,
    kind: unit.unitKind,
    standardPriceIqd: unit.standardPriceIqd,
    weekdayOverrides: [],
    dateOverrides: [],
    ...(overrides
      ? {
          weekdayOverrides: [{ weekday: 5, priceIqd: 999000 }],
          dateOverrides: [{ serviceDay: "2099-01-01", priceIqd: 998000 }],
        }
      : {}),
  }));
}

describe("access browser fixtures", () => {
  afterEach(() => createClient.mockReset());

  it("repairs incomplete published-fixture pricing with only the three deterministic standards", async () => {
    const privileged = privilegedClient();
    const incompletePricing = loadedPricing();
    incompletePricing[0] = {
      ...incompletePricing[0],
      standardPriceIqd: null,
      weekdayOverrides: [{ weekday: 1, priceIqd: 181000 }],
      dateOverrides: [{ serviceDay: "2099-01-02", priceIqd: 182000 }],
    };
    incompletePricing[1] = {
      ...incompletePricing[1],
      weekdayOverrides: [{ weekday: 2, priceIqd: 191000 }],
      dateOverrides: [{ serviceDay: "2099-01-03", priceIqd: 192000 }],
    };
    const bookingOwner = bookingOwnerClient(incompletePricing);
    createClient
      .mockReturnValueOnce(reviewOwnerClient())
      .mockReturnValueOnce(bookingOwner);

    await createAccessBrowserFixtures({
      projects: ["worker"],
      privilegedClient: privileged,
      publishableKey: "publishable",
      reviewerClient: {},
      url: "http://127.0.0.1:54321",
    });

    expect(bookingOwner.rpc).toHaveBeenCalledWith(
      "save_cottage_inventory_pricing",
      {
        target_profile_id: profileId,
        target_schedule_revision_id: scheduleId,
        requested_prices: {
          units: expectedPricing.map((unit, index) => ({
            ...unit,
            weekdayOverrides: incompletePricing[index].weekdayOverrides,
            dateOverrides: incompletePricing[index].dateOverrides,
          })),
        },
      },
    );
    expect(
      bookingOwner.rpc.mock.calls.some(([name]) =>
        name.includes("availability"),
      ),
    ).toBe(false);
  });

  it("refuses to repair pricing when the loaded replacement state omits overrides", async () => {
    const privileged = privilegedClient();
    const incompletePricing = loadedPricing();
    incompletePricing[0] = {
      id: firstShiftId,
      kind: "shift",
      standardPriceIqd: null,
      dateOverrides: [],
    };
    const bookingOwner = bookingOwnerClient(incompletePricing);
    createClient
      .mockReturnValueOnce(reviewOwnerClient())
      .mockReturnValueOnce(bookingOwner);

    await expect(
      createAccessBrowserFixtures({
        projects: ["worker"],
        privilegedClient: privileged,
        publishableKey: "publishable",
        reviewerClient: {},
        url: "http://127.0.0.1:54321",
      }),
    ).rejects.toThrow(
      "worker access booking fixture pricing is incomplete: missing complete override state",
    );
    expect(bookingOwner.rpc).not.toHaveBeenCalledWith(
      "save_cottage_inventory_pricing",
      expect.anything(),
    );
  });

  it("preserves existing overrides when all three standard prices are exact", async () => {
    const privileged = privilegedClient();
    const bookingOwner = bookingOwnerClient(loadedPricing(true));
    createClient
      .mockReturnValueOnce(reviewOwnerClient())
      .mockReturnValueOnce(bookingOwner);

    await createAccessBrowserFixtures({
      projects: ["worker"],
      privilegedClient: privileged,
      publishableKey: "publishable",
      reviewerClient: {},
      url: "http://127.0.0.1:54321",
    });

    expect(bookingOwner.rpc).not.toHaveBeenCalledWith(
      "save_cottage_inventory_pricing",
      expect.anything(),
    );
  });

  it("validates exact standard-price units while ignoring pricing overrides", async () => {
    const privileged = privilegedClient();
    createClient
      .mockReturnValueOnce(reviewOwnerClient({ validate: true }))
      .mockReturnValueOnce(bookingOwnerClient(loadedPricing(true)));

    await expect(
      validateAccessBrowserFixtures({
        projects: ["worker"],
        privilegedClient: privileged,
        publishableKey: "publishable",
        url: "http://127.0.0.1:54321",
      }),
    ).resolves.toBeUndefined();
  });

  it("names missing deterministic standard pricing during validation", async () => {
    const privileged = privilegedClient();
    createClient
      .mockReturnValueOnce(reviewOwnerClient({ validate: true }))
      .mockReturnValueOnce(bookingOwnerClient(loadedPricing().slice(1)));

    await expect(
      validateAccessBrowserFixtures({
        projects: ["worker"],
        privilegedClient: privileged,
        publishableKey: "publishable",
        url: "http://127.0.0.1:54321",
      }),
    ).rejects.toThrow(
      "worker access booking fixture is incomplete: expected deterministic standard pricing",
    );
  });
});
