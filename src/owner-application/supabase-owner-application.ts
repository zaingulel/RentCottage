import type { SupabaseClient } from "@supabase/supabase-js";

import {
  verificationDocumentKinds,
  type VerificationDocumentKind,
} from "./owner-application";
import type {
  OwnerApplicationDraft,
  OwnerApplicationRepository,
  OwnerApplicationSnapshot,
  OwnerVerificationDocument,
  PendingVerificationDocumentCleanup,
  PreparedVerificationDocumentAccess,
  VerificationDocumentRegistrationReconciliation,
  VerificationDocumentStorage,
  VerificationUpload,
} from "./owner-application";

const bucketName = "owner-verification";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Owner Application provider data is invalid");
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) {
    throw new Error(`Owner Application ${field} is invalid`);
  }
  return value;
}

function optionalString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") {
    throw new Error("Owner Application provider text is invalid");
  }
  return value;
}

function optionalInteger(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value)) {
    throw new Error("Owner Application provider number is invalid");
  }
  return value as number;
}

function parseDocument(value: unknown): OwnerVerificationDocument {
  const candidate = record(value);
  const id = requiredString(candidate.id, "document identifier");
  const kind = candidate.kind;
  const mediaType = requiredString(candidate.media_type, "document media type");
  const sizeBytes = candidate.size_bytes;
  if (
    !uuidPattern.test(id) ||
    !verificationDocumentKinds.includes(kind as VerificationDocumentKind) ||
    !Number.isInteger(sizeBytes)
  ) {
    throw new Error("Owner Application document data is invalid");
  }
  return {
    id,
    kind: kind as VerificationDocumentKind,
    originalFilename: requiredString(
      candidate.original_filename,
      "document filename",
    ),
    mediaType,
    sizeBytes: sizeBytes as number,
    updatedAt: requiredString(candidate.updated_at, "document timestamp"),
  };
}

export interface SubmittedOwnerApplicationReview {
  applicationId: string;
  legalName: string;
  submittedAt: string;
  documents: Array<{
    id: string;
    kind: VerificationDocumentKind;
    originalFilename: string;
  }>;
}

export interface SubmittedOwnerApplicationReviewCursor {
  submittedAt: string;
  applicationId: string;
}

export interface SubmittedOwnerApplicationReviewPage {
  applications: SubmittedOwnerApplicationReview[];
  nextCursor: SubmittedOwnerApplicationReviewCursor | null;
}

const reviewQueuePageSize = 50;

