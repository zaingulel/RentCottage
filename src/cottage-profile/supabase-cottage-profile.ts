import type { SupabaseClient } from "@supabase/supabase-js";

import {
  cottageProfileAmenities,
  cottageProfileMaximumLengths,
  cottageProfileMaximumPhotoBytes,
  cottageProfileMaximumPhotoFilenameLength,
  cottageProfileMaximumPhotos,
  cottageProfileNumberRanges,
  cottageProfilePhotoBucketName,
  cottageProfilePhotoMediaTypes,
  type CottageProfile,
  type CottageProfileAdministratorCursor,
  type CottageProfileAdministratorPage,
  type CottageProfileDraftValues,
  type CottageProfilePhoto,
  type CottageProfileRepository,
  type PreparedCottageProfilePhotoDeletion,
  type CottageProfileSourceRevision,
  type CottageProfileStorage,
  type CottageProfileUpload,
} from "./cottage-profile";

const administratorPageSize = 100;
const ownerPageSize = 100;
const providerMaximumRows = 1000;
const photoProfileChunkSize = Math.floor(
  providerMaximumRows / cottageProfileMaximumPhotos,
);
const administratorCursorTimestampPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const profileColumns =
  "id, owner_user_id, application_id, status, version, name, governorate, approximate_location, exact_address, exact_latitude, exact_longitude, private_directions, capacity, bedrooms, bathrooms, amenities, source_language, description, house_rules, submitted_source_revision_id, updated_at";
const photoColumns =
  "id, profile_id, original_filename, media_type, size_bytes, state, updated_at";
const sourceColumns =
  "id, revision, owner_user_id, source_language, description, house_rules, submitted_at";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const knownAmenities = new Set<string>(cottageProfileAmenities);
const photoMediaTypes = new Set<string>(cottageProfilePhotoMediaTypes);

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Cottage Profile provider data is invalid");
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || !value) {
    throw new Error("Cottage Profile provider text is invalid");
  }
  return value;
}

function optionalString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") {
    throw new Error("Cottage Profile provider text is invalid");
  }
  return value;
}

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error("Cottage Profile provider number is invalid");
  }
  return parsed;
}

function optionalInteger(value: unknown): number | null {
  const parsed = optionalNumber(value);
  if (parsed !== null && !Number.isInteger(parsed)) {
    throw new Error("Cottage Profile provider integer is invalid");
  }
  return parsed;
}

function assertProviderSuccess(error: unknown): void {
  if (error) {
    throw new Error("Cottage Profile provider is unavailable", {
      cause: error,
    });
  }
}

export function parseAdministratorCottageProfileCursor(
  updatedAt: unknown,
  profileId: unknown,
): CottageProfileAdministratorCursor | undefined {
  if (updatedAt === undefined && profileId === undefined) return undefined;
  if (
    typeof updatedAt !== "string" ||
    !administratorCursorTimestampPattern.test(updatedAt) ||
    Number.isNaN(Date.parse(updatedAt)) ||
    typeof profileId !== "string" ||
    !uuidPattern.test(profileId)
  ) {
    throw new Error("Cottage Profile administrator cursor is invalid");
  }
  return { updatedAt, profileId };
}

function parsePhoto(value: unknown): CottageProfilePhoto {
  const photo = record(value);
  const id = requiredString(photo.id);
  const state = photo.state;
  const sizeBytes = optionalInteger(photo.size_bytes);
  const mediaType = requiredString(photo.media_type);
  const originalFilename = requiredString(photo.original_filename);
  if (
    !uuidPattern.test(id) ||
    !["pending", "ready", "deletion_pending"].includes(String(state)) ||
    sizeBytes === null ||
    sizeBytes < 1 ||
    sizeBytes > cottageProfileMaximumPhotoBytes ||
    originalFilename.length > cottageProfileMaximumPhotoFilenameLength ||
    !photoMediaTypes.has(mediaType)
  ) {
    throw new Error("Cottage Profile photo data is invalid");
  }
  return {
    id,
    originalFilename,
    mediaType,
    sizeBytes,
    state: state as CottageProfilePhoto["state"],
    updatedAt: requiredString(photo.updated_at),
  };
}

