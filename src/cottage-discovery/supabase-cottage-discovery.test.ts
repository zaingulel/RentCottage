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
  inventory: [
    {
      serviceDay: "2026-08-21",
      kind: "shift",
      position: 1,
      name: "Morning",
      startTime: "08:00",
      endTime: "14:00",
      priceIqd: 60000,
      available: true,
    },
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
    {
      serviceDay: "2026-08-21",
      kind: "full-day",
      name: "Full-day bundle",
      startTime: "08:00",
      endTime: "23:00",
      priceIqd: 200000,
      available: true,
    },
  ],
};

function clientReturning(data: unknown, error: unknown = null) {
  return {
    rpc: vi.fn().mockResolvedValue({ data, error }),
  } as unknown as SupabaseClient;
}

function pageOf(items: unknown[], nextCursor: string | null = null) {
  return { items, nextCursor };
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
    const client = clientReturning(pageOf([validSummary]));
    const discovery = new SupabaseCottageDiscovery(client);

    await expect(discovery.search("en", query, null)).resolves.toEqual({
      status: "loaded",
      cottages: [
        expect.objectContaining({
          slug: publicSlug,
          inventory: validSummary.inventory,
          mediaUrls: [
            "/api/cottage-media/70000000-0000-4000-8000-000000000028",
          ],
        }),
      ],
      nextAfter: null,
    });
    expect(client.rpc).toHaveBeenCalledWith("search_public_cottages", {
      target_locale: "en",
      requested_search: query,
      target_after_slug: null,
      target_limit: 12,
    });

    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
    const unsafe = new SupabaseCottageDiscovery(
      clientReturning(pageOf([{ ...validSummary, exactAddress: "private" }])),
    );
    await expect(unsafe.search("en", query, null)).resolves.toEqual({
      status: "unavailable",
    });
    expect(diagnostic).toHaveBeenCalledWith(
      "Public Cottage discovery unavailable",
      { operation: "search", result: "invalid-provider-data" },
    );
  });

  it("requests one page after the given cottage and reports the next continuation", async () => {
    const slugAt = (number: number) =>
      `cottage-${number.toString(16).padStart(32, "0")}`;
    const fullPage = Array.from({ length: 12 }, (_, index) => ({
      ...validSummary,
      slug: slugAt(index + 2),
    }));
    const client = clientReturning(pageOf(fullPage, slugAt(13)));

    await expect(
      new SupabaseCottageDiscovery(client).search("ar", query, slugAt(1)),
    ).resolves.toEqual({
      status: "loaded",
      cottages: fullPage.map((cottage) =>
        expect.objectContaining({ slug: cottage.slug }),
      ),
      nextAfter: slugAt(13),
    });
    expect(client.rpc).toHaveBeenCalledWith("search_public_cottages", {
      target_locale: "ar",
      requested_search: query,
      target_after_slug: slugAt(1),
      target_limit: 12,
    });
    await expect(
      new SupabaseCottageDiscovery(clientReturning(pageOf([]))).search(
        "en",
        query,
        slugAt(1),
      ),
    ).resolves.toEqual({ status: "loaded", cottages: [], nextAfter: null });
  });

  it("treats a malformed or inconsistent paged response as unavailable", async () => {
    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
    const slugAt = (number: number) =>
      `cottage-${number.toString(16).padStart(32, "0")}`;
    const cottageAt = (number: number) => ({
      ...validSummary,
      slug: slugAt(number),
    });
    const fullPage = Array.from({ length: 12 }, (_, index) =>
      cottageAt(index + 2),
    );
    const responses = [
      [cottageAt(2)],
      { ...pageOf([cottageAt(2)]), total: 1 },
      pageOf(Array.from({ length: 13 }, (_, index) => cottageAt(index + 2))),
      pageOf([cottageAt(2)], slugAt(2)),
      pageOf(fullPage, slugAt(12)),
      pageOf([cottageAt(1)]),
      pageOf([cottageAt(3), cottageAt(2)]),
    ];
    for (const response of responses) {
      await expect(
        new SupabaseCottageDiscovery(clientReturning(response)).search(
          "en",
          query,
          slugAt(1),
        ),
      ).resolves.toEqual({ status: "unavailable" });
    }
    expect(diagnostic).toHaveBeenCalledTimes(responses.length);
    expect(diagnostic).toHaveBeenCalledWith(
      "Public Cottage discovery unavailable",
      { operation: "search", result: "invalid-provider-data" },
    );
  });

  it("independently rejects unknown amenities and empty public inventory at the database boundary", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      new SupabaseCottageDiscovery(
        clientReturning(
          pageOf([{ ...validSummary, amenities: ["private_pool_note"] }]),
        ),
      ).search("en", query, null),
    ).resolves.toEqual({ status: "unavailable" });
    await expect(
      new SupabaseCottageDiscovery(
        clientReturning(pageOf([{ ...validSummary, inventory: [] }])),
      ).search("en", query, null),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("rejects invalid dates, slugs and room counts from provider data", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      new SupabaseCottageDiscovery(
        clientReturning(
          pageOf([
            {
              ...validSummary,
              inventory: [
                {
                  ...validSummary.inventory[0],
                  serviceDay: "2026-02-31",
                },
              ],
            },
          ]),
        ),
      ).search("en", query, null),
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
        clientReturning(
          pageOf([{ ...validSummary, slug: "../administrator" }]),
        ),
      ).search("en", query, null),
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

  it("validates complete public inventory and every-day search eligibility", async () => {
    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
    const rangedQuery = { ...query, to: "2026-08-22", selections: [] };
    const inventory = [
      { ...validSummary.inventory[0] },
      { ...validSummary.inventory[1], available: false },
      { ...validSummary.inventory[2], available: false },
      {
        serviceDay: "2026-08-22",
        kind: "shift",
        position: 1,
        name: "Morning",
        startTime: "08:00",
        endTime: "14:00",
        priceIqd: 65000,
        available: true,
      },
      {
        serviceDay: "2026-08-22",
        kind: "shift",
        position: 2,
        name: "Evening",
        startTime: "18:00",
        endTime: "23:00",
        priceIqd: 90000,
        available: true,
      },
      {
        serviceDay: "2026-08-22",
        kind: "full-day",
        name: "Full-day bundle",
        startTime: "08:00",
        endTime: "23:00",
        priceIqd: 120000,
        available: true,
      },
    ];
    const summary = { ...validSummary, inventory };
    for (const selections of [
      [],
      [
        {
          serviceDay: "2026-08-21",
          kind: "shift" as const,
          position: 1 as const,
        },
      ],
    ]) {
      await expect(
        new SupabaseCottageDiscovery(clientReturning(pageOf([summary]))).search(
          "en",
          { ...rangedQuery, selections },
          null,
        ),
      ).resolves.toEqual({
        status: "loaded",
        cottages: [
          {
            slug: publicSlug,
            name: "Quiet Garden",
            governorate: "Baghdad",
            approximateLocation: "Abu Ghraib",
            capacity: 6,
            amenities: ["pool", "wifi"],
            mediaUrls: [
              "/api/cottage-media/70000000-0000-4000-8000-000000000028",
            ],
            inventory,
          },
        ],
        nextAfter: null,
      });
    }
    const profile = {
      ...summary,
      bedrooms: 2,
      bathrooms: 1,
      description: "Approved",
      houseRules: "No smoking",
    };
    await expect(
      new SupabaseCottageDiscovery(clientReturning(profile)).profile(
        "en",
        publicSlug,
        {
          ...rangedQuery,
          selections: [
            { serviceDay: "2026-08-21", kind: "shift", position: 3 },
          ],
        },
      ),
    ).resolves.toEqual({
      status: "loaded",
      cottage: expect.objectContaining({ inventory }),
    });
    await expect(
      new SupabaseCottageDiscovery(clientReturning(pageOf([summary]))).search(
        "en",
        {
          ...rangedQuery,
          selections: [
            { serviceDay: "2026-08-21", kind: "shift", position: 2 },
          ],
        },
        null,
      ),
    ).resolves.toEqual({ status: "unavailable" });
    await expect(
      new SupabaseCottageDiscovery(
        clientReturning(pageOf([summary, summary])),
      ).search("en", rangedQuery, null),
    ).resolves.toEqual({ status: "unavailable" });
    const corruptInventories = [
      [],
      inventory.slice(1),
      inventory.slice(0, 3),
      [...inventory, inventory[0]],
      [inventory[1], inventory[0], ...inventory.slice(2)],
      inventory.map((item, index) =>
        index === 0 ? { ...item, exactAddress: "private" } : item,
      ),
      inventory.map((item, index) =>
        index === 0 ? { ...item, serviceDay: "2026-08-20" } : item,
      ),
      inventory.map((item, index) =>
        index === 0 ? { ...item, kind: "unknown" } : item,
      ),
      inventory.map((item, index) =>
        index === 0 ? { ...item, position: 3 } : item,
      ),
      inventory.map((item, index) =>
        index === 0 ? { ...item, priceIqd: null } : item,
      ),
      inventory.map((item, index) =>
        index === 0 ? { ...item, priceIqd: 0 } : item,
      ),
      inventory.map((item, index) =>
        index === 0 ? { ...item, priceIqd: 1.5 } : item,
      ),
      inventory.map((item, index) =>
        index === 0 ? { ...item, priceIqd: Number.MAX_SAFE_INTEGER + 1 } : item,
      ),
      inventory.map((item) =>
        item.serviceDay === "2026-08-22" ? { ...item, available: false } : item,
      ),
    ];
    for (const corrupt of corruptInventories) {
      await expect(
        new SupabaseCottageDiscovery(
          clientReturning(pageOf([{ ...summary, inventory: corrupt }])),
        ).search("en", rangedQuery, null),
      ).resolves.toEqual({ status: "unavailable" });
    }
    const inventoryForDays = (dayCount: number) =>
      Array.from({ length: dayCount }, (_, index) => {
        const day = new Date("2030-01-12T00:00:00Z");
        day.setUTCDate(day.getUTCDate() + index);
        return [
          {
            ...validSummary.inventory[0],
            serviceDay: day.toISOString().slice(0, 10),
          },
          {
            ...validSummary.inventory[1],
            serviceDay: day.toISOString().slice(0, 10),
          },
          {
            ...validSummary.inventory[1],
            position: 3,
            serviceDay: day.toISOString().slice(0, 10),
          },
          {
            ...validSummary.inventory[2],
            serviceDay: day.toISOString().slice(0, 10),
          },
        ];
      }).flat();
    const maximumInventory = inventoryForDays(31);
    expect(maximumInventory).toHaveLength(124);
    await expect(
      new SupabaseCottageDiscovery(
        clientReturning(
          pageOf([{ ...validSummary, inventory: maximumInventory }]),
        ),
      ).search(
        "en",
        { ...query, from: "2030-01-12", to: "2030-02-11", selections: [] },
        null,
      ),
    ).resolves.toEqual({
      status: "loaded",
      cottages: [expect.objectContaining({ inventory: maximumInventory })],
      nextAfter: null,
    });
    const oversizedInventory = inventoryForDays(32);
    expect(oversizedInventory).toHaveLength(128);
    await expect(
      new SupabaseCottageDiscovery(
        clientReturning(
          pageOf([{ ...validSummary, inventory: oversizedInventory }]),
        ),
      ).search(
        "en",
        { ...query, from: "2030-01-12", to: "2030-02-12", selections: [] },
        null,
      ),
    ).resolves.toEqual({ status: "unavailable" });
    expect(diagnostic).toHaveBeenCalledWith(
      "Public Cottage discovery unavailable",
      {
        operation: "search",
        result: "invalid-provider-data",
      },
    );
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain("private");
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
      inventory: validSummary.inventory.map((item) => ({
        ...item,
        serviceDay: "2099-08-21",
        priceIqd: null,
        available: false,
      })),
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
        inventory: data.inventory,
      }),
    });
  });
});