export async function loadSubmittedOwnerApplicationsForReview(
  client: SupabaseClient,
  cursor?: SubmittedOwnerApplicationReviewCursor,
): Promise<SubmittedOwnerApplicationReviewPage> {
  let query = client
    .from("owner_applications")
    .select("id, legal_name, submitted_at")
    .eq("status", "submitted")
    .order("submitted_at")
    .order("id");
  if (cursor) {
    query = query.or(
      `submitted_at.gt.${cursor.submittedAt},and(submitted_at.eq.${cursor.submittedAt},id.gt.${cursor.applicationId})`,
    );
  }
  const applicationsResult = await query.limit(reviewQueuePageSize + 1);
  assertProviderSuccess(applicationsResult.error);
  if (!Array.isArray(applicationsResult.data)) {
    throw new Error("Owner Application review queue is invalid");
  }
  const hasNextPage = applicationsResult.data.length > reviewQueuePageSize;
  const applicationValues = applicationsResult.data.slice(
    0,
    reviewQueuePageSize,
  );

  const applications = applicationValues.map((value) => {
    const application = record(value);
    const applicationId = requiredString(application.id, "identifier");
    if (!uuidPattern.test(applicationId)) {
      throw new Error("Owner Application review identifier is invalid");
    }
    return {
      applicationId,
      legalName: requiredString(application.legal_name, "legal name"),
      submittedAt: requiredString(
        application.submitted_at,
        "submission timestamp",
      ),
      documents: [] as SubmittedOwnerApplicationReview["documents"],
    };
  });
  if (applications.length === 0) {
    return { applications: [], nextCursor: null };
  }

  const documentValues: unknown[] = [];
  const documentsResult = await client
    .from("owner_verification_documents")
    .select("id, application_id, kind, original_filename")
    .in(
      "application_id",
      applications.map(({ applicationId }) => applicationId),
    )
    .order("application_id")
    .order("kind");
  assertProviderSuccess(documentsResult.error);
  if (!Array.isArray(documentsResult.data)) {
    throw new Error("Owner Application review documents are invalid");
  }
  documentValues.push(...documentsResult.data);

  const applicationsById = new Map(
    applications.map((application) => [application.applicationId, application]),
  );
  for (const value of documentValues) {
    const document = record(value);
    const id = requiredString(document.id, "document identifier");
    const applicationId = requiredString(
      document.application_id,
      "document application identifier",
    );
    const kind = document.kind;
    const application = applicationsById.get(applicationId);
    if (
      !application ||
      !uuidPattern.test(id) ||
      !verificationDocumentKinds.includes(kind as VerificationDocumentKind)
    ) {
      throw new Error("Owner Application review document is invalid");
    }
    application.documents.push({
      id,
      kind: kind as VerificationDocumentKind,
      originalFilename: requiredString(
        document.original_filename,
        "document filename",
      ),
    });
  }

  const lastApplication = applications.at(-1);
  return {
    applications,
    nextCursor:
      hasNextPage && lastApplication
        ? {
            submittedAt: lastApplication.submittedAt,
            applicationId: lastApplication.applicationId,
          }
        : null,
  };
}

function parseSnapshot(
  applicationValue: unknown,
  profileValue: unknown,
  documentValues: unknown,
): OwnerApplicationSnapshot {
  const application = record(applicationValue);
  const profile = record(profileValue);
  const applicationId = requiredString(application.id, "identifier");
  const ownerUserId = requiredString(application.owner_user_id, "owner");
  const status = application.status;
  const applicantKind = application.applicant_kind;
  const licensingBasis = application.licensing_basis;
  if (
    !uuidPattern.test(applicationId) ||
    !uuidPattern.test(ownerUserId) ||
    (status !== "draft" && status !== "submitted") ||
    (applicantKind !== "individual" && applicantKind !== "company") ||
    (licensingBasis !== "licence" && licensingBasis !== "exemption") ||
    !Array.isArray(documentValues)
  ) {
    throw new Error("Owner Application provider data is invalid");
  }
  const amenities = profile.amenities;
  if (
    !Array.isArray(amenities) ||
    !amenities.every((item) => typeof item === "string")
  ) {
    throw new Error("Owner Application amenities are invalid");
  }

  return {
    applicationId,
    ownerUserId,
    status,
    applicantKind,
    legalName: optionalString(application.legal_name),
    companyName: optionalString(application.company_name),
    licensingBasis,
    exemptionBasis: optionalString(application.exemption_basis),
    cottage: {
      name: optionalString(profile.name),
      governorate: optionalString(profile.governorate),
      approximateLocation: optionalString(profile.approximate_location),
      exactAddress: optionalString(profile.exact_address),
      capacity: optionalInteger(profile.capacity),
      bedrooms: optionalInteger(profile.bedrooms),
      bathrooms: optionalInteger(profile.bathrooms),
      amenities: amenities as string[],
      description: optionalString(profile.description),
      houseRules: optionalString(profile.house_rules),
    },
    documents: documentValues.map(parseDocument),
    submittedAt:
      application.submitted_at === null
        ? null
        : requiredString(application.submitted_at, "submission timestamp"),
  };
}

function assertProviderSuccess(error: unknown): void {
  if (error) {
    throw new Error("Owner Application provider is unavailable", {
      cause: error,
    });
  }
}