function parseSource(value: unknown): CottageProfileSourceRevision {
  const source = record(value);
  const ownerUserId = requiredString(source.owner_user_id);
  const sourceLanguage = source.source_language;
  const revision = optionalInteger(source.revision);
  const description = requiredString(source.description);
  const houseRules = requiredString(source.house_rules);
  if (
    !uuidPattern.test(ownerUserId) ||
    revision === null ||
    revision < 1 ||
    !["ar", "ckb", "en"].includes(String(sourceLanguage)) ||
    description.length > cottageProfileMaximumLengths.description ||
    houseRules.length > cottageProfileMaximumLengths.houseRules
  ) {
    throw new Error("Cottage Profile submitted source is invalid");
  }
  return {
    revision,
    ownerUserId,
    sourceLanguage:
      sourceLanguage as CottageProfileSourceRevision["sourceLanguage"],
    description,
    houseRules,
    submittedAt: requiredString(source.submitted_at),
  };
}

function parseProfile(
  value: unknown,
  photos: CottageProfilePhoto[],
  submittedSourceRevision: CottageProfileSourceRevision | null,
): CottageProfile {
  const profile = record(value);
  const id = requiredString(profile.id);
  const ownerUserId = requiredString(profile.owner_user_id);
  const applicationId = profile.application_id;
  const status = profile.status;
  const sourceLanguage = profile.source_language;
  const version = optionalInteger(profile.version);
  const amenities = profile.amenities;
  const exactLatitude = optionalNumber(profile.exact_latitude);
  const exactLongitude = optionalNumber(profile.exact_longitude);
  const capacity = optionalInteger(profile.capacity);
  const bedrooms = optionalInteger(profile.bedrooms);
  const bathrooms = optionalInteger(profile.bathrooms);
  const textFields = {
    name: optionalString(profile.name),
    governorate: optionalString(profile.governorate),
    approximateLocation: optionalString(profile.approximate_location),
    exactAddress: optionalString(profile.exact_address),
    privateDirections: optionalString(profile.private_directions),
    description: optionalString(profile.description),
    houseRules: optionalString(profile.house_rules),
  };
  if (
    !uuidPattern.test(id) ||
    !uuidPattern.test(ownerUserId) ||
    (applicationId !== null &&
      (typeof applicationId !== "string" ||
        !uuidPattern.test(applicationId))) ||
    !["draft", "submitted_for_content_approval"].includes(String(status)) ||
    version === null ||
    version < 1 ||
    (sourceLanguage !== null &&
      !["ar", "ckb", "en"].includes(String(sourceLanguage))) ||
    !Array.isArray(amenities) ||
    amenities.length > cottageProfileAmenities.length ||
    !amenities.every(
      (item) => typeof item === "string" && knownAmenities.has(item),
    ) ||
    new Set(amenities).size !== amenities.length ||
    Object.entries(cottageProfileMaximumLengths).some(
      ([field, maximum]) =>
        textFields[field as keyof typeof textFields].length > maximum,
    ) ||
    (status === "submitted_for_content_approval" && amenities.length < 1) ||
    (exactLatitude === null) !== (exactLongitude === null) ||
    (exactLatitude !== null &&
      (exactLatitude < cottageProfileNumberRanges.exactLatitude.minimum ||
        exactLatitude > cottageProfileNumberRanges.exactLatitude.maximum)) ||
    (exactLongitude !== null &&
      (exactLongitude < cottageProfileNumberRanges.exactLongitude.minimum ||
        exactLongitude > cottageProfileNumberRanges.exactLongitude.maximum)) ||
    (capacity !== null &&
      (capacity < cottageProfileNumberRanges.capacity.minimum ||
        capacity > cottageProfileNumberRanges.capacity.maximum)) ||
    (bedrooms !== null &&
      (bedrooms < cottageProfileNumberRanges.bedrooms.minimum ||
        bedrooms > cottageProfileNumberRanges.bedrooms.maximum)) ||
    (bathrooms !== null &&
      (bathrooms < cottageProfileNumberRanges.bathrooms.minimum ||
        bathrooms > cottageProfileNumberRanges.bathrooms.maximum))
  ) {
    throw new Error("Cottage Profile provider data is invalid");
  }
  if (
    (status === "draft" && submittedSourceRevision !== null) ||
    (status === "submitted_for_content_approval" &&
      submittedSourceRevision === null)
  ) {
    throw new Error("Cottage Profile submitted source is invalid");
  }
  return {
    id,
    ownerUserId,
    applicationId: applicationId as string | null,
    status: status as CottageProfile["status"],
    version,
    name: textFields.name,
    governorate: textFields.governorate,
    approximateLocation: textFields.approximateLocation,
    exactAddress: textFields.exactAddress,
    exactLatitude,
    exactLongitude,
    privateDirections: textFields.privateDirections,
    capacity,
    bedrooms,
    bathrooms,
    amenities: amenities as string[],
    sourceLanguage: sourceLanguage as CottageProfile["sourceLanguage"],
    description: textFields.description,
    houseRules: textFields.houseRules,
    photos,
    submittedSourceRevision,
    updatedAt: requiredString(profile.updated_at),
  };
}

