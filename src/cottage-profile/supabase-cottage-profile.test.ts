import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  parseAdministratorCottageProfileCursor,
  SupabaseCottageProfileRepository,
} from "./supabase-cottage-profile";

function result<T>(data: T, error: unknown = null) {
  return Promise.resolve({ data, error });
}

function loadMalformedProviderProfile({
  profile = {},
  photo = {},
}: {
  profile?: Record<string, unknown>;
  photo?: Record<string, unknown>;
}) {
  const profileId = "70000000-0000-4000-8000-000000000001";
  const profileResult = result({
    id: profileId,
    owner_user_id: "10000000-0000-4000-8000-000000000701",
    application_id: null,
    current_publication_id: null,
    status: "draft",
    version: 1,
    name: "Draft cottage",
    governorate: "Erbil",
    approximate_location: "Near Shaqlawa",
    exact_address: "Private address",
    exact_latitude: 36.408333,
    exact_longitude: 44.385834,
    private_directions: "Past the orchard gate",
    capacity: 10,
    bedrooms: 4,
    bathrooms: 3,
    amenities: ["garden"],
    source_language: "en",
    description: "Description",
    house_rules: "Rules",
    submitted_source_revision_id: null,
    updated_at: "2026-08-17T09:15:00.000Z",
    ...profile,
  });
  const photosResult = result([
    {
      id: "71000000-0000-4000-8000-000000000001",
      original_filename: "cottage.webp",
      media_type: "image/webp",
      size_bytes: 128,
      state: "ready",
      updated_at: "2026-08-17T09:05:00.000Z",
      ...photo,
    },
  ]);
  const client = {
    from: vi.fn((table: string) => {
      if (table === "owner_application_cottage_profiles") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn(() => profileResult),
            }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn(() => photosResult),
            }),
          }),
        }),
      };
    }),
    rpc: vi.fn(),
  } as unknown as SupabaseClient;
  return new SupabaseCottageProfileRepository(client, client).load(profileId);
}

