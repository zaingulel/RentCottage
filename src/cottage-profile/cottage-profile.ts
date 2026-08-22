export const cottageProfileAmenities = [
  "garden",
  "parking",
  "pool",
  "air_conditioning",
  "wifi",
  "outdoor_seating",
] as const;
export type CottageProfileAmenity = (typeof cottageProfileAmenities)[number];

export const cottageProfileSourceLanguages = ["ar", "ckb", "en"] as const;
export const cottageProfilePhotoMediaTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export const cottageProfilePhotoBucketName = "cottage-profile-photos";
export const cottageProfileMaximumPhotoBytes = 5_242_880;
export const cottageProfileMaximumPhotos = 12;
export const cottageProfileMaximumPhotoFilenameLength = 180;
export const cottageProfileMaximumLengths = {
  name: 120,
  governorate: 120,
  approximateLocation: 240,
  exactAddress: 240,
  privateDirections: 1000,
  description: 2000,
  houseRules: 1500,
} as const;
export const cottageProfileNumberRanges = {
  exactLatitude: { minimum: -90, maximum: 90 },
  exactLongitude: { minimum: -180, maximum: 180 },
  capacity: { minimum: 1, maximum: 100 },
  bedrooms: { minimum: 1, maximum: 50 },
  bathrooms: { minimum: 1, maximum: 50 },
} as const;

export type CottageProfileStatus =
  | "draft"
  | "submitted_for_content_approval"
  | "abandoned";
export type CottageProfileSourceLanguage =
  (typeof cottageProfileSourceLanguages)[number];
export type CottageProfilePhotoState = "pending" | "ready" | "deletion_pending";

export interface CottageProfilePhoto {
  id: string;
  originalFilename: string;
  mediaType: string;
  sizeBytes: number;
  state: CottageProfilePhotoState;
  updatedAt: string;
}

export interface CottageProfileSourceRevision {
  revision: number;
  ownerUserId: string;
  sourceLanguage: CottageProfileSourceLanguage;
  description: string;
  houseRules: string;
  submittedAt: string;
}

export interface CottageProfile {
  id: string;
  ownerUserId: string;
  applicationId: string | null;
  currentPublicationId: string | null;
  status: CottageProfileStatus;
  version: number;
  name: string;
  governorate: string;
  approximateLocation: string;
  exactAddress: string;
  exactLatitude: number | null;
  exactLongitude: number | null;
  privateDirections: string;
  capacity: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  amenities: string[];
  sourceLanguage: CottageProfileSourceLanguage | null;
  description: string;
  houseRules: string;
  photos: CottageProfilePhoto[];
  submittedSourceRevision: CottageProfileSourceRevision | null;
  updatedAt: string;
}

export interface CottageProfileDraftValues {
  name: string;
  governorate: string;
  approximateLocation: string;
  exactAddress: string;
  exactLatitude: number | null;
  exactLongitude: number | null;
  privateDirections: string;
  capacity: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  amenities: string[];
  sourceLanguage: CottageProfileSourceLanguage | null;
  description: string;
  houseRules: string;
}

export interface PreparedCottageProfilePhoto {
  photoId: string;
  objectPath: string;
}

export interface PreparedCottageProfilePhotoDeletion {
  objectPath: string;
  disposition: "delete" | "retain";
}

export interface CottageProfileAdministratorCursor {
  updatedAt: string;
  profileId: string;
}

export interface CottageProfileAdministratorPage {
  profiles: CottageProfile[];
  nextCursor: CottageProfileAdministratorCursor | null;
}