function rpcValues(values: CottageProfileDraftValues) {
  return {
    requested_name: values.name,
    requested_governorate: values.governorate,
    requested_approximate_location: values.approximateLocation,
    requested_exact_address: values.exactAddress,
    requested_exact_latitude: values.exactLatitude,
    requested_exact_longitude: values.exactLongitude,
    requested_private_directions: values.privateDirections,
    requested_capacity: values.capacity,
    requested_bedrooms: values.bedrooms,
    requested_bathrooms: values.bathrooms,
    requested_amenities: values.amenities,
    requested_source_language: values.sourceLanguage,
    requested_description: values.description,
    requested_house_rules: values.houseRules,
  };
}

export class SupabaseCottageProfileRepository implements CottageProfileRepository {
  constructor(
    private readonly client: SupabaseClient,
    private readonly privilegedClient: SupabaseClient,
  ) {}

  private async hydrate(value: unknown): Promise<CottageProfile> {
    const profile = record(value);
    const profileId = requiredString(profile.id);
    const sourceRevisionId = profile.submitted_source_revision_id;
    if (!uuidPattern.test(profileId)) {
      throw new Error("Cottage Profile identifier is invalid");
    }
    const photosResult = await this.client
      .from("cottage_profile_photos")
      .select(photoColumns)
      .eq("profile_id", profileId)
      .eq("is_active", true)
      .order("created_at");
    assertProviderSuccess(photosResult.error);
    if (!Array.isArray(photosResult.data)) {
      throw new Error("Cottage Profile photo data is invalid");
    }
    let source: CottageProfileSourceRevision | null = null;
    if (sourceRevisionId !== null) {
      if (
        typeof sourceRevisionId !== "string" ||
        !uuidPattern.test(sourceRevisionId)
      ) {
        throw new Error("Cottage Profile source identifier is invalid");
      }
      const sourceResult = await this.client
        .from("cottage_profile_source_revisions")
        .select(sourceColumns)
        .eq("id", sourceRevisionId)
        .maybeSingle();
      assertProviderSuccess(sourceResult.error);
      if (!sourceResult.data) {
        throw new Error("Cottage Profile submitted source is missing");
      }
      source = parseSource(sourceResult.data);
    }
    return parseProfile(value, photosResult.data.map(parsePhoto), source);
  }

  private async hydrateList(values: unknown[]): Promise<CottageProfile[]> {
    if (values.length === 0) return [];
    const profiles = values.map(record);
    const profileIds = profiles.map((profile) => {
      const profileId = requiredString(profile.id);
      if (!uuidPattern.test(profileId)) {
        throw new Error("Cottage Profile identifier is invalid");
      }
      return profileId;
    });
    const sourceRevisionIds = profiles.flatMap((profile) => {
      const sourceRevisionId = profile.submitted_source_revision_id;
      if (sourceRevisionId === null) return [];
      if (
        typeof sourceRevisionId !== "string" ||
        !uuidPattern.test(sourceRevisionId)
      ) {
        throw new Error("Cottage Profile source identifier is invalid");
      }
      return [sourceRevisionId];
    });
    const photoRows: unknown[] = [];
    for (
      let index = 0;
      index < profileIds.length;
      index += photoProfileChunkSize
    ) {
      const profileIdChunk = profileIds.slice(
        index,
        index + photoProfileChunkSize,
      );
      const photosResult = await this.client
        .from("cottage_profile_photos")
        .select(photoColumns)
        .in("profile_id", profileIdChunk)
        .eq("is_active", true)
        .order("created_at");
      assertProviderSuccess(photosResult.error);
      if (!Array.isArray(photosResult.data)) {
        throw new Error("Cottage Profile photo data is invalid");
      }
      photoRows.push(...photosResult.data);
    }
    const knownProfileIds = new Set(profileIds);
    const photosByProfile = new Map<string, CottageProfilePhoto[]>();
    for (const value of photoRows) {
      const photo = record(value);
      const profileId = requiredString(photo.profile_id);
      if (!knownProfileIds.has(profileId)) {
        throw new Error("Cottage Profile photo data is invalid");
      }
      const photos = photosByProfile.get(profileId) ?? [];
      photos.push(parsePhoto(photo));
      photosByProfile.set(profileId, photos);
    }
    const sourcesById = new Map<string, CottageProfileSourceRevision>();
    if (sourceRevisionIds.length > 0) {
      const sourceResult = await this.client
        .from("cottage_profile_source_revisions")
        .select(sourceColumns)
        .in("id", sourceRevisionIds);
      assertProviderSuccess(sourceResult.error);
      if (!Array.isArray(sourceResult.data)) {
        throw new Error("Cottage Profile submitted source is invalid");
      }
      const knownSourceRevisionIds = new Set(sourceRevisionIds);
      for (const value of sourceResult.data) {
        const source = record(value);
        const sourceId = requiredString(source.id);
        if (!knownSourceRevisionIds.has(sourceId)) {
          throw new Error("Cottage Profile submitted source is invalid");
        }
        sourcesById.set(sourceId, parseSource(source));
      }
    }
    return profiles.map((profile, index) => {
      const sourceRevisionId = profile.submitted_source_revision_id;
      const source =
        typeof sourceRevisionId === "string"
          ? (sourcesById.get(sourceRevisionId) ?? null)
          : null;
      if (typeof sourceRevisionId === "string" && !source) {
        throw new Error("Cottage Profile submitted source is missing");
      }
      return parseProfile(
        profile,
        photosByProfile.get(profileIds[index]!) ?? [],
        source,
      );
    });
  }

