import { describe, expect, it, vi } from "vitest";

import {
  createCottageProfile,
  type CottageProfile,
  type CottageProfileRepository,
  type CottageProfileStorage,
} from "./cottage-profile";

const profileId = "70000000-0000-4000-8000-000000000001";
const ownerUserId = "10000000-0000-4000-8000-000000000701";

const draft: CottageProfile = {
  id: profileId,
  ownerUserId,
  applicationId: "20000000-0000-4000-8000-000000000701",
  status: "draft",
  version: 1,
  name: "Application Cottage",
  governorate: "Erbil",
  approximateLocation: "Near Shaqlawa",
  exactAddress: "Private application address",
  exactLatitude: null,
  exactLongitude: null,
  privateDirections: "",
  capacity: 8,
  bedrooms: 3,
  bathrooms: 2,
  amenities: ["garden"],
  sourceLanguage: null,
  description: "Application source description",
  houseRules: "Application source rules",
  photos: [],
  submittedSourceRevision: null,
  updatedAt: "2026-08-17T09:00:00.000Z",
};

function setup() {
  let profiles = [draft];
  let stored = profiles[0];
  const uploadedObjects: string[] = [];
  const removedObjects: string[] = [];
  const preparedPhoto = {
    photoId: "71000000-0000-4000-8000-000000000001",
    objectPath: `${ownerUserId}/${profileId}/72000000-0000-4000-8000-000000000001.webp`,
  };
  const repository: CottageProfileRepository = {
    listOwner: async () => profiles,
    listAdministrator: async () => ({ profiles, nextCursor: null }),
    load: async () => stored,
    createDraft: async () => {
      const created = {
        ...draft,
        id: "70000000-0000-4000-8000-000000000002",
        applicationId: null,
        name: "",
      };
      profiles = [stored, created];
      return created;
    },
    updateOwner: async (input) => {
      stored = {
        ...stored,
        ...input.values,
        version: stored.version + 1,
      };
      return stored;
    },
    updateAdministrator: async (input) => {
      stored = {
        ...stored,
        ...input.values,
        version: stored.version + 1,
      };
      return stored;
    },
    submit: async () => {
      stored = {
        ...stored,
        status: "submitted_for_content_approval",
        version: stored.version + 1,
        submittedSourceRevision: {
          revision: 1,
          ownerUserId,
          sourceLanguage: "en",
          description: stored.description,
          houseRules: stored.houseRules,
          submittedAt: "2026-08-17T09:10:00.000Z",
        },
      };
      return stored;
    },
    preparePhotoUpload: async () => preparedPhoto,
    registerPhoto: async () => {
      stored = {
        ...stored,
        photos: [
          {
            id: preparedPhoto.photoId,
            originalFilename: "shaqlawa-cottage.webp",
            mediaType: "image/webp",
            sizeBytes: 12,
            state: "ready",
            updatedAt: "2026-08-17T09:05:00.000Z",
          },
        ],
      };
    },
    preparePhotoPreview: async () => preparedPhoto.objectPath,
    preparePhotoDeletion: async () => preparedPhoto.objectPath,
    completePhotoDeletion: async () => undefined,
  };
  const storage: CottageProfileStorage = {
    upload: async (objectPath) => {
      uploadedObjects.push(objectPath);
    },
    remove: async (objectPaths) => {
      removedObjects.push(...objectPaths);
    },
    createSignedUrl: async () => "https://private.example.test/photo",
  };
  return {
    cottageProfile: createCottageProfile({ repository, storage }),
    repository,
    storage,
    uploadedObjects,
    removedObjects,
  };
}

