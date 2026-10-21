import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { createCottageProfile } from "./cottage-profile";
import {
  parseAdministratorCottageProfileCursor,
  SupabaseCottageProfileRepository,
  SupabaseCottageProfileStorage,
} from "./supabase-cottage-profile";

function result<T>(data: T, error: unknown = null) {
  return Promise.resolve({ data, error });
}

const readyPhotoId = "71000000-0000-4000-8000-000000000001";

function loadProviderProfile({
  profile = {},
  photo = {},
  rpc = vi.fn(),
}: {
  profile?: Record<string, unknown>;
  photo?: Record<string, unknown>;
  rpc?: ReturnType<typeof vi.fn>;
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
      id: readyPhotoId,
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
    rpc,
  } as unknown as SupabaseClient;
  return new SupabaseCottageProfileRepository(client, client).load(profileId);
}

describe("Supabase Cottage Profile adapter", () => {
  it("administrator visibility data rejects corrupt provider results", async () => {
    const profileId = "70000000-0000-4000-8000-000000000001";
    const publicationId = "72000000-0000-4000-8000-000000000001";
    const visibility = {
      profileId,
      publicationId,
      publicSlug: "cottage-70000000000040008000000000000001",
      descriptionHidden: true,
      photos: [
        {
          photoId: readyPhotoId,
          originalFilename: "cottage.webp",
          hidden: true,
        },
        {
          photoId: "71000000-0000-4000-8000-000000000002",
          originalFilename: "second.webp",
          hidden: false,
        },
      ],
    };
    const rpc = vi.fn().mockImplementation(() => result(visibility));
    const privilegedRpc = vi.fn();
    const repository = new SupabaseCottageProfileRepository(
      { rpc } as unknown as SupabaseClient,
      { rpc: privilegedRpc } as unknown as SupabaseClient,
    );
    await expect(
      repository.loadAdministratorContentVisibility(profileId),
    ).resolves.toEqual(visibility);
    expect(rpc).toHaveBeenLastCalledWith(
      "get_administrator_cottage_content_visibility",
      { target_profile_id: profileId },
    );
    const input = {
      profileId,
      publicationId,
      hidden: true,
      reason: "Safety review",
    };
    await expect(
      repository.setAdministratorDescriptionHidden(input),
    ).resolves.toEqual(visibility);
    expect(rpc).toHaveBeenLastCalledWith(
      "set_administrator_cottage_description_hidden",
      {
        target_profile_id: profileId,
        target_publication_id: publicationId,
        requested_hidden: true,
        requested_reason: "Safety review",
      },
    );
    await repository.setAdministratorPhotoHidden({
      ...input,
      photoId: readyPhotoId,
    });
    expect(rpc).toHaveBeenLastCalledWith(
      "set_administrator_cottage_photo_hidden",
      {
        target_profile_id: profileId,
        target_publication_id: publicationId,
        target_photo_id: readyPhotoId,
        requested_hidden: true,
        requested_reason: "Safety review",
      },
    );
    expect(privilegedRpc).not.toHaveBeenCalled();
    for (const corrupt of [
      null,
      [],
      {},
      { ...visibility, profileId: "bad" },
      { ...visibility, profileId: "70000000-0000-4000-8000-000000000099" },
      { ...visibility, publicationId: "bad" },
      { ...visibility, publicSlug: "../private" },
      { ...visibility, publicSlug: "approved-cottage" },
      { ...visibility, descriptionHidden: "false" },
      { ...visibility, photos: [] },
      { ...visibility, photos: [null] },
      { ...visibility, photos: [{ ...visibility.photos[0], hidden: 0 }] },
      { ...visibility, photos: [{ ...visibility.photos[0], photoId: "bad" }] },
      {
        ...visibility,
        photos: [{ ...visibility.photos[0], originalFilename: " " }],
      },
      {
        ...visibility,
        photos: [
          { ...visibility.photos[0], originalFilename: "x".repeat(181) },
        ],
      },
      { ...visibility, photos: [visibility.photos[0], visibility.photos[0]] },
      {
        ...visibility,
        photos: visibility.photos.map((photo) => ({ ...photo, hidden: true })),
      },
      { ...visibility, objectPath: "private/object.webp" },
    ]) {
      rpc.mockImplementationOnce(() => result(corrupt));
      await expect(
        repository.setAdministratorDescriptionHidden(input),
      ).rejects.toThrow();
      if (corrupt !== null) {
        rpc.mockImplementationOnce(() => result(corrupt));
        await expect(
          repository.loadAdministratorContentVisibility(profileId),
        ).rejects.toThrow();
      }
    }
    rpc.mockImplementationOnce(() =>
      result({ ...visibility, descriptionHidden: false }),
    );
    await expect(
      repository.setAdministratorDescriptionHidden(input),
    ).rejects.toThrow();
    rpc.mockImplementationOnce(() =>
      result({ ...visibility, photos: [visibility.photos[1]] }),
    );
    await expect(
      repository.setAdministratorPhotoHidden({
        ...input,
        photoId: readyPhotoId,
      }),
    ).rejects.toThrow();
    rpc.mockImplementationOnce(() =>
      result({
        ...visibility,
        photos: visibility.photos.map((photo) => ({ ...photo, hidden: false })),
      }),
    );
    await expect(
      repository.setAdministratorPhotoHidden({
        ...input,
        photoId: readyPhotoId,
      }),
    ).rejects.toThrow();
    rpc.mockImplementationOnce(() => result(null));
    await expect(
      repository.loadAdministratorContentVisibility(profileId),
    ).resolves.toBeNull();
    rpc.mockImplementationOnce(() => result(null, { code: "42501" }));
    await expect(
      repository.setAdministratorPhotoHidden({
        ...input,
        photoId: readyPhotoId,
      }),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
  });

  it("administrator edits forward a validated reason", async () => {
    const rpc = vi.fn(() => result(null, { code: "42501" }));
    const privilegedRpc = vi.fn();
    const repository = new SupabaseCottageProfileRepository(
      { rpc } as unknown as SupabaseClient,
      { rpc: privilegedRpc } as unknown as SupabaseClient,
    );
    await expect(
      repository.updateAdministrator({
        profileId: "70000000-0000-4000-8000-000000000001",
        expectedVersion: 2,
        reason: "Correct content",
        values: {
          name: "Cottage",
          governorate: "Erbil",
          approximateLocation: "Shaqlawa",
          exactAddress: "",
          exactLatitude: null,
          exactLongitude: null,
          privateDirections: "",
          capacity: 8,
          bedrooms: 3,
          bathrooms: 2,
          amenities: ["garden"],
          sourceLanguage: "en",
          description: "Description",
          houseRules: "Rules",
        },
      }),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
    expect(rpc).toHaveBeenCalledWith(
      "update_administrator_cottage_profile",
      expect.objectContaining({
        target_profile_id: "70000000-0000-4000-8000-000000000001",
        target_expected_version: 2,
        requested_reason: "Correct content",
      }),
    );
    expect(privilegedRpc).not.toHaveBeenCalled();
  });

  it("administrator photo mutations preserve owner calls and forward reasons", async () => {
    const rpc = vi.fn((name: string) =>
      result(
        name === "prepare_cottage_profile_photo_upload"
          ? { id: readyPhotoId, object_path: "owner/profile/photo.webp" }
          : {
              state: "deletion_pending",
              is_active: true,
              object_path: "owner/profile/photo.webp",
            },
      ),
    );
    const privilegedRpc = vi.fn();
    const repository = new SupabaseCottageProfileRepository(
      { rpc } as unknown as SupabaseClient,
      { rpc: privilegedRpc } as unknown as SupabaseClient,
    );
    const input = {
      profileId: "70000000-0000-4000-8000-000000000001",
      originalFilename: "cottage.webp",
      mediaType: "image/webp",
      sizeBytes: 128,
    };
    await repository.preparePhotoUpload(input);
    expect(rpc).toHaveBeenLastCalledWith(
      "prepare_cottage_profile_photo_upload",
      {
        target_profile_id: input.profileId,
        requested_original_filename: "cottage.webp",
        requested_media_type: "image/webp",
        requested_size_bytes: 128,
      },
    );
    await repository.preparePhotoDeletion(readyPhotoId);
    expect(rpc).toHaveBeenLastCalledWith(
      "prepare_cottage_profile_photo_deletion",
      { target_photo_id: readyPhotoId },
    );
    await repository.preparePhotoUpload({ ...input, reason: "Replace photo" });
    expect(rpc).toHaveBeenLastCalledWith(
      "prepare_cottage_profile_photo_upload",
      expect.objectContaining({ requested_reason: "Replace photo" }),
    );
    await repository.preparePhotoDeletion(readyPhotoId, "Recover deletion");
    expect(rpc).toHaveBeenLastCalledWith(
      "prepare_cottage_profile_photo_deletion",
      { target_photo_id: readyPhotoId, requested_reason: "Recover deletion" },
    );
    expect(privilegedRpc).not.toHaveBeenCalled();
  });

  it("loads validated draft progress and rejects corrupt or stale evidence", async () => {
    const profile = {
      id: "70000000-0000-4000-8000-000000000749",
      owner_user_id: "10000000-0000-4000-8000-000000000749",
      application_id: null,
      current_publication_id: null,
      status: "draft",
      version: 1,
      name: "Draft cottage",
      governorate: null,
      approximate_location: null,
      exact_address: null,
      exact_latitude: null,
      exact_longitude: null,
      private_directions: null,
      capacity: null,
      bedrooms: null,
      bathrooms: null,
      amenities: [],
      source_language: null,
      description: null,
      house_rules: null,
      submitted_source_revision_id: null,
      updated_at: "2026-08-17T09:15:00.000Z",
    };
    const valid = {
      profile_id: profile.id,
      profile_version: 1,
      completed_requirements: 1,
      next_requirement: "governorate",
      submission_allowed: true,
    };
    async function load(
      answer: unknown,
      error: unknown = null,
      heldProfiles = [profile],
    ) {
      let page = 0;
      const rpc = vi.fn(
        (name: string, args: { target_profile_ids?: string[] }) => {
          if (name === "list_owner_cottage_profiles") {
            return result(heldProfiles.slice(page++ * 100, page * 100));
          }
          return result(
            typeof answer === "function"
              ? answer(args.target_profile_ids)
              : answer,
            error,
          );
        },
      );
      const client = {
        rpc,
        from: vi.fn(() => ({
          select: () => ({
            in: () => ({ eq: () => ({ order: () => result([]) }) }),
          }),
        })),
      } as unknown as SupabaseClient;
      const privilegedClient = { rpc: vi.fn() } as unknown as SupabaseClient;
      const loaded = await new SupabaseCottageProfileRepository(
        client,
        privilegedClient,
      ).listOwner();
      expect(privilegedClient.rpc).not.toHaveBeenCalled();
      return { loaded, rpc };
    }
    const { loaded: profiles, rpc } = await load([valid]);
    expect(rpc).toHaveBeenCalledWith(
      "read_owner_cottage_profile_draft_progress",
      { target_profile_ids: [profile.id] },
    );
    expect(profiles[0]?.draftProgress).toEqual({
      status: "loaded",
      completed: 1,
      nextRequirement: "governorate",
      submissionAllowed: true,
    });
    for (const answer of [
      null,
      {},
      [],
      [valid, valid],
      [null],
      [{ ...valid, profile_id: "70000000-0000-4000-8000-000000000750" }],
      [{ ...valid, profile_version: 2 }],
      [{ ...valid, profile_version: "1" }],
      [{ ...valid, profile_version: Number.MAX_SAFE_INTEGER + 1 }],
      ...[-1, 14, 1.5, "1", null].map((completed_requirements) => [
        { ...valid, completed_requirements },
      ]),
      ...["unknown", ["governorate"], 1, null].map((next_requirement) => [
        { ...valid, next_requirement },
      ]),
      [{ ...valid, completed_requirements: 13 }],
      [{ ...valid, submission_allowed: "true" }],
    ]) {
      const { loaded } = await load(answer);
      expect(loaded[0], JSON.stringify(answer)).toMatchObject({
        name: "Draft cottage",
        draftProgress: { status: "unavailable" },
      });
    }
    expect(
      (await load([valid], { message: "provider failed" })).loaded[0]
        ?.draftProgress,
    ).toEqual({ status: "unavailable" });
    expect(
      (
        await load(() => {
          throw new Error("request failed");
        })
      ).loaded[0]?.draftProgress,
    ).toEqual({ status: "unavailable" });
    const duplicate = await load([valid, valid], null, [
      profile,
      { ...profile, id: "70000000-0000-4000-8000-000000000750" },
    ]);
    expect(duplicate.loaded.map((held) => held.draftProgress)).toEqual([
      { status: "unavailable" },
      { status: "unavailable" },
    ]);
    expect(
      (
        await load([
          {
            ...valid,
            completed_requirements: 13,
            next_requirement: null,
            submission_allowed: false,
          },
        ])
      ).loaded[0]?.draftProgress,
    ).toEqual({
      status: "loaded",
      completed: 13,
      nextRequirement: null,
      submissionAllowed: false,
    });
    const many = Array.from({ length: 101 }, (_, index) => ({
      ...profile,
      id: `70000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    }));
    const batched = await load(
      (ids: string[]) => ids.map((id) => ({ ...valid, profile_id: id })),
      null,
      many,
    );
    expect(
      batched.loaded.every((held) => held.draftProgress?.status === "loaded"),
    ).toBe(true);
    expect(
      batched.rpc.mock.calls
        .filter(
          ([name]) => name === "read_owner_cottage_profile_draft_progress",
        )
        .map(([, args]) => args.target_profile_ids?.length),
    ).toEqual([100, 1]);
    const partial = await load(
      (ids: string[]) =>
        ids.length === 100
          ? ids.map((id) => ({ ...valid, profile_id: id }))
          : [],
      null,
      many,
    );
    expect(
      partial.loaded
        .slice(0, 100)
        .every((held) => held.draftProgress?.status === "loaded"),
    ).toBe(true);
    expect(partial.loaded[100]?.draftProgress).toEqual({
      status: "unavailable",
    });
    const excluded = await load([], null, [
      { ...profile, status: "abandoned" },
    ]);
    expect(excluded.rpc.mock.calls.map(([name]) => name)).toEqual([
      "list_owner_cottage_profiles",
    ]);
    expect(excluded.loaded[0]?.draftProgress).toBeUndefined();
  });

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
      await expect(loadProviderProfile({ profile, photo })).rejects.toThrow(
        /Cottage Profile/,
      );
    },
  );

  it("reads the unpublished Content Change answer only for a published Cottage Profile", async () => {
    const profileId = "70000000-0000-4000-8000-000000000001";
    const unpublishedRpc = vi.fn();

    await expect(
      loadProviderProfile({ rpc: unpublishedRpc }),
    ).resolves.toMatchObject({ hasUnpublishedContentChange: false });
    expect(unpublishedRpc).not.toHaveBeenCalled();

    const publishedRpc = vi.fn(() =>
      result([
        {
          profile_id: profileId,
          has_unpublished_content_change: true,
          profile_version: 1,
          ready_photo_ids: [readyPhotoId],
        },
      ]),
    );

    await expect(
      loadProviderProfile({
        profile: {
          current_publication_id: "74000000-0000-4000-8000-000000000001",
        },
        rpc: publishedRpc,
      }),
    ).resolves.toMatchObject({ hasUnpublishedContentChange: true });
    expect(publishedRpc).toHaveBeenCalledOnce();
    expect(publishedRpc).toHaveBeenCalledWith(
      "list_cottage_profile_unpublished_content_changes",
      { target_profile_ids: [profileId] },
    );
  });

  it("asks once per list page for the published profiles' unpublished Content Change answers", async () => {
    const profileIdFor = (suffix: number) =>
      `70000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
    const profiles = Array.from({ length: 101 }, (_, index) => 101 - index).map(
      (suffix) => ({
        id: profileIdFor(suffix),
        owner_user_id: "10000000-0000-4000-8000-000000000701",
        application_id: null,
        current_publication_id:
          suffix % 2 === 1
            ? `74000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`
            : null,
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
      }),
    );
    const changedProfileIds = [profileIdFor(99), profileIdFor(1)];
    const contentChangeRequests: string[][] = [];
    const draftProgressRequests: string[][] = [];
    const rpc = vi.fn((functionName: string, args: Record<string, unknown>) => {
      if (functionName === "list_owner_cottage_profiles") {
        return result(
          args.target_after_id === profiles[99]?.id
            ? profiles.slice(100)
            : profiles.slice(0, 100),
        );
      }
      const requested = args.target_profile_ids as string[];
      if (functionName === "read_owner_cottage_profile_draft_progress") {
        draftProgressRequests.push(requested);
        return result(
          requested.map((profileId) => ({
            profile_id: profileId,
            profile_version: 1,
            completed_requirements: 12,
            next_requirement: "photos",
            submission_allowed: true,
          })),
        );
      }
      if (functionName !== "list_cottage_profile_unpublished_content_changes") {
        throw new Error("Unexpected Cottage Profile RPC");
      }
      contentChangeRequests.push(requested);
      return result(
        requested.map((profileId) => ({
          profile_id: profileId,
          has_unpublished_content_change: changedProfileIds.includes(profileId),
          profile_version: 1,
          ready_photo_ids: [],
        })),
      );
    });
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

    expect(
      loaded
        .filter((profile) => profile.hasUnpublishedContentChange)
        .map(({ id }) => id),
    ).toEqual(changedProfileIds);
    expect(contentChangeRequests).toEqual([
      profiles
        .slice(0, 100)
        .filter((profile) => profile.current_publication_id !== null)
        .map(({ id }) => id),
      [profileIdFor(1)],
    ]);
    expect(contentChangeRequests[0]).toHaveLength(50);
    expect(draftProgressRequests).toEqual([
      profiles
        .filter((profile) => profile.current_publication_id === null)
        .map(({ id }) => id),
    ]);
    expect(rpc).toHaveBeenCalledTimes(5);
  });

  it.each([
    [
      "is not a list",
      {
        profile_id: "70000000-0000-4000-8000-000000000001",
        has_unpublished_content_change: true,
        profile_version: 1,
        ready_photo_ids: [readyPhotoId],
      },
    ],
    ["omits the profile", []],
    [
      "names another profile",
      [
        {
          profile_id: "70000000-0000-4000-8000-000000000001",
          has_unpublished_content_change: true,
          profile_version: 1,
          ready_photo_ids: [readyPhotoId],
        },
        {
          profile_id: "70000000-0000-4000-8000-000000000002",
          has_unpublished_content_change: true,
          profile_version: 1,
          ready_photo_ids: [readyPhotoId],
        },
      ],
    ],
    [
      "repeats the profile",
      [
        {
          profile_id: "70000000-0000-4000-8000-000000000001",
          has_unpublished_content_change: true,
          profile_version: 1,
          ready_photo_ids: [readyPhotoId],
        },
        {
          profile_id: "70000000-0000-4000-8000-000000000001",
          has_unpublished_content_change: true,
          profile_version: 1,
          ready_photo_ids: [readyPhotoId],
        },
      ],
    ],
    [
      "is not a boolean",
      [
        {
          profile_id: "70000000-0000-4000-8000-000000000001",
          has_unpublished_content_change: "true",
          profile_version: 1,
          ready_photo_ids: [readyPhotoId],
        },
      ],
    ],
  ])(
    "refuses an unpublished Content Change answer that %s",
    async (_, answer) => {
      await expect(
        loadProviderProfile({
          profile: {
            current_publication_id: "74000000-0000-4000-8000-000000000001",
          },
          rpc: vi.fn(() => result(answer)),
        }),
      ).rejects.toThrow(
        "Cottage Profile unpublished Content Change data is invalid",
      );
    },
  );

  describe("refuses an unpublished Content Change answer judged against another Cottage Profile version", () => {
    const profileId = "70000000-0000-4000-8000-000000000001";
    const profile = {
      current_publication_id: "74000000-0000-4000-8000-000000000001",
      version: 2,
    };
    const answer = (readyPhotoIds: string[]) => [
      {
        profile_id: profileId,
        has_unpublished_content_change: false,
        profile_version: 3,
        ready_photo_ids: readyPhotoIds,
      },
    ];

    it("on the single-profile path", async () => {
      await expect(
        loadProviderProfile({
          profile,
          rpc: vi.fn(() => result(answer([readyPhotoId]))),
        }),
      ).rejects.toThrow("Cottage Profile changed while it was being read");
    });

    it("on the list path", async () => {
      const client = {
        from: vi.fn(() => ({
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({ order: vi.fn(() => result([])) }),
            }),
          }),
        })),
        rpc: vi.fn((functionName: string) =>
          result(
            functionName === "list_owner_cottage_profiles"
              ? [
                  {
                    id: profileId,
                    submitted_source_revision_id: null,
                    ...profile,
                  },
                ]
              : answer([]),
          ),
        ),
      } as unknown as SupabaseClient;

      await expect(
        new SupabaseCottageProfileRepository(client, client).listOwner(),
      ).rejects.toThrow("Cottage Profile changed while it was being read");
    });
  });

  describe("refuses an unpublished Content Change answer judged against another photo set", () => {
    const profileId = "70000000-0000-4000-8000-000000000001";
    const otherPhotoId = "71000000-0000-4000-8000-000000000002";
    const published = {
      current_publication_id: "74000000-0000-4000-8000-000000000001",
    };
    const answer = (readyPhotoIds: string[]) => [
      {
        profile_id: profileId,
        has_unpublished_content_change: true,
        profile_version: 1,
        ready_photo_ids: readyPhotoIds,
      },
    ];
    const listOwnerHolding = (
      heldPhotos: { id: string; state: string }[],
      readyPhotoIds: string[],
    ) => {
      const client = {
        from: vi.fn(() => ({
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn(() =>
                  result(
                    heldPhotos.map((photo) => ({
                      profile_id: profileId,
                      original_filename: "cottage.webp",
                      media_type: "image/webp",
                      size_bytes: 128,
                      updated_at: "2026-08-17T09:05:00.000Z",
                      ...photo,
                    })),
                  ),
                ),
              }),
            }),
          }),
        })),
        rpc: vi.fn((functionName: string) =>
          result(
            functionName === "list_owner_cottage_profiles"
              ? [
                  {
                    id: profileId,
                    owner_user_id: "10000000-0000-4000-8000-000000000701",
                    application_id: null,
                    status: "draft",
                    version: 1,
                    amenities: ["garden"],
                    source_language: "en",
                    submitted_source_revision_id: null,
                    updated_at: "2026-08-17T09:15:00.000Z",
                    ...published,
                  },
                ]
              : answer(readyPhotoIds),
          ),
        ),
      } as unknown as SupabaseClient;
      return new SupabaseCottageProfileRepository(client, client).listOwner();
    };

    it("on the single-profile path", async () => {
      await expect(
        loadProviderProfile({
          profile: published,
          rpc: vi.fn(() => result(answer([]))),
        }),
      ).rejects.toThrow("Cottage Profile changed while it was being read");
    });

    it("on the list path", async () => {
      await expect(
        listOwnerHolding(
          [
            { id: readyPhotoId, state: "ready" },
            { id: otherPhotoId, state: "ready" },
          ],
          [readyPhotoId],
        ),
      ).rejects.toThrow("Cottage Profile changed while it was being read");
    });

    it("accepts the same ready photos in another order", async () => {
      await expect(
        listOwnerHolding(
          [
            { id: readyPhotoId, state: "ready" },
            { id: otherPhotoId, state: "ready" },
          ],
          [otherPhotoId, readyPhotoId],
        ),
      ).resolves.toMatchObject([{ hasUnpublishedContentChange: true }]);
    });

    it("ignores a held photo that is not ready", async () => {
      await expect(
        listOwnerHolding(
          [
            { id: readyPhotoId, state: "ready" },
            { id: otherPhotoId, state: "pending" },
          ],
          [readyPhotoId],
        ),
      ).resolves.toMatchObject([{ hasUnpublishedContentChange: true }]);
    });
  });

  it.each([
    ["omitted", undefined],
    ["a list holding a non-string", [readyPhotoId, 7]],
  ])(
    "refuses an unpublished Content Change answer without a list of ready photo ids (%s)",
    async (_, readyPhotoIds) => {
      await expect(
        loadProviderProfile({
          profile: {
            current_publication_id: "74000000-0000-4000-8000-000000000001",
          },
          rpc: vi.fn(() =>
            result([
              {
                profile_id: "70000000-0000-4000-8000-000000000001",
                has_unpublished_content_change: true,
                profile_version: 1,
                ready_photo_ids: readyPhotoIds,
              },
            ]),
          ),
        }),
      ).rejects.toThrow(
        "Cottage Profile unpublished Content Change data is invalid",
      );
    },
  );

  it.each([
    ["omitted", undefined],
    ["text", "1"],
  ])(
    "refuses an unpublished Content Change answer without a numeric Cottage Profile version (%s)",
    async (_, profileVersion) => {
      await expect(
        loadProviderProfile({
          profile: {
            current_publication_id: "74000000-0000-4000-8000-000000000001",
          },
          rpc: vi.fn(() =>
            result([
              {
                profile_id: "70000000-0000-4000-8000-000000000001",
                has_unpublished_content_change: true,
                profile_version: profileVersion,
                ready_photo_ids: [readyPhotoId],
              },
            ]),
          ),
        }),
      ).rejects.toThrow(
        "Cottage Profile unpublished Content Change data is invalid",
      );
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

  it.each([
    {
      contextName: "approved owner",
      ownerContext: {
        user_id: "10000000-0000-4000-8000-000000000701",
        role: "cottage_owner",
        owner_approval_state: "approved",
      },
      eligible: true,
    },
    {
      contextName: "expired owner",
      ownerContext: {
        user_id: "10000000-0000-4000-8000-000000000701",
        role: "cottage_owner",
        owner_approval_state: "expired",
      },
      eligible: false,
    },
    {
      contextName: "non-owner",
      ownerContext: {
        user_id: "10000000-0000-4000-8000-000000000701",
        role: "customer",
        owner_approval_state: null,
      },
      eligible: false,
    },
  ] as const)(
    "maps a $contextName context to lifecycle eligibility=$eligible",
    async ({ ownerContext, eligible }) => {
      const client = {
        from: vi.fn(() => ({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn(() => result({ owner_context: ownerContext })),
            }),
          }),
        })),
      } as unknown as SupabaseClient;

      await expect(
        new SupabaseCottageProfileRepository(
          client,
          client,
        ).canAdministratorManageLifecycle(
          "70000000-0000-4000-8000-000000000001",
        ),
      ).resolves.toBe(eligible);
    },
  );

  it("treats a missing Cottage Profile as ineligible", async () => {
    const client = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn(() => result(null)),
          }),
        }),
      })),
    } as unknown as SupabaseClient;

    await expect(
      new SupabaseCottageProfileRepository(
        client,
        client,
      ).canAdministratorManageLifecycle("70000000-0000-4000-8000-000000000001"),
    ).resolves.toBe(false);
  });

  it("fails closed when lifecycle eligibility provider data is unavailable or malformed", async () => {
    const unavailableClient = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn(() => result(null, new Error("unavailable"))),
          }),
        }),
      })),
    } as unknown as SupabaseClient;
    const malformedClient = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn(() =>
              result({
                owner_context: {
                  user_id: "10000000-0000-4000-8000-000000000701",
                  role: "cottage_owner",
                  owner_approval_state: "unknown",
                },
              }),
            ),
          }),
        }),
      })),
    } as unknown as SupabaseClient;

    await expect(
      new SupabaseCottageProfileRepository(
        unavailableClient,
        unavailableClient,
      ).canAdministratorManageLifecycle("70000000-0000-4000-8000-000000000001"),
    ).rejects.toThrow("Cottage Profile provider is unavailable");
    await expect(
      new SupabaseCottageProfileRepository(
        malformedClient,
        malformedClient,
      ).canAdministratorManageLifecycle("70000000-0000-4000-8000-000000000001"),
    ).rejects.toThrow("Cottage Profile lifecycle eligibility is invalid");
  });

  it("requires the canonical Account Context identity shape for lifecycle eligibility", async () => {
    const client = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn(() =>
              result({
                owner_context: {
                  role: "cottage_owner",
                  owner_approval_state: "approved",
                },
              }),
            ),
          }),
        }),
      })),
    } as unknown as SupabaseClient;

    await expect(
      new SupabaseCottageProfileRepository(
        client,
        client,
      ).canAdministratorManageLifecycle("70000000-0000-4000-8000-000000000001"),
    ).rejects.toThrow("Cottage Profile lifecycle eligibility is invalid");
  });
});