function parsePendingCleanup(
  value: unknown,
): PendingVerificationDocumentCleanup {
  const candidate = record(value);
  const cleanupId = requiredString(candidate.cleanup_id, "cleanup identifier");
  if (!uuidPattern.test(cleanupId)) {
    throw new Error("Owner Application cleanup identifier is invalid");
  }
  return {
    cleanupId,
    objectPath: requiredString(candidate.object_path, "cleanup object path"),
  };
}

function parsePreparedAccess(
  value: unknown,
): PreparedVerificationDocumentAccess {
  const candidate = record(value);
  const grantId = requiredString(candidate.grant_id, "access grant identifier");
  if (!uuidPattern.test(grantId)) {
    throw new Error("Owner Application access grant identifier is invalid");
  }
  return {
    grantId,
    objectPath: requiredString(candidate.object_path, "document path"),
  };
}

function parseRegisteredDocument(value: unknown) {
  const result = record(value);
  const documentId = requiredString(result.document_id, "document identifier");
  const previousObjectPath = result.previous_object_path;
  const previousCleanupId = result.previous_cleanup_id;
  if (
    (previousObjectPath !== null && typeof previousObjectPath !== "string") ||
    (previousCleanupId !== null &&
      (typeof previousCleanupId !== "string" ||
        !uuidPattern.test(previousCleanupId))) ||
    (previousObjectPath === null) !== (previousCleanupId === null) ||
    !uuidPattern.test(documentId)
  ) {
    throw new Error("Owner Application replacement data is invalid");
  }
  return {
    documentId,
    previousObjectPath,
    previousCleanupId,
  };
}

export class SupabaseOwnerApplicationRepository implements OwnerApplicationRepository {
  constructor(
    private readonly client: SupabaseClient,
    private readonly privilegedClient: SupabaseClient,
  ) {}

  async load(): Promise<OwnerApplicationSnapshot | null> {
    const applicationResult = await this.client
      .from("owner_applications")
      .select(
        "id, owner_user_id, status, applicant_kind, legal_name, company_name, licensing_basis, exemption_basis, submitted_at",
      )
      .limit(1)
      .maybeSingle();
    assertProviderSuccess(applicationResult.error);
    if (!applicationResult.data) return null;

    const application = record(applicationResult.data);
    const applicationId = requiredString(application.id, "identifier");
    if (!uuidPattern.test(applicationId)) {
      throw new Error("Owner Application identifier is invalid");
    }
    const [profileResult, documentsResult] = await Promise.all([
      this.client
        .from("owner_application_cottage_profiles")
        .select(
          "name, governorate, approximate_location, exact_address, capacity, bedrooms, bathrooms, amenities, description, house_rules",
        )
        .eq("application_id", applicationId)
        .maybeSingle(),
      this.client
        .from("owner_verification_documents")
        .select(
          "id, kind, original_filename, media_type, size_bytes, updated_at",
        )
        .eq("application_id", applicationId)
        .order("kind"),
    ]);
    assertProviderSuccess(profileResult.error);
    assertProviderSuccess(documentsResult.error);
    if (!profileResult.data) {
      throw new Error("Owner Application Cottage Profile is missing");
    }
    return parseSnapshot(
      applicationResult.data,
      profileResult.data,
      documentsResult.data,
    );
  }

  async saveDraft(
    draft: OwnerApplicationDraft,
  ): Promise<PendingVerificationDocumentCleanup[]> {
    const { data, error } = await this.client.rpc("save_owner_application", {
      requested_applicant_kind: draft.applicantKind,
      requested_legal_name: draft.legalName,
      requested_company_name: draft.companyName || null,
      requested_licensing_basis: draft.licensingBasis,
      requested_exemption_basis: draft.exemptionBasis || null,
      requested_cottage_name: draft.cottageName,
      requested_governorate: draft.governorate,
      requested_approximate_location: draft.approximateLocation,
      requested_exact_address: draft.exactAddress,
      requested_capacity: draft.capacity,
      requested_bedrooms: draft.bedrooms,
      requested_bathrooms: draft.bathrooms,
      requested_amenities: draft.amenities,
      requested_description: draft.description,
      requested_house_rules: draft.houseRules,
    });
    assertProviderSuccess(error);
    if (!Array.isArray(data)) {
      throw new Error("Owner Application cleanup data is invalid");
    }
    return data.map(parsePendingCleanup);
  }