describe("Supabase Cottage Profile adapter", () => {
  it.each(["owner", "administrator"] as const)(
    "hydrates the %s list with one related-photo query and one source-revision query",
    async (actor) => {
      const profiles = [1, 2].map((suffix) => ({
        id: `70000000-0000-4000-8000-00000000000${suffix}`,
        owner_user_id: "10000000-0000-4000-8000-000000000701",
        application_id: null,
        current_publication_id: null,
        status: "submitted_for_content_approval",
        version: 2,
        name: `Cottage ${suffix}`,
        governorate: "Erbil",
        approximate_location: "Near Shaqlawa",
        exact_address: "Private address",
        exact_latitude: 36.408333,
        exact_longitude: 44.385834,
        private_directions: "Past the orchard gate",
        capacity: 10,
        bedrooms: 4,
        bathrooms: 3,
        amenities: ["garden"],
        source_language: "en",
        description: "Description",
        house_rules: "Rules",
        submitted_source_revision_id: `73000000-0000-4000-8000-00000000000${suffix}`,
        updated_at: "2026-08-17T09:15:00.000Z",
      }));
      const photosQuery = {
        in: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn(() =>
              result(
                profiles.map((profile, index) => ({
                  profile_id: profile.id,
                  id: `71000000-0000-4000-8000-00000000000${index + 1}`,
                  original_filename: `cottage-${index + 1}.webp`,
                  media_type: "image/webp",
                  size_bytes: 128,
                  state: "ready",
                  updated_at: "2026-08-17T09:05:00.000Z",
                })),
              ),
            ),
          }),
        }),
      };
      const sourcesQuery = {
        in: vi.fn(() =>
          result(
            profiles.map((profile, index) => ({
              id: profile.submitted_source_revision_id,
              revision: 1,
              owner_user_id: profile.owner_user_id,
              source_language: "en",
              description: `Source ${index + 1}`,
              house_rules: "Rules",
              submitted_at: "2026-08-17T09:10:00.000Z",
            })),
          ),
        ),
      };
      const limit = vi.fn(() => result(profiles));
      const profileQuery = {
        order: vi.fn(),
        limit,
      };
      profileQuery.order.mockReturnValue(profileQuery);
      const from = vi.fn((table: string) => {
        if (table === "owner_application_cottage_profiles") {
          return {
            select: vi.fn().mockReturnValue(profileQuery),
          };
        }
        return {
          select: vi
            .fn()
            .mockReturnValue(
              table === "cottage_profile_photos" ? photosQuery : sourcesQuery,
            ),
        };
      });
      const client = {
        from,
        rpc: vi.fn(() => result(profiles)),
      } as unknown as SupabaseClient;

      const repository = new SupabaseCottageProfileRepository(client, client);
      const loaded =
        actor === "owner"
          ? await repository.listOwner()
          : (await repository.listAdministrator()).profiles;

      expect(loaded).toHaveLength(2);
      expect(loaded[1]).toMatchObject({
        photos: [{ originalFilename: "cottage-2.webp" }],
        submittedSourceRevision: { description: "Source 2" },
      });
      expect(photosQuery.in).toHaveBeenCalledOnce();
      expect(sourcesQuery.in).toHaveBeenCalledOnce();
      if (actor === "administrator") expect(limit).toHaveBeenCalledWith(101);
    },
  );

  it("hydrates every administrator photo when the page exceeds the provider row cap", async () => {
    const profiles = Array.from({ length: 84 }, (_, index) => {
      const suffix = index + 1;
      return {
        id: `70000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`,
        owner_user_id: "10000000-0000-4000-8000-000000000701",
        application_id: null,
        current_publication_id: null,
        status: "draft",
        version: 1,
        name: `Cottage ${suffix}`,
        governorate: "Erbil",
        approximate_location: "Near Shaqlawa",
        exact_address: "Private address",
        exact_latitude: null,
        exact_longitude: null,
        private_directions: "",
        capacity: 4,
        bedrooms: 2,
        bathrooms: 1,
        amenities: ["garden"],
        source_language: "en",
        description: "Description",
        house_rules: "Rules",
        submitted_source_revision_id: null,
        updated_at: "2026-08-17T09:15:00.000Z",
      };
    });
    const photosByProfile = new Map(
      profiles.map((profile, profileIndex) => [
        profile.id,
        Array.from({ length: 12 }, (_, photoIndex) => ({
          profile_id: profile.id,
          id: `71000000-0000-4000-8000-${String(profileIndex * 12 + photoIndex + 1).padStart(12, "0")}`,
          original_filename: `cottage-${profileIndex + 1}-${photoIndex + 1}.webp`,
          media_type: "image/webp",
          size_bytes: 128,
          state: "ready",
          updated_at: "2026-08-17T09:05:00.000Z",
        })),
      ]),
    );
    const photoQueries: string[][] = [];
    const photosQuery = {
      in: vi.fn((_field: string, profileIds: string[]) => {
        photoQueries.push(profileIds);
        return {
          eq: vi.fn().mockReturnValue({
            order: vi.fn(() =>
              result(
                profileIds
                  .flatMap((profileId) => photosByProfile.get(profileId) ?? [])
                  .slice(0, 1000),
              ),
            ),
          }),
        };
      }),
    };
    const profileQuery: Record<string, ReturnType<typeof vi.fn>> = {};
    profileQuery.order = vi.fn(() => profileQuery);
    profileQuery.limit = vi.fn(() => result(profiles));
    const client = {
      from: vi.fn((table: string) => ({
        select: vi
          .fn()
          .mockReturnValue(
            table === "owner_application_cottage_profiles"
              ? profileQuery
              : photosQuery,
          ),
      })),
      rpc: vi.fn(),
    } as unknown as SupabaseClient;

    const page = await new SupabaseCottageProfileRepository(
      client,
      client,
    ).listAdministrator();

    expect(page.profiles).toHaveLength(84);
    expect(page.profiles.at(-1)?.photos).toHaveLength(12);
    expect(photoQueries.map(({ length }) => length)).toEqual([83, 1]);
  });

  it("continues the owner list beyond the provider row cap without truncation", async () => {
    const updatedAt = "2026-08-17T09:15:00.000Z";
    const profiles = Array.from({ length: 101 }, (_, index) => 101 - index).map(
      (suffix) => ({
        id: `70000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`,
        owner_user_id: "10000000-0000-4000-8000-000000000701",
        application_id: null,
        current_publication_id: null,
        status: "draft",
        version: 1,
        name: `Cottage ${suffix}`,
        governorate: "Erbil",
        approximate_location: "Near Shaqlawa",
        exact_address: "Private address",
        exact_latitude: null,
        exact_longitude: null,
        private_directions: "",
        capacity: 4,
        bedrooms: 2,
        bathrooms: 1,
        amenities: ["garden"],
        source_language: "en",
        description: "Description",
        house_rules: "Rules",
        submitted_source_revision_id: null,
        updated_at: updatedAt,
      }),
    );
    const rpc = vi.fn((_functionName: string, args?: Record<string, unknown>) =>
      result(
        args?.target_after_id === profiles[99]?.id
          ? profiles.slice(100)
          : profiles.slice(0, 100),
      ),
    );
    const photosQuery = {
      in: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ order: vi.fn(() => result([])) }),
      }),
    };
    const client = {
      from: vi.fn(() => ({ select: vi.fn().mockReturnValue(photosQuery) })),
      rpc,
    } as unknown as SupabaseClient;

    const loaded = await new SupabaseCottageProfileRepository(
      client,
      client,
    ).listOwner();

    expect(loaded).toHaveLength(101);
    expect(loaded.at(-1)?.name).toBe("Cottage 1");
    expect(rpc).toHaveBeenNthCalledWith(1, "list_owner_cottage_profiles", {
      target_after_updated_at: null,
      target_after_id: null,
      target_limit: 100,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "list_owner_cottage_profiles", {
      target_after_updated_at: updatedAt,
      target_after_id: profiles[99]?.id,
      target_limit: 100,
    });
  });

  it("continues after the stable 100-profile administrator boundary without a duplicate", async () => {
    const updatedAt = "2026-08-17T09:15:00.123456Z";
    const rows = Array.from({ length: 101 }, (_, index) => 101 - index).map(
      (suffix) => ({
        id: `70000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`,
        owner_user_id: "10000000-0000-4000-8000-000000000701",
        application_id: null,
        current_publication_id: null,
        status: "draft",
        version: 1,
        name: `Cottage ${suffix}`,
        governorate: "Erbil",
        approximate_location: "Near Shaqlawa",
        exact_address: "Private address",
        exact_latitude: null,
        exact_longitude: null,
        private_directions: "",
        capacity: 4,
        bedrooms: 2,
        bathrooms: 1,
        amenities: ["garden"],
        source_language: "en",
        description: "Description",
        house_rules: "Rules",
        submitted_source_revision_id: null,
        updated_at: updatedAt,
      }),
    );
    const makeRepository = (profileRows: typeof rows) => {
      const profileQuery: Record<string, ReturnType<typeof vi.fn>> = {};
      profileQuery.order = vi.fn(() => profileQuery);
      profileQuery.or = vi.fn(() => profileQuery);
      profileQuery.limit = vi.fn(() => result(profileRows));
      const photosQuery = {
        in: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ order: vi.fn(() => result([])) }),
        }),
      };
      const client = {
        from: vi.fn((table: string) => ({
          select: vi
            .fn()
            .mockReturnValue(
              table === "owner_application_cottage_profiles"
                ? profileQuery
                : photosQuery,
            ),
        })),
        rpc: vi.fn(),
      } as unknown as SupabaseClient;
      return {
        profileQuery,
        repository: new SupabaseCottageProfileRepository(client, client),
      };
    };
    const first = makeRepository(rows);

    const firstPage = await first.repository.listAdministrator();

    expect(firstPage.profiles).toHaveLength(100);
    expect(firstPage.profiles.at(-1)?.name).toBe("Cottage 2");
    expect(firstPage.nextCursor).toEqual({
      updatedAt,
      profileId: "70000000-0000-4000-8000-000000000002",
    });
    expect(first.profileQuery.order).toHaveBeenNthCalledWith(2, "id", {
      ascending: false,
    });

    const second = makeRepository([rows.at(-1)!]);
    const secondPage = await second.repository.listAdministrator(
      firstPage.nextCursor!,
    );

    expect(secondPage.profiles.map(({ name }) => name)).toEqual(["Cottage 1"]);
    expect(secondPage.nextCursor).toBeNull();
    expect(second.profileQuery.or).toHaveBeenCalledWith(
      `updated_at.lt.${updatedAt},and(updated_at.eq.${updatedAt},id.lt.70000000-0000-4000-8000-000000000002)`,
    );
  });

  it("validates administrator continuation cursor input before provider use", () => {
    expect(
      parseAdministratorCottageProfileCursor(
        "2026-08-17T09:15:00.123456Z",
        "70000000-0000-4000-8000-000000000002",
      ),
    ).toEqual({
      updatedAt: "2026-08-17T09:15:00.123456Z",
      profileId: "70000000-0000-4000-8000-000000000002",
    });
    expect(() =>
      parseAdministratorCottageProfileCursor(
        "not-a-timestamp",
        "70000000-0000-4000-8000-000000000002",
      ),
    ).toThrow(/cursor/);
  });

  it("loads private photos and the immutable submitted source with the working copy", async () => {
    const profileId = "70000000-0000-4000-8000-000000000001";
    const sourceRevisionId = "73000000-0000-4000-8000-000000000001";
    const profile = result({
      id: profileId,
      owner_user_id: "10000000-0000-4000-8000-000000000701",
      application_id: "20000000-0000-4000-8000-000000000701",
      current_publication_id: null,
      status: "submitted_for_content_approval",
      version: 3,
      name: "Continued Application Cottage",
      governorate: "Erbil",
      approximate_location: "Near Shaqlawa",
      exact_address: "Private exact address",
      exact_latitude: 36.408333,
      exact_longitude: 44.385834,
      private_directions: "Continue past the orchard gate.",
      capacity: 10,
      bedrooms: 4,
      bathrooms: 3,
      amenities: ["garden", "wifi"],
      source_language: "en",
      description: "Administrator working-copy description",
      house_rules: "Administrator working-copy rules",
      submitted_source_revision_id: sourceRevisionId,
      updated_at: "2026-08-17T09:15:00.000Z",
    });
    const photos = result([
      {
        id: "71000000-0000-4000-8000-000000000001",
        original_filename: "shaqlawa-cottage.webp",
        media_type: "image/webp",
        size_bytes: 128,
        state: "ready",
        updated_at: "2026-08-17T09:05:00.000Z",
      },
    ]);
    const source = result({
      revision: 1,
      owner_user_id: "10000000-0000-4000-8000-000000000701",
      source_language: "en",
      description: "Owner working-copy description",
      house_rules: "Owner working-copy House Rules",
      submitted_at: "2026-08-17T09:10:00.000Z",
    });
    const from = vi.fn((table: string) => {
      if (table === "owner_application_cottage_profiles") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({ maybeSingle: vi.fn(() => profile) }),
          }),
        };
      }
      if (table === "cottage_profile_photos") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({ order: vi.fn(() => photos) }),
            }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ maybeSingle: vi.fn(() => source) }),
        }),
      };
    });
    const client = { from, rpc: vi.fn() } as unknown as SupabaseClient;

    await expect(
      new SupabaseCottageProfileRepository(client, client).load(profileId),
    ).resolves.toMatchObject({
      id: profileId,
      applicationId: "20000000-0000-4000-8000-000000000701",
      status: "submitted_for_content_approval",
      exactLatitude: 36.408333,
      photos: [{ state: "ready", mediaType: "image/webp" }],
      submittedSourceRevision: {
        revision: 1,
        description: "Owner working-copy description",
      },
    });
  });

  it.each([
    ["an unsupported photo media type", {}, { media_type: "image/heic" }],
    ["an oversized photo", {}, { size_bytes: 5_242_881 }],
    ["an unknown amenity", { amenities: ["hot_tub"] }, {}],
    [
      "an undefined publication identifier",
      { current_publication_id: undefined },
      {},
    ],
    ["an oversized cottage name", { name: "x".repeat(121) }, {}],
    ["a latitude outside its range", { exact_latitude: 91 }, {}],
    ["a half-present coordinate pair", { exact_longitude: null }, {}],
    ["capacity outside its range", { capacity: 101 }, {}],
    ["bedrooms outside their range", { bedrooms: 0 }, {}],
    ["bathrooms outside their range", { bathrooms: 51 }, {}],
  ])(
    "rejects malformed provider data containing %s",
    async (_, profile, photo) => {
      await expect(
        loadMalformedProviderProfile({ profile, photo }),
      ).rejects.toThrow(/Cottage Profile/);
    },
  );

  it.each([
    ["ready", false, "retain"],
    ["deletion_pending", true, "delete"],
  ] as const)(
    "maps a %s photo with active=%s to the %s deletion disposition",
    async (state, isActive, disposition) => {
      const client = {
        rpc: vi.fn(() =>
          result({
            object_path: "owner/profile/photo.webp",
            state,
            is_active: isActive,
          }),
        ),
      } as unknown as SupabaseClient;

      await expect(
        new SupabaseCottageProfileRepository(
          client,
          client,
        ).preparePhotoDeletion("71000000-0000-4000-8000-000000000001"),
      ).resolves.toEqual({
        objectPath: "owner/profile/photo.webp",
        disposition,
      });
    },
  );

  it.each([
    ["ready", true],
    ["deletion_pending", false],
    ["ready", undefined],
    ["unknown", false],
  ] as const)(
    "rejects an inconsistent deletion response with state=%s and active=%s",
    async (state, isActive) => {
      const client = {
        rpc: vi.fn(() =>
          result({
            object_path: "owner/profile/photo.webp",
            state,
            is_active: isActive,
          }),
        ),
      } as unknown as SupabaseClient;

      await expect(
        new SupabaseCottageProfileRepository(
          client,
          client,
        ).preparePhotoDeletion("71000000-0000-4000-8000-000000000001"),
      ).rejects.toThrow("Cottage Profile photo deletion data is invalid");
    },
  );
});