  async listOwner(): Promise<CottageProfile[]> {
    const profiles: CottageProfile[] = [];
    let cursor: CottageProfileAdministratorCursor | undefined;
    for (;;) {
      const { data, error } = await this.client.rpc(
        "list_owner_cottage_profiles",
        {
          target_after_updated_at: cursor?.updatedAt ?? null,
          target_after_id: cursor?.profileId ?? null,
          target_limit: ownerPageSize,
        },
      );
      assertProviderSuccess(error);
      if (!Array.isArray(data)) {
        throw new Error("Cottage Profile list is invalid");
      }
      profiles.push(...(await this.hydrateList(data)));
      if (data.length < ownerPageSize) return profiles;
      const boundary = record(data.at(-1));
      const nextCursor = parseAdministratorCottageProfileCursor(
        boundary.updated_at,
        boundary.id,
      );
      if (
        !nextCursor ||
        (cursor?.updatedAt === nextCursor.updatedAt &&
          cursor.profileId === nextCursor.profileId)
      ) {
        throw new Error("Cottage Profile list did not advance");
      }
      cursor = nextCursor;
    }
  }

  async listAdministrator(
    cursor?: CottageProfileAdministratorCursor,
  ): Promise<CottageProfileAdministratorPage> {
    const validatedCursor =
      cursor === undefined
        ? undefined
        : parseAdministratorCottageProfileCursor(
            cursor.updatedAt,
            cursor.profileId,
          );
    let query = this.client
      .from("owner_application_cottage_profiles")
      .select(profileColumns)
      .order("updated_at", { ascending: false })
      .order("id", { ascending: false });
    if (validatedCursor) {
      query = query.or(
        `updated_at.lt.${validatedCursor.updatedAt},and(updated_at.eq.${validatedCursor.updatedAt},id.lt.${validatedCursor.profileId})`,
      );
    }
    const { data, error } = await query.limit(administratorPageSize + 1);
    assertProviderSuccess(error);
    if (!Array.isArray(data)) {
      throw new Error("Cottage Profile administrator list is invalid");
    }
    const profileRows = data.slice(0, administratorPageSize);
    const boundary = profileRows.at(-1);
    return {
      profiles: await this.hydrateList(profileRows),
      nextCursor:
        data.length > administratorPageSize && boundary
          ? (parseAdministratorCottageProfileCursor(
              record(boundary).updated_at,
              record(boundary).id,
            ) ?? null)
          : null,
    };
  }

  async load(profileId: string): Promise<CottageProfile | null> {
    const { data, error } = await this.client
      .from("owner_application_cottage_profiles")
      .select(profileColumns)
      .eq("id", profileId)
      .maybeSingle();
    assertProviderSuccess(error);
    return data ? this.hydrate(data) : null;
  }

  async createDraft(): Promise<CottageProfile> {
    const { data, error } = await this.client.rpc(
      "create_owner_cottage_profile_draft",
    );
    assertProviderSuccess(error);
    return this.hydrate(data);
  }