export interface CottageProfileRepository {
  listOwner(): Promise<CottageProfile[]>;
  listAdministrator(
    cursor?: CottageProfileAdministratorCursor,
  ): Promise<CottageProfileAdministratorPage>;
  canAdministratorManageLifecycle(profileId: string): Promise<boolean>;
  load(profileId: string): Promise<CottageProfile | null>;
  createDraft(): Promise<CottageProfile>;
  abandonOwner(input: {
    profileId: string;
    expectedVersion: number;
  }): Promise<CottageProfile>;
  abandonAdministrator(input: {
    profileId: string;
    expectedVersion: number;
    reason: string;
  }): Promise<CottageProfile>;
  restoreAdministrator(input: {
    profileId: string;
    expectedVersion: number;
    reason: string;
  }): Promise<CottageProfile>;
  updateOwner(input: {
    profileId: string;
    expectedVersion: number;
    values: CottageProfileDraftValues;
  }): Promise<CottageProfile>;
  updateAdministrator(input: {
    profileId: string;
    expectedVersion: number;
    values: CottageProfileDraftValues;
  }): Promise<CottageProfile>;
  submit(profileId: string, expectedVersion: number): Promise<CottageProfile>;
  preparePhotoUpload(input: {
    profileId: string;
    originalFilename: string;
    mediaType: string;
    sizeBytes: number;
  }): Promise<PreparedCottageProfilePhoto>;
  registerPhoto(photoId: string): Promise<void>;
  preparePhotoPreview(photoId: string): Promise<string>;
  preparePhotoDeletion(
    photoId: string,
  ): Promise<PreparedCottageProfilePhotoDeletion>;
  completePhotoDeletion(photoId: string): Promise<void>;
}

export interface CottageProfileUpload {
  name: string;
  type: string;
  size: number;
  bytes: Uint8Array;
}

export interface CottageProfileStorage {
  upload(objectPath: string, file: CottageProfileUpload): Promise<void>;
  remove(objectPaths: string[]): Promise<void>;
  createSignedUrl(
    objectPath: string,
    expiresInSeconds: number,
  ): Promise<string>;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const knownAmenities = new Set<string>(cottageProfileAmenities);
const photoExtensions = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  integer = false,
) {
  if (value === "" || value === null || value === undefined) {
    return { value: null, valid: true };
  }
  const parsed = typeof value === "number" ? value : Number(text(value));
  return {
    value: Number.isFinite(parsed) ? parsed : null,
    valid:
      Number.isFinite(parsed) &&
      parsed >= minimum &&
      parsed <= maximum &&
      (!integer || Number.isInteger(parsed)),
  };
}