it("preserves profile operation outcomes through the real adapter", async () => {
  type ProfileService = ReturnType<typeof createCottageProfile>;
  const profileId = "70000000-0000-4000-8000-000000000001";
  const publicationId = "72000000-0000-4000-8000-000000000001";
  const reason = "Correct content";
  const version = { target_profile_id: profileId, target_expected_version: 2 };
  const lifecycle = { ...version, requested_reason: reason };
  const visibility = {
    target_profile_id: profileId,
    target_publication_id: publicationId,
    requested_hidden: true,
    requested_reason: reason,
  };
  const values = {
    name: "Cottage",
    governorate: "Erbil",
    approximateLocation: "Shaqlawa",
    exactAddress: "",
    exactLatitude: null,
    exactLongitude: null,
    privateDirections: "",
    capacity: 8,
    bedrooms: 3,
    bathrooms: 2,
    amenities: ["garden"],
    sourceLanguage: "en",
    description: "Description",
    houseRules: "Rules",
  };
  const requestedValues = {
    requested_name: "Cottage",
    requested_governorate: "Erbil",
    requested_approximate_location: "Shaqlawa",
    requested_exact_address: "",
    requested_exact_latitude: null,
    requested_exact_longitude: null,
    requested_private_directions: "",
    requested_capacity: 8,
    requested_bedrooms: 3,
    requested_bathrooms: 2,
    requested_amenities: ["garden"],
    requested_source_language: "en",
    requested_description: "Description",
    requested_house_rules: "Rules",
  };
  const file = {
    name: "cottage.webp",
    type: "image/webp",
    size: 12,
    bytes: new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
    ]),
  };
  const operations = {
    abandonAdministrator: {
      run: (service: ProfileService) =>
        service.abandonAdministrator(profileId, 2, reason),
      call: ["abandon_administrator_cottage_profile_draft", lifecycle],
    },
    restoreAdministrator: {
      run: (service: ProfileService) =>
        service.restoreAdministrator(profileId, 2, reason),
      call: ["restore_administrator_cottage_profile_draft", lifecycle],
    },
    setAdministratorDescriptionHidden: {
      run: (service: ProfileService) =>
        service.setAdministratorDescriptionHidden(
          profileId,
          publicationId,
          true,
          reason,
        ),
      call: ["set_administrator_cottage_description_hidden", visibility],
    },
    setAdministratorPhotoHidden: {
      run: (service: ProfileService) =>
        service.setAdministratorPhotoHidden(
          profileId,
          publicationId,
          readyPhotoId,
          true,
          reason,
        ),
      call: [
        "set_administrator_cottage_photo_hidden",
        { ...visibility, target_photo_id: readyPhotoId },
      ],
    },
    updateOwner: {
      run: (service: ProfileService) =>
        service.saveOwnerDraft(profileId, 2, values),
      call: [
        "update_owner_cottage_profile_draft",
        { ...version, ...requestedValues },
      ],
    },
    abandonOwner: {
      run: (service: ProfileService) => service.abandonOwner(profileId, 2),
      call: ["abandon_owner_cottage_profile_draft", version],
    },
    updateAdministrator: {
      run: (service: ProfileService) =>
        service.saveAdministratorDraft(profileId, 2, values, reason),
      call: [
        "update_administrator_cottage_profile",
        { ...lifecycle, ...requestedValues },
      ],
    },
    createDraft: {
      run: (service: ProfileService) => service.createDraft(),
      call: ["create_owner_cottage_profile_draft"],
    },
    submit: {
      run: (service: ProfileService) => service.submit(profileId, 2),
      call: ["submit_cottage_profile_for_content_approval", version],
    },
    preparePhotoUpload: {
      run: (service: ProfileService) =>
        service.uploadPhoto(profileId, file, reason),
      call: [
        "prepare_cottage_profile_photo_upload",
        {
          target_profile_id: profileId,
          requested_original_filename: "cottage.webp",
          requested_media_type: "image/webp",
          requested_size_bytes: 12,
          requested_reason: reason,
        },
      ],
    },
    preparePhotoPreview: {
      run: (service: ProfileService) => service.previewPhoto(readyPhotoId),
      call: [
        "prepare_cottage_profile_photo_preview",
        { target_photo_id: readyPhotoId },
      ],
    },
    preparePhotoDeletion: {
      run: (service: ProfileService) =>
        service.deletePhoto(readyPhotoId, reason),
      call: [
        "prepare_cottage_profile_photo_deletion",
        { target_photo_id: readyPhotoId, requested_reason: reason },
      ],
    },
  };
  const cases = [
    ["abandonAdministrator", "RC420", { status: "capacity_limit" }],
    ["abandonAdministrator", "RC409", { status: "conflict" }],
    ["abandonAdministrator", "RC202", { status: "denied" }],
    ["abandonAdministrator", "42501", { status: "denied" }],
    ["restoreAdministrator", "42501", { status: "denied" }],
    [
      "setAdministratorDescriptionHidden",
      "22023",
      { status: "invalid", fields: ["reason"] },
    ],
    ["setAdministratorDescriptionHidden", "42501", { status: "denied" }],
    ["setAdministratorDescriptionHidden", "RC409", { status: "conflict" }],
    ["setAdministratorDescriptionHidden", "RC203", { status: "last_photo" }],
    ["setAdministratorPhotoHidden", "42501", { status: "denied" }],
    ["updateOwner", "RC409", { status: "conflict" }],
    ["updateOwner", "RC202", { status: "denied" }],
    ["updateOwner", "42501", { status: "denied" }],
    ["abandonOwner", "42501", { status: "denied" }],
    ["updateAdministrator", "22023", { status: "invalid", fields: ["reason"] }],
    ["updateAdministrator", "RC203", { status: "incomplete" }],
    ["updateAdministrator", "RC409", { status: "conflict" }],
    ["updateAdministrator", "42501", { status: "denied" }],
    ["createDraft", "RC420", { status: "capacity_limit" }],
    ["createDraft", "RC429", { status: "rate_limit" }],
    ["createDraft", "42501", { status: "denied" }],
    ["submit", "RC203", { status: "incomplete" }],
    ["submit", "RC409", { status: "conflict" }],
    ["submit", "42501", { status: "denied" }],
    ["preparePhotoUpload", "22023", { status: "invalid", fields: ["reason"] }],
    ["preparePhotoUpload", "42501", { status: "denied" }],
    ["preparePhotoPreview", "42501", { status: "denied" }],
    [
      "preparePhotoDeletion",
      "22023",
      { status: "invalid", fields: ["reason"] },
    ],
    ["preparePhotoDeletion", "RC203", { status: "incomplete" }],
    ["preparePhotoDeletion", "42501", { status: "denied" }],
    ["updateAdministrator", "RC202", { status: "unavailable" }],
    ["createDraft", "RC409", { status: "unavailable" }],
  ] as const;
  for (const [method, code, expected] of cases) {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code } });
    const from = vi.fn();
    const privilegedRpc = vi.fn();
    const privilegedFrom = vi.fn();
    const storageFrom = vi.fn();
    const client = { rpc, from } as unknown as SupabaseClient;
    const privilegedClient = {
      rpc: privilegedRpc,
      from: privilegedFrom,
      storage: { from: storageFrom },
    } as unknown as SupabaseClient;
    const service = createCottageProfile({
      repository: new SupabaseCottageProfileRepository(
        client,
        privilegedClient,
      ),
      storage: new SupabaseCottageProfileStorage(privilegedClient),
    });
    const operation = operations[method];
    const context = `${method}: ${code}`;
    await expect(operation.run(service), context).resolves.toEqual(expected);
    expect(rpc, context).toHaveBeenCalledExactlyOnceWith(...operation.call);
    expect(from, context).not.toHaveBeenCalled();
    expect(privilegedRpc, context).not.toHaveBeenCalled();
    expect(privilegedFrom, context).not.toHaveBeenCalled();
    expect(storageFrom, context).not.toHaveBeenCalled();
  }
});