  async updateOwner(input: {
    profileId: string;
    expectedVersion: number;
    values: CottageProfileDraftValues;
  }): Promise<CottageProfile> {
    const { data, error } = await this.client.rpc(
      "update_owner_cottage_profile_draft",
      {
        target_profile_id: input.profileId,
        target_expected_version: input.expectedVersion,
        ...rpcValues(input.values),
      },
    );
    assertProviderSuccess(error);
    return this.hydrate(data);
  }

  async updateAdministrator(input: {
    profileId: string;
    expectedVersion: number;
    values: CottageProfileDraftValues;
  }): Promise<CottageProfile> {
    const { data, error } = await this.client.rpc(
      "update_administrator_cottage_profile",
      {
        target_profile_id: input.profileId,
        target_expected_version: input.expectedVersion,
        ...rpcValues(input.values),
      },
    );
    assertProviderSuccess(error);
    return this.hydrate(data);
  }

  async submit(
    profileId: string,
    expectedVersion: number,
  ): Promise<CottageProfile> {
    const { data, error } = await this.client.rpc(
      "submit_cottage_profile_for_content_approval",
      {
        target_profile_id: profileId,
        target_expected_version: expectedVersion,
      },
    );
    assertProviderSuccess(error);
    return this.hydrate(data);
  }

  async preparePhotoUpload(input: {
    profileId: string;
    originalFilename: string;
    mediaType: string;
    sizeBytes: number;
  }) {
    const { data, error } = await this.client.rpc(
      "prepare_cottage_profile_photo_upload",
      {
        target_profile_id: input.profileId,
        requested_original_filename: input.originalFilename,
        requested_media_type: input.mediaType,
        requested_size_bytes: input.sizeBytes,
      },
    );
    assertProviderSuccess(error);
    const photo = record(data);
    const photoId = requiredString(photo.id);
    if (!uuidPattern.test(photoId)) {
      throw new Error("Cottage Profile photo identifier is invalid");
    }
    return {
      photoId,
      objectPath: requiredString(photo.object_path),
    };
  }

  async registerPhoto(photoId: string): Promise<void> {
    const { error } = await this.privilegedClient.rpc(
      "register_cottage_profile_photo",
      { target_photo_id: photoId },
    );
    assertProviderSuccess(error);
  }

  async preparePhotoPreview(photoId: string): Promise<string> {
    const { data, error } = await this.client.rpc(
      "prepare_cottage_profile_photo_preview",
      { target_photo_id: photoId },
    );
    assertProviderSuccess(error);
    return requiredString(data);
  }

  async preparePhotoDeletion(
    photoId: string,
  ): Promise<PreparedCottageProfilePhotoDeletion> {
    const { data, error } = await this.client.rpc(
      "prepare_cottage_profile_photo_deletion",
      { target_photo_id: photoId },
    );
    assertProviderSuccess(error);
    const photo = record(data);
    const state = photo.state;
    const isActive = photo.is_active;
    if (
      typeof isActive !== "boolean" ||
      !(
        (state === "ready" && !isActive) ||
        (state === "deletion_pending" && isActive)
      )
    ) {
      throw new Error("Cottage Profile photo deletion data is invalid");
    }
    return {
      objectPath: requiredString(photo.object_path),
      disposition: state === "ready" ? "retain" : "delete",
    };
  }

  async completePhotoDeletion(photoId: string): Promise<void> {
    const { error } = await this.privilegedClient.rpc(
      "complete_cottage_profile_photo_deletion",
      { target_photo_id: photoId },
    );
    assertProviderSuccess(error);
  }
}

export class SupabaseCottageProfileStorage implements CottageProfileStorage {
  constructor(private readonly privilegedClient: SupabaseClient) {}

  async upload(objectPath: string, file: CottageProfileUpload): Promise<void> {
    const { error } = await this.privilegedClient.storage
      .from(cottageProfilePhotoBucketName)
      .upload(objectPath, file.bytes, {
        contentType: file.type,
        upsert: false,
      });
    assertProviderSuccess(error);
  }

  async remove(objectPaths: string[]): Promise<void> {
    const { error } = await this.privilegedClient.storage
      .from(cottageProfilePhotoBucketName)
      .remove(objectPaths);
    assertProviderSuccess(error);
  }

  async createSignedUrl(
    objectPath: string,
    expiresInSeconds: number,
  ): Promise<string> {
    const { data, error } = await this.privilegedClient.storage
      .from(cottageProfilePhotoBucketName)
      .createSignedUrl(objectPath, expiresInSeconds);
    assertProviderSuccess(error);
    return requiredString(data?.signedUrl);
  }
}
