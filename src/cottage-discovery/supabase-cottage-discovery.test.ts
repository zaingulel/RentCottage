import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SupabaseCottageDiscovery } from "./supabase-cottage-discovery";

const query = {
  from: "2026-08-21",
  to: "2026-08-21",
  selections: [
    { serviceDay: "2026-08-21", kind: "shift" as const, position: 2 as const },
  ],
  guests: 4,
  amenities: ["pool"],
};
const publicSlug = "cottage-00000000000040008000000000000028";

const validSummary = {
  slug: publicSlug,
  name: "Quiet Garden",
  governorate: "Baghdad",
  approximateLocation: "Abu Ghraib",
  capacity: 6,
  amenities: ["pool", "wifi"],
  mediaIds: ["70000000-0000-4000-8000-000000000028"],
  totalPriceIqd: 175000,
  selectedInventory: [
    {
      serviceDay: "2026-08-21",
      kind: "shift",
      position: 2,
      name: "Evening",
      startTime: "18:00",
      endTime: "23:00",
      priceIqd: 175000,
      available: true,
    },
  ],
};

function clientReturning(data: unknown, error: unknown = null) {
  return {
    rpc: vi.fn().mockResolvedValue({ data, error }),
  } as unknown as SupabaseClient;
}

afterEach(() => vi.restoreAllMocks());

