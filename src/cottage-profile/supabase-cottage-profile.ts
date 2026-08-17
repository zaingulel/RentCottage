import type { SupabaseClient } from "@supabase/supabase-js";

import {
  cottageProfileAmenities,
  type CottageProfile,
  type CottageProfileDraftValues,
  type CottageProfilePhoto,
  type CottageProfileRepository,
  type CottageProfileSourceRevision,
  type CottageProfileStorage,
  type CottageProfileUpload,
} from "./cottage-profile";

const bucketName = "cottage-profile-photos";
const profileColumns =
  "id, owner_user_id, application_id, status, version, name, governorate, approximate_location, exact_address, exact_latitude, exact_longitude, private_directions, capacity, bedrooms, bathrooms, amenities, source_language, description, house_rules, submitted_source_revision_id, updated_at";
const photoColumns =
  "id, original_filename, media_type, size_bytes, state, updated_at";
const sourceColumns =
  "revision, owner_user_id, source_language, description, house_rules, submitted_at";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const knownAmenities = new Set<string>(cottageProfileAmenities);
const photoMediaTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maximumPhotoBytes = 5_242_880;

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

function parsePhoto(value: unknown): CottageProfilePhoto {
  const photo = record(value);
  const id = requiredString(photo.id);
  const state = photo.state;
  const sizeBytes = optionalInteger(photo.size_bytes);
  const mediaType = requiredString(photo.media_type);
  if (
    !uuidPattern.test(id) ||
    !["pending", "ready", "deletion_pending"].includes(String(state)) ||
    sizeBytes === null ||
    sizeBytes < 1 ||
    sizeBytes > maximumPhotoBytes ||
    !photoMediaTypes.has(mediaType)
  ) {
    throw new Error("Cottage Profile photo data is invalid");
  }
  return {
    id,
    originalFilename: requiredString(photo.original_filename),
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
  if (
    !uuidPattern.test(ownerUserId) ||
    revision === null ||
    revision < 1 ||
    !["ar", "ckb", "en"].includes(String(sourceLanguage))
  ) {
    throw new Error("Cottage Profile submitted source is invalid");
  }
  return {
    revision,
    ownerUserId,
    sourceLanguage:
      sourceLanguage as CottageProfileSourceRevision["sourceLanguage"],
    description: requiredString(source.description),
    houseRules: requiredString(source.house_rules),
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
    (status === "submitted_for_content_approval" && amenities.length < 1) ||
    (exactLatitude === null) !== (exactLongitude === null) ||
    (exactLatitude !== null && (exactLatitude < -90 || exactLatitude > 90)) ||
    (exactLongitude !== null &&
      (exactLongitude < -180 || exactLongitude > 180)) ||
    (capacity !== null && (capacity < 1 || capacity > 100)) ||
    (bedrooms !== null && (bedrooms < 1 || bedrooms > 50)) ||
    (bathrooms !== null && (bathrooms < 1 || bathrooms > 50))
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
    name: optionalString(profile.name),
    governorate: optionalString(profile.governorate),
    approximateLocation: optionalString(profile.approximate_location),
    exactAddress: optionalString(profile.exact_address),
    exactLatitude,
    exactLongitude,
    privateDirections: optionalString(profile.private_directions),
    capacity,
    bedrooms,
    bathrooms,
    amenities: amenities as string[],
    sourceLanguage: sourceLanguage as CottageProfile["sourceLanguage"],
    description: optionalString(profile.description),
    houseRules: optionalString(profile.house_rules),
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

  async listOwner(): Promise<CottageProfile[]> {
    const { data, error } = await this.client.rpc(
      "list_owner_cottage_profiles",
    );
    assertProviderSuccess(error);
    if (!Array.isArray(data)) {
      throw new Error("Cottage Profile list is invalid");
    }
    return Promise.all(data.map((profile) => this.hydrate(profile)));
  }

  async listAdministrator(): Promise<CottageProfile[]> {
    const { data, error } = await this.client
      .from("owner_application_cottage_profiles")
      .select(profileColumns)
      .order("updated_at", { ascending: false });
    assertProviderSuccess(error);
    if (!Array.isArray(data)) {
      throw new Error("Cottage Profile administrator list is invalid");
    }
    return Promise.all(data.map((profile) => this.hydrate(profile)));
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

  async preparePhotoDeletion(photoId: string): Promise<string> {
    const { data, error } = await this.client.rpc(
      "prepare_cottage_profile_photo_deletion",
      { target_photo_id: photoId },
    );
    assertProviderSuccess(error);
    return requiredString(record(data).object_path);
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
      .from(bucketName)
      .upload(objectPath, file.bytes, {
        contentType: file.type,
        upsert: false,
      });
    assertProviderSuccess(error);
  }

  async remove(objectPaths: string[]): Promise<void> {
    const { error } = await this.privilegedClient.storage
      .from(bucketName)
      .remove(objectPaths);
    assertProviderSuccess(error);
  }

  async createSignedUrl(
    objectPath: string,
    expiresInSeconds: number,
  ): Promise<string> {
    const { data, error } = await this.privilegedClient.storage
      .from(bucketName)
      .createSignedUrl(objectPath, expiresInSeconds);
    assertProviderSuccess(error);
    return requiredString(data?.signedUrl);
  }
}
