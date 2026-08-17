import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { SupabaseCottageProfileRepository } from "./supabase-cottage-profile";

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
          eq: vi.fn().mockReturnValue({ order: vi.fn(() => photosResult) }),
        }),
      };
    }),
    rpc: vi.fn(),
  } as unknown as SupabaseClient;
  return new SupabaseCottageProfileRepository(client, client).load(profileId);
}

describe("Supabase Cottage Profile adapter", () => {
  it("loads private photos and the immutable submitted source with the working copy", async () => {
    const profileId = "70000000-0000-4000-8000-000000000001";
    const sourceRevisionId = "73000000-0000-4000-8000-000000000001";
    const profile = result({
      id: profileId,
      owner_user_id: "10000000-0000-4000-8000-000000000701",
      application_id: "20000000-0000-4000-8000-000000000701",
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
            eq: vi.fn().mockReturnValue({ order: vi.fn(() => photos) }),
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
});