describe("Supabase Cottage discovery", () => {
  it("loads only exact live facet keys and a validated direct-profile default", async () => {
    const facetsClient = clientReturning({
      governorates: ["Baghdad"],
      areas: ["Abu Ghraib"],
      amenities: ["pool"],
    });
    await expect(
      new SupabaseCottageDiscovery(facetsClient).facets("ar"),
    ).resolves.toEqual({
      status: "loaded",
      governorates: ["Baghdad"],
      areas: ["Abu Ghraib"],
      amenities: ["pool"],
    });
    expect(facetsClient.rpc).toHaveBeenCalledWith("get_public_cottage_facets", {
      target_locale: "ar",
    });

    const defaultClient = clientReturning({
      from: "2099-08-21",
      to: "2099-08-21",
      selections: [
        { serviceDay: "2099-08-21", kind: "shift", position: 1 },
        { serviceDay: "2099-08-21", kind: "shift", position: 2 },
      ],
      guests: 1,
      amenities: [],
    });
    await expect(
      new SupabaseCottageDiscovery(defaultClient).defaultQuery("cottage-quiet"),
    ).resolves.toEqual({
      status: "loaded",
      query: {
        from: "2099-08-21",
        to: "2099-08-21",
        selections: [
          { serviceDay: "2099-08-21", kind: "shift", position: 1 },
          { serviceDay: "2099-08-21", kind: "shift", position: 2 },
        ],
        guests: 1,
        amenities: [],
      },
    });
  });

  it("maps a validated search to the safe public RPC and rejects extra response keys", async () => {
    const client = clientReturning([validSummary]);
    const discovery = new SupabaseCottageDiscovery(client);

    await expect(discovery.search("en", query)).resolves.toEqual({
      status: "loaded",
      cottages: [
        expect.objectContaining({
          slug: publicSlug,
          totalPriceIqd: 175000,
          mediaUrls: [
            "/api/cottage-media/70000000-0000-4000-8000-000000000028",
          ],
        }),
      ],
    });
    expect(client.rpc).toHaveBeenCalledWith("search_public_cottages", {
      target_locale: "en",
      requested_search: query,
    });

    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
    const unsafe = new SupabaseCottageDiscovery(
      clientReturning([
        { ...(await client.rpc("ignored")).data[0], exactAddress: "private" },
      ]),
    );
    await expect(unsafe.search("en", query)).resolves.toEqual({
      status: "unavailable",
    });
    expect(diagnostic).toHaveBeenCalledWith(
      "Public Cottage discovery unavailable",
      { operation: "search", result: "invalid-provider-data" },
    );
  });

  it("independently rejects unknown amenities and empty selected inventory at the database boundary", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      new SupabaseCottageDiscovery(
        clientReturning([
          { ...validSummary, amenities: ["private_pool_note"] },
        ]),
      ).search("en", query),
    ).resolves.toEqual({ status: "unavailable" });
    await expect(
      new SupabaseCottageDiscovery(
        clientReturning([{ ...validSummary, selectedInventory: [] }]),
      ).search("en", query),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("rejects invalid dates, slugs and room counts from provider data", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      new SupabaseCottageDiscovery(
        clientReturning([
          {
            ...validSummary,
            selectedInventory: [
              {
                ...validSummary.selectedInventory[0],
                serviceDay: "2026-02-31",
              },
            ],
          },
        ]),
      ).search("en", query),
    ).resolves.toEqual({ status: "unavailable" });
    await expect(
      new SupabaseCottageDiscovery(
        clientReturning({
          from: "2099-02-31",
          to: "2099-02-31",
          selections: [
            {
              serviceDay: "2099-02-31",
              kind: "shift",
              position: 1,
            },
          ],
          guests: 1,
          amenities: [],
        }),
      ).defaultQuery(publicSlug),
    ).resolves.toEqual({ status: "unavailable" });
    await expect(
      new SupabaseCottageDiscovery(
        clientReturning([{ ...validSummary, slug: "../administrator" }]),
      ).search("en", query),
    ).resolves.toEqual({ status: "unavailable" });

    const profile = {
      ...validSummary,
      bedrooms: -1,
      bathrooms: 1,
      description: "Approved",
      houseRules: "No smoking",
    };
    await expect(
      new SupabaseCottageDiscovery(clientReturning(profile)).profile(
        "en",
        publicSlug,
        query,
      ),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("binds returned inventory identities and totals to the requested Booking Period", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const multiQuery = {
      ...query,
      selections: [
        {
          serviceDay: query.from,
          kind: "shift" as const,
          position: 1 as const,
        },
        {
          serviceDay: query.from,
          kind: "shift" as const,
          position: 2 as const,
        },
      ],
    };
    const firstInventory = {
      ...validSummary.selectedInventory[0],
      position: 1,
      name: "Morning",
    };
    const completeSummary = {
      ...validSummary,
      selectedInventory: [firstInventory, validSummary.selectedInventory[0]],
      totalPriceIqd: 350000,
    };
    await expect(
      new SupabaseCottageDiscovery(
        clientReturning([
          { ...completeSummary, selectedInventory: [firstInventory] },
        ]),
      ).search("en", multiQuery),
    ).resolves.toEqual({ status: "unavailable" });
    await expect(
      new SupabaseCottageDiscovery(
        clientReturning([
          {
            ...completeSummary,
            selectedInventory: [
              firstInventory,
              { ...validSummary.selectedInventory[0], position: 3 },
            ],
          },
        ]),
      ).search("en", multiQuery),
    ).resolves.toEqual({ status: "unavailable" });
    await expect(
      new SupabaseCottageDiscovery(
        clientReturning([{ ...completeSummary, totalPriceIqd: 1 }]),
      ).search("en", multiQuery),
    ).resolves.toEqual({ status: "unavailable" });

    const inconsistentProfile = {
      ...completeSummary,
      bedrooms: 2,
      bathrooms: 1,
      description: "Approved",
      houseRules: "No smoking",
      totalPriceIqd: 1,
    };
    await expect(
      new SupabaseCottageDiscovery(
        clientReturning(inconsistentProfile),
      ).profile("en", publicSlug, multiQuery),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("distinguishes unavailable and not-found Cottage Profiles", async () => {
    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      new SupabaseCottageDiscovery(clientReturning(null)).profile(
        "en",
        "missing",
        query,
      ),
    ).resolves.toEqual({ status: "not-found" });

    await expect(
      new SupabaseCottageDiscovery(
        clientReturning(null, { message: "offline" }),
      ).profile("en", "quiet-garden", query),
    ).resolves.toEqual({ status: "unavailable" });
    expect(diagnostic).toHaveBeenCalledWith(
      "Public Cottage discovery unavailable",
      { operation: "profile", result: "provider-error" },
    );
  });

  it("keeps an eligible closed Cottage Profile visible without inventing price or availability", async () => {
    const data = {
      slug: publicSlug,
      name: "Quiet Garden",
      governorate: "Baghdad",
      approximateLocation: "Abu Ghraib",
      capacity: 6,
      bedrooms: 2,
      bathrooms: 1,
      amenities: ["pool"],
      description: "Approved",
      houseRules: "No smoking",
      mediaIds: [],
      totalPriceIqd: null,
      selectedInventory: [
        {
          serviceDay: "2099-08-21",
          kind: "shift",
          position: 1,
          name: "Morning",
          startTime: "08:00",
          endTime: "14:00",
          priceIqd: null,
          available: false,
        },
      ],
    };
    const closedQuery = {
      ...query,
      from: "2099-08-21",
      to: "2099-08-21",
      selections: [
        {
          serviceDay: "2099-08-21",
          kind: "shift" as const,
          position: 1 as const,
        },
      ],
    };
    await expect(
      new SupabaseCottageDiscovery(clientReturning(data)).profile(
        "en",
        publicSlug,
        closedQuery,
      ),
    ).resolves.toEqual({
      status: "loaded",
      cottage: expect.objectContaining({
        slug: publicSlug,
        totalPriceIqd: null,
        selectedInventory: [
          expect.objectContaining({ available: false, priceIqd: null }),
        ],
      }),
    });
  });
});