describe("Cottage Profile", () => {
  it("continues the application-linked first profile through the public use-case seam", async () => {
    const { cottageProfile } = setup();

    const saved = await cottageProfile.saveOwnerDraft(profileId, 1, {
      name: "Continued Application Cottage",
      governorate: "Erbil",
      approximateLocation: "Near Shaqlawa",
      exactAddress: "Private exact address",
      exactLatitude: "36.408333",
      exactLongitude: "44.385834",
      privateDirections: "Continue past the orchard gate.",
      capacity: "10",
      bedrooms: "4",
      bathrooms: "3",
      amenities: ["garden", "parking", "wifi"],
      sourceLanguage: "en",
      description: "Owner working-copy description",
      houseRules: "Owner working-copy House Rules",
    });

    expect(saved).toMatchObject({
      status: "saved",
      profile: {
        id: profileId,
        applicationId: draft.applicationId,
        name: "Continued Application Cottage",
        exactLatitude: 36.408333,
        exactLongitude: 44.385834,
        version: 2,
      },
    });
    await expect(cottageProfile.load(profileId)).resolves.toMatchObject({
      id: profileId,
      applicationId: draft.applicationId,
      name: "Continued Application Cottage",
      version: 2,
    });
  });

  it("uploads a validated WebP photo only after the database prepares its exact path", async () => {
    const { cottageProfile, uploadedObjects } = setup();
    const bytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ]);

    const result = await cottageProfile.uploadPhoto(profileId, {
      name: "shaqlawa-cottage.webp",
      type: "image/webp",
      size: bytes.byteLength,
      bytes,
    });

    expect(result).toEqual({
      status: "uploaded",
      photoId: "71000000-0000-4000-8000-000000000001",
    });
    expect(uploadedObjects).toEqual([
      `${ownerUserId}/${profileId}/72000000-0000-4000-8000-000000000001.webp`,
    ]);
    await expect(cottageProfile.load(profileId)).resolves.toMatchObject({
      photos: [{ state: "ready", mediaType: "image/webp" }],
    });
  });

  it.each([
    ["invalid magic bytes", 12, new Uint8Array(12)],
    [
      "a byte-length mismatch",
      13,
      new Uint8Array([
        0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
      ]),
    ],
  ])("rejects %s before preparing private storage", async (_, size, bytes) => {
    const { cottageProfile, repository } = setup();
    const prepare = vi.spyOn(repository, "preparePhotoUpload");

    await expect(
      cottageProfile.uploadPhoto(profileId, {
        name: "invalid.webp",
        type: "image/webp",
        size,
        bytes,
      }),
    ).resolves.toEqual({ status: "invalid_photo" });
    expect(prepare).not.toHaveBeenCalled();
  });

  it.each([
    ["storage upload", "upload_reconciliation_required"],
    ["photo registration", "registration_reconciliation_required"],
  ] as const)(
    "reports durable reconciliation when %s fails",
    async (failure, status) => {
      const { cottageProfile, repository, storage } = setup();
      const bytes = new Uint8Array([
        0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
      ]);
      if (failure === "photo registration") {
        vi.spyOn(repository, "registerPhoto").mockRejectedValueOnce(
          new Error("registration unavailable"),
        );
      } else {
        vi.spyOn(storage, "upload").mockRejectedValueOnce(
          new Error("storage unavailable"),
        );
      }
      const result = await cottageProfile.uploadPhoto(profileId, {
        name: "cottage.webp",
        type: "image/webp",
        size: bytes.byteLength,
        bytes,
      });

      expect(result.status).toBe(status);
    },
  );

  it("returns the submitted profile with its immutable owner source", async () => {
    const { cottageProfile } = setup();

    const result = await cottageProfile.submit(profileId, 1);

    expect(result).toMatchObject({
      status: "submitted",
      profile: {
        id: profileId,
        status: "submitted_for_content_approval",
        version: 2,
        submittedSourceRevision: {
          revision: 1,
          ownerUserId,
          description: "Application source description",
          houseRules: "Application source rules",
        },
      },
    });
  });

  it("creates an additional draft without replacing the application profile", async () => {
    const { cottageProfile } = setup();

    const created = await cottageProfile.createDraft();

    expect(created).toMatchObject({
      status: "created",
      profile: { applicationId: null, status: "draft" },
    });
    await expect(cottageProfile.listOwner()).resolves.toMatchObject([
      { id: profileId, applicationId: draft.applicationId },
      {
        id: "70000000-0000-4000-8000-000000000002",
        applicationId: null,
      },
    ]);
  });

  it("previews and deletes a photo only through prepared private storage paths", async () => {
    const { cottageProfile, removedObjects } = setup();
    const photoId = "71000000-0000-4000-8000-000000000001";

    await expect(cottageProfile.previewPhoto(photoId)).resolves.toEqual({
      status: "ready",
      url: "https://private.example.test/photo",
      expiresInSeconds: 60,
    });
    await expect(cottageProfile.deletePhoto(photoId)).resolves.toEqual({
      status: "deleted",
    });
    expect(removedObjects).toEqual([
      `${ownerUserId}/${profileId}/72000000-0000-4000-8000-000000000001.webp`,
    ]);
  });

  it.each(["storage removal", "metadata completion"] as const)(
    "keeps a durable deletion-pending result when %s fails",
    async (failure) => {
      const { cottageProfile, repository, storage } = setup();
      if (failure === "storage removal") {
        vi.spyOn(storage, "remove").mockRejectedValueOnce(
          new Error("storage unavailable"),
        );
      } else {
        vi.spyOn(repository, "completePhotoDeletion").mockRejectedValueOnce(
          new Error("database unavailable"),
        );
      }

      await expect(
        cottageProfile.deletePhoto("71000000-0000-4000-8000-000000000001"),
      ).resolves.toEqual({ status: "deletion_reconciliation_required" });
    },
  );

  it("lets an owner recover a pending upload through the authorized deletion seam", async () => {
    const { cottageProfile, repository, storage } = setup();
    vi.spyOn(storage, "upload").mockRejectedValueOnce(
      new Error("storage unavailable"),
    );
    const prepareDeletion = vi.spyOn(repository, "preparePhotoDeletion");
    const completeDeletion = vi.spyOn(repository, "completePhotoDeletion");
    const bytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ]);

    const failedUpload = await cottageProfile.uploadPhoto(profileId, {
      name: "cottage.webp",
      type: "image/webp",
      size: bytes.byteLength,
      bytes,
    });
    expect(failedUpload).toEqual({
      status: "upload_reconciliation_required",
      photoId: "71000000-0000-4000-8000-000000000001",
    });
    if (failedUpload.status !== "upload_reconciliation_required") {
      throw new Error("Expected a recoverable pending photo");
    }

    await expect(
      cottageProfile.deletePhoto(failedUpload.photoId),
    ).resolves.toEqual({ status: "deleted" });
    expect(prepareDeletion).toHaveBeenCalledWith(failedUpload.photoId);
    expect(completeDeletion).toHaveBeenCalledWith(failedUpload.photoId);
  });

  it("keeps submitted owner source unchanged when an administrator edits the working copy", async () => {
    const { cottageProfile } = setup();
    await cottageProfile.submit(profileId, 1);

    const result = await cottageProfile.saveAdministratorDraft(profileId, 2, {
      name: "Administrator working copy",
      governorate: "Erbil",
      approximateLocation: "Near Shaqlawa",
      exactAddress: "Private exact address",
      exactLatitude: "36.408333",
      exactLongitude: "44.385834",
      privateDirections: "Administrator directions",
      capacity: "10",
      bedrooms: "4",
      bathrooms: "3",
      amenities: ["garden", "wifi"],
      sourceLanguage: "en",
      description: "Administrator working-copy description",
      houseRules: "Administrator working-copy rules",
    });

    expect(result).toMatchObject({
      status: "saved",
      profile: {
        version: 3,
        description: "Administrator working-copy description",
        submittedSourceRevision: {
          description: "Application source description",
          houseRules: "Application source rules",
        },
      },
    });
  });

  it("reports when an administrator edit would make a submitted profile incomplete", async () => {
    const { cottageProfile, repository } = setup();
    vi.spyOn(repository, "updateAdministrator").mockRejectedValue({
      code: "RC203",
    });

    await expect(
      cottageProfile.saveAdministratorDraft(profileId, 2, {
        name: "Administrator working copy",
        governorate: "Erbil",
        approximateLocation: "Near Shaqlawa",
        exactAddress: "Private exact address",
        exactLatitude: "36.408333",
        exactLongitude: "44.385834",
        privateDirections: "Administrator directions",
        capacity: "10",
        bedrooms: "4",
        bathrooms: "3",
        amenities: ["garden", "wifi"],
        sourceLanguage: "en",
        description: "Administrator working-copy description",
        houseRules: "Administrator working-copy rules",
      }),
    ).resolves.toEqual({ status: "incomplete" });
  });

  it("does not start storage deletion when a submitted profile must retain its photo", async () => {
    const { cottageProfile, repository, removedObjects } = setup();
    vi.spyOn(repository, "preparePhotoDeletion").mockRejectedValue({
      code: "RC203",
    });

    await expect(
      cottageProfile.deletePhoto("71000000-0000-4000-8000-000000000001"),
    ).resolves.toEqual({ status: "incomplete" });
    expect(removedObjects).toEqual([]);
  });

  it("returns an owner-visible conflict when a draft version is stale", async () => {
    const { cottageProfile, repository } = setup();
    vi.spyOn(repository, "updateOwner").mockRejectedValue({ code: "RC409" });

    await expect(
      cottageProfile.saveOwnerDraft(profileId, 1, {
        name: "Stale Cottage",
        governorate: "Erbil",
        approximateLocation: "Near Shaqlawa",
        exactAddress: "Private exact address",
        exactLatitude: "36.408333",
        exactLongitude: "44.385834",
        privateDirections: "Directions",
        capacity: "10",
        bedrooms: "4",
        bathrooms: "3",
        amenities: ["wifi"],
        sourceLanguage: "en",
        description: "Description",
        houseRules: "Rules",
      }),
    ).resolves.toEqual({ status: "conflict" });
  });
});