  async missingItems(): Promise<string[]> {
    const { data, error } = await this.client.rpc(
      "owner_application_missing_items",
    );
    assertProviderSuccess(error);
    if (
      !Array.isArray(data) ||
      !data.every((item) => typeof item === "string")
    ) {
      throw new Error("Owner Application missing-item data is invalid");
    }
    return data;
  }

  async submit(): Promise<void> {
    const { error } = await this.client.rpc("submit_owner_application");
    assertProviderSuccess(error);
  }

  async prepareDocumentUpload(input: {
    ownerUserId: string;
    applicationId: string;
    kind: VerificationDocumentKind;
    objectPath: string;
    originalFilename: string;
    mediaType: string;
    sizeBytes: number;
  }): Promise<string> {
    const { data, error } = await this.privilegedClient.rpc(
      "prepare_owner_verification_document_upload",
      {
        requested_owner_user_id: input.ownerUserId,
        requested_application_id: input.applicationId,
        requested_kind: input.kind,
        requested_object_path: input.objectPath,
        requested_original_filename: input.originalFilename,
        requested_media_type: input.mediaType,
        requested_size_bytes: input.sizeBytes,
      },
    );
    assertProviderSuccess(error);
    return requiredString(data, "cleanup identifier");
  }

  async registerDocument(cleanupId: string) {
    const { data, error } = await this.privilegedClient.rpc(
      "register_owner_verification_document",
      { target_cleanup_id: cleanupId },
    );
    assertProviderSuccess(error);
    return parseRegisteredDocument(data);
  }

  async reconcileDocumentRegistration(
    cleanupId: string,
  ): Promise<VerificationDocumentRegistrationReconciliation> {
    const { data, error } = await this.privilegedClient.rpc(
      "reconcile_owner_verification_document_registration",
      { target_cleanup_id: cleanupId },
    );
    assertProviderSuccess(error);
    const result = record(data);
    if (result.status === "unregistered") {
      return { status: "unregistered" };
    }
    if (result.status !== "registered") {
      throw new Error("Owner Application registration state is invalid");
    }
    return { status: "registered", ...parseRegisteredDocument(result) };
  }

  async prepareDocumentAccess(
    documentId: string,
  ): Promise<PreparedVerificationDocumentAccess> {
    const { data, error } = await this.client.rpc(
      "prepare_owner_verification_document_access",
      { target_document_id: documentId },
    );
    assertProviderSuccess(error);
    return parsePreparedAccess(data);
  }

  async completeDocumentAccess(
    grantId: string,
    expiresInSeconds: number,
  ): Promise<"completed" | "expired"> {
    const { data, error } = await this.privilegedClient.rpc(
      "complete_owner_verification_document_access",
      {
        target_access_grant_id: grantId,
        requested_expires_in_seconds: expiresInSeconds,
      },
    );
    assertProviderSuccess(error);
    if (data !== "completed" && data !== "expired") {
      throw new Error("Owner Application access completion is invalid");
    }
    return data;
  }

  async completeDocumentCleanup(cleanupId: string): Promise<void> {
    const { error } = await this.privilegedClient.rpc(
      "complete_owner_verification_document_cleanup",
      { target_cleanup_id: cleanupId },
    );
    assertProviderSuccess(error);
  }
}

export class SupabaseVerificationDocumentStorage implements VerificationDocumentStorage {
  constructor(private readonly privilegedClient: SupabaseClient) {}

  async upload(objectPath: string, file: VerificationUpload): Promise<void> {
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
    return requiredString(data?.signedUrl, "signed document URL");
  }
}