function parseDraftValues(
  value: unknown,
):
  | { status: "valid"; values: CottageProfileDraftValues }
  | { status: "invalid"; fields: string[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { status: "invalid", fields: ["profile"] };
  }
  const input = value as Record<string, unknown>;
  const invalid: string[] = [];
  for (const [field, maximum] of Object.entries(cottageProfileMaximumLengths)) {
    if (text(input[field]).length > maximum) invalid.push(field);
  }
  const exactLatitude = optionalNumber(
    input.exactLatitude,
    cottageProfileNumberRanges.exactLatitude.minimum,
    cottageProfileNumberRanges.exactLatitude.maximum,
  );
  const exactLongitude = optionalNumber(
    input.exactLongitude,
    cottageProfileNumberRanges.exactLongitude.minimum,
    cottageProfileNumberRanges.exactLongitude.maximum,
  );
  const capacity = optionalNumber(
    input.capacity,
    cottageProfileNumberRanges.capacity.minimum,
    cottageProfileNumberRanges.capacity.maximum,
    true,
  );
  const bedrooms = optionalNumber(
    input.bedrooms,
    cottageProfileNumberRanges.bedrooms.minimum,
    cottageProfileNumberRanges.bedrooms.maximum,
    true,
  );
  const bathrooms = optionalNumber(
    input.bathrooms,
    cottageProfileNumberRanges.bathrooms.minimum,
    cottageProfileNumberRanges.bathrooms.maximum,
    true,
  );
  for (const [field, parsed] of Object.entries({
    exactLatitude,
    exactLongitude,
    capacity,
    bedrooms,
    bathrooms,
  })) {
    if (!parsed.valid) invalid.push(field);
  }
  if ((exactLatitude.value === null) !== (exactLongitude.value === null)) {
    invalid.push("exactLatitude", "exactLongitude");
  }
  const amenities = Array.isArray(input.amenities)
    ? [...new Set(input.amenities.map(text).filter(Boolean))]
    : [];
  if (amenities.some((amenity) => !knownAmenities.has(amenity))) {
    invalid.push("amenities");
  }
  const sourceLanguage = input.sourceLanguage;
  if (
    sourceLanguage !== "" &&
    sourceLanguage !== null &&
    sourceLanguage !== undefined &&
    !cottageProfileSourceLanguages.includes(
      sourceLanguage as CottageProfileSourceLanguage,
    )
  ) {
    invalid.push("sourceLanguage");
  }
  if (invalid.length > 0) {
    return { status: "invalid", fields: [...new Set(invalid)] };
  }
  return {
    status: "valid",
    values: {
      name: text(input.name),
      governorate: text(input.governorate),
      approximateLocation: text(input.approximateLocation),
      exactAddress: text(input.exactAddress),
      exactLatitude: exactLatitude.value,
      exactLongitude: exactLongitude.value,
      privateDirections: text(input.privateDirections),
      capacity: capacity.value,
      bedrooms: bedrooms.value,
      bathrooms: bathrooms.value,
      amenities,
      sourceLanguage:
        sourceLanguage === "ar" ||
        sourceLanguage === "ckb" ||
        sourceLanguage === "en"
          ? sourceLanguage
          : null,
      description: text(input.description),
      houseRules: text(input.houseRules),
    },
  };
}

function photoBytesMatchMediaType(
  bytes: Uint8Array,
  mediaType: string,
): boolean {
  if (mediaType === "image/png") {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return signature.every((byte, index) => bytes[index] === byte);
  }
  if (mediaType === "image/webp") {
    return (
      bytes.length >= 12 &&
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    );
  }
  return (
    mediaType === "image/jpeg" &&
    bytes.length >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  );
}

function providerErrorCode(error: unknown): string | undefined {
  let candidate = error;
  for (let depth = 0; depth <= 8; depth += 1) {
    if (!candidate || typeof candidate !== "object") return undefined;
    const providerError = candidate as { code?: unknown; cause?: unknown };
    if (typeof providerError.code === "string") return providerError.code;
    candidate = providerError.cause;
  }
  return undefined;
}

async function administratorLifecycle(
  lifecycle: (input: {
    profileId: string;
    expectedVersion: number;
    reason: string;
  }) => Promise<CottageProfile>,
  expectedStatus: "draft" | "abandoned",
  profileId: string,
  expectedVersion: number,
  reasonValue: unknown,
) {
  const reason = text(reasonValue);
  if (
    !uuidPattern.test(profileId) ||
    !Number.isInteger(expectedVersion) ||
    expectedVersion < 1 ||
    reason.length < 1 ||
    reason.length > 1000
  ) {
    return { status: "invalid" as const, fields: ["reason"] };
  }
  try {
    const profile = await lifecycle({ profileId, expectedVersion, reason });
    return profile.status === expectedStatus
      ? {
          status:
            expectedStatus === "abandoned"
              ? ("abandoned" as const)
              : ("restored" as const),
          profile,
        }
      : { status: "unavailable" as const };
  } catch (error) {
    const code = providerErrorCode(error);
    if (code === "RC420") return { status: "capacity_limit" as const };
    if (code === "RC409") return { status: "conflict" as const };
    if (code === "RC202" || code === "42501")
      return { status: "denied" as const };
    return { status: "unavailable" as const };
  }
}

export function createCottageProfile({
  repository,
  storage,
}: {
  repository: CottageProfileRepository;
  storage: CottageProfileStorage;
}) {
  return {
    listOwner: () => repository.listOwner(),
    listAdministrator: (cursor?: CottageProfileAdministratorCursor) =>
      repository.listAdministrator(cursor),
    canAdministratorManageLifecycle(profileId: string) {
      if (!uuidPattern.test(profileId)) return Promise.resolve(false);
      return repository.canAdministratorManageLifecycle(profileId);
    },

    load(profileId: string) {
      if (!uuidPattern.test(profileId)) return Promise.resolve(null);
      return repository.load(profileId);
    },

    async saveOwnerDraft(
      profileId: string,
      expectedVersion: number,
      value: unknown,
    ) {
      const parsed = parseDraftValues(value);
      if (
        parsed.status === "invalid" ||
        !uuidPattern.test(profileId) ||
        !Number.isInteger(expectedVersion) ||
        expectedVersion < 1
      ) {
        return {
          status: "invalid" as const,
          fields:
            parsed.status === "invalid" ? parsed.fields : ["profileVersion"],
        };
      }
      try {
        const profile = await repository.updateOwner({
          profileId,
          expectedVersion,
          values: parsed.values,
        });
        return { status: "saved" as const, profile };
      } catch (error) {
        const code = providerErrorCode(error);
        if (code === "RC409") return { status: "conflict" as const };
        if (code === "RC202" || code === "42501") {
          return { status: "denied" as const };
        }
        return { status: "unavailable" as const };
      }
    },

    async saveAdministratorDraft(
      profileId: string,
      expectedVersion: number,
      value: unknown,
    ) {
      const parsed = parseDraftValues(value);
      if (
        parsed.status === "invalid" ||
        !uuidPattern.test(profileId) ||
        !Number.isInteger(expectedVersion) ||
        expectedVersion < 1
      ) {
        return {
          status: "invalid" as const,
          fields:
            parsed.status === "invalid" ? parsed.fields : ["profileVersion"],
        };
      }
      try {
        const profile = await repository.updateAdministrator({
          profileId,
          expectedVersion,
          values: parsed.values,
        });
        return { status: "saved" as const, profile };
      } catch (error) {
        const code = providerErrorCode(error);
        if (code === "RC203") return { status: "incomplete" as const };
        if (code === "RC409") return { status: "conflict" as const };
        if (code === "42501") return { status: "denied" as const };
        return { status: "unavailable" as const };
      }
    },

    async createDraft() {
      try {
        const profile = await repository.createDraft();
        return { status: "created" as const, profile };
      } catch (error) {
        const code = providerErrorCode(error);
        return {
          status:
            code === "RC420"
              ? ("capacity_limit" as const)
              : code === "RC429"
                ? ("rate_limit" as const)
                : code === "42501"
                  ? ("denied" as const)
                  : ("unavailable" as const),
        };
      }
    },

    async abandonOwner(profileId: string, expectedVersion: number) {
      if (
        !uuidPattern.test(profileId) ||
        !Number.isInteger(expectedVersion) ||
        expectedVersion < 1
      ) {
        return { status: "invalid" as const };
      }
      try {
        const profile = await repository.abandonOwner({
          profileId,
          expectedVersion,
        });
        return profile.status === "abandoned"
          ? { status: "abandoned" as const, profile }
          : { status: "unavailable" as const };
      } catch (error) {
        const code = providerErrorCode(error);
        if (code === "RC409") return { status: "conflict" as const };
        if (code === "RC202" || code === "42501")
          return { status: "denied" as const };
        return { status: "unavailable" as const };
      }
    },

    async abandonAdministrator(
      profileId: string,
      expectedVersion: number,
      reasonValue: unknown,
    ) {
      return administratorLifecycle(
        repository.abandonAdministrator.bind(repository),
        "abandoned",
        profileId,
        expectedVersion,
        reasonValue,
      );
    },

    async restoreAdministrator(
      profileId: string,
      expectedVersion: number,
      reasonValue: unknown,
    ) {
      return administratorLifecycle(
        repository.restoreAdministrator.bind(repository),
        "draft",
        profileId,
        expectedVersion,
        reasonValue,
      );
    },

    async uploadPhoto(profileId: string, file: CottageProfileUpload) {
      if (
        !uuidPattern.test(profileId) ||
        !photoExtensions.has(file.type) ||
        !Number.isInteger(file.size) ||
        file.size < 1 ||
        file.size > cottageProfileMaximumPhotoBytes ||
        file.bytes.byteLength !== file.size ||
        file.name.trim().length < 1 ||
        file.name.trim().length > cottageProfileMaximumPhotoFilenameLength ||
        !photoBytesMatchMediaType(file.bytes, file.type)
      ) {
        return { status: "invalid_photo" as const };
      }

      let prepared: PreparedCottageProfilePhoto;
      try {
        prepared = await repository.preparePhotoUpload({
          profileId,
          originalFilename: file.name.trim(),
          mediaType: file.type,
          sizeBytes: file.size,
        });
      } catch {
        return { status: "unavailable" as const };
      }
      try {
        await storage.upload(prepared.objectPath, {
          ...file,
          name: file.name.trim(),
        });
      } catch {
        return {
          status: "upload_reconciliation_required" as const,
          photoId: prepared.photoId,
        };
      }
      try {
        await repository.registerPhoto(prepared.photoId);
      } catch {
        return {
          status: "registration_reconciliation_required" as const,
          photoId: prepared.photoId,
        };
      }
      return { status: "uploaded" as const, photoId: prepared.photoId };
    },

    async previewPhoto(photoId: string) {
      if (!uuidPattern.test(photoId)) return { status: "denied" as const };
      let objectPath: string;
      try {
        objectPath = await repository.preparePhotoPreview(photoId);
      } catch (error) {
        return {
          status:
            providerErrorCode(error) === "42501"
              ? ("denied" as const)
              : ("unavailable" as const),
        };
      }
      const expiresInSeconds = 60;
      try {
        const url = await storage.createSignedUrl(objectPath, expiresInSeconds);
        return { status: "ready" as const, url, expiresInSeconds };
      } catch {
        return { status: "unavailable" as const };
      }
    },

    async deletePhoto(photoId: string) {
      if (!uuidPattern.test(photoId)) return { status: "denied" as const };
      let prepared: PreparedCottageProfilePhotoDeletion;
      try {
        prepared = await repository.preparePhotoDeletion(photoId);
      } catch (error) {
        if (providerErrorCode(error) === "RC203") {
          return { status: "incomplete" as const };
        }
        return {
          status:
            providerErrorCode(error) === "42501"
              ? ("denied" as const)
              : ("unavailable" as const),
        };
      }
      if (prepared.disposition === "retain") {
        return { status: "deleted" as const };
      }
      try {
        await storage.remove([prepared.objectPath]);
        await repository.completePhotoDeletion(photoId);
      } catch {
        return { status: "deletion_reconciliation_required" as const };
      }
      return { status: "deleted" as const };
    },

    async submit(profileId: string, expectedVersion: number) {
      if (
        !uuidPattern.test(profileId) ||
        !Number.isInteger(expectedVersion) ||
        expectedVersion < 1
      ) {
        return { status: "invalid" as const };
      }
      let profile: CottageProfile;
      try {
        profile = await repository.submit(profileId, expectedVersion);
      } catch (error) {
        const code = providerErrorCode(error);
        if (code === "RC203") return { status: "incomplete" as const };
        if (code === "RC409") return { status: "conflict" as const };
        if (code === "42501") return { status: "denied" as const };
        return { status: "unavailable" as const };
      }
      if (
        profile.status !== "submitted_for_content_approval" ||
        !profile.submittedSourceRevision
      ) {
        return { status: "unavailable" as const };
      }
      return { status: "submitted" as const, profile };
    },
  };
}
