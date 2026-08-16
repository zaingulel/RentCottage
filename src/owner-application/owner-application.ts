import type { OwnerApplicationStatus } from "./owner-application-status";

export {
  isOwnerApplicationStatus,
  ownerApplicationStatuses,
  parseOwnerApplicationStatus,
} from "./owner-application-status";
export type { OwnerApplicationStatus } from "./owner-application-status";

export const verificationDocumentKinds = [
  "identity",
  "company_registration",
  "authorised_representative",
  "authority_to_rent",
  "licensing_or_exemption",
  "payout_account",
] as const;
export const verificationDocumentMaximumBytes = 5_242_880;

export type VerificationDocumentKind =
  (typeof verificationDocumentKinds)[number];
export type OwnerApplicantKind = "individual" | "company";
export type OwnerLicensingBasis = "licence" | "exemption";
export interface OwnerApplicationDraft {
  applicantKind: OwnerApplicantKind;
  legalName: string;
  companyName: string;
  licensingBasis: OwnerLicensingBasis;
  exemptionBasis: string;
  cottageName: string;
  governorate: string;
  approximateLocation: string;
  exactAddress: string;
  capacity: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  amenities: string[];
  description: string;
  houseRules: string;
}

export interface OwnerVerificationDocument {
  id: string;
  kind: VerificationDocumentKind;
  originalFilename: string;
  mediaType: string;
  sizeBytes: number;
  updatedAt: string;
}

export interface OwnerApplicationSnapshot {
  applicationId: string;
  ownerUserId: string;
  status: OwnerApplicationStatus;
  applicantKind: OwnerApplicantKind;
  legalName: string;
  companyName: string;
  licensingBasis: OwnerLicensingBasis;
  exemptionBasis: string;
  cottage: {
    name: string;
    governorate: string;
    approximateLocation: string;
    exactAddress: string;
    capacity: number | null;
    bedrooms: number | null;
    bathrooms: number | null;
    amenities: string[];
    description: string;
    houseRules: string;
  };
  documents: OwnerVerificationDocument[];
  submittedAt: string | null;
  version: number;
  reviewDueAt: string | null;
}

export interface RegisteredVerificationDocument {
  documentId: string;
  previousObjectPath: string | null;
  previousCleanupId: string | null;
}

export type VerificationDocumentRegistrationReconciliation =
  | { status: "unregistered" }
  | ({ status: "registered" } & RegisteredVerificationDocument);

export interface PendingVerificationDocumentCleanup {
  cleanupId: string;
  objectPath: string;
}

export interface PreparedVerificationDocumentAccess {
  grantId: string;
  objectPath: string;
}

export type VerificationDocumentAccessPreparation =
  | { status: "denied" }
  | ({ status: "ready" } & PreparedVerificationDocumentAccess);

export interface OwnerApplicationRepository {
  load(): Promise<OwnerApplicationSnapshot | null>;
  saveDraft(
    draft: OwnerApplicationDraft,
  ): Promise<PendingVerificationDocumentCleanup[]>;
  missingItems(): Promise<string[]>;
  submit(): Promise<void>;
  prepareDocumentUpload(input: {
    ownerUserId: string;
    applicationId: string;
    kind: VerificationDocumentKind;
    objectPath: string;
    originalFilename: string;
    mediaType: string;
    sizeBytes: number;
    contentDigest: string;
  }): Promise<string>;
  registerDocument(cleanupId: string): Promise<RegisteredVerificationDocument>;
  reconcileDocumentRegistration(
    cleanupId: string,
  ): Promise<VerificationDocumentRegistrationReconciliation>;
  prepareDocumentAccess(
    documentId: string,
  ): Promise<VerificationDocumentAccessPreparation>;
  completeDocumentAccess(
    grantId: string,
    expiresInSeconds: number,
  ): Promise<"completed" | "expired">;
  completeDocumentCleanup(cleanupId: string): Promise<void>;
}

export interface VerificationUpload {
  name: string;
  type: string;
  size: number;
  bytes: Uint8Array;
}

export interface VerificationDocumentStorage {
  upload(objectPath: string, file: VerificationUpload): Promise<void>;
  remove(objectPaths: string[]): Promise<void>;
  createSignedUrl(
    objectPath: string,
    expiresInSeconds: number,
  ): Promise<string>;
}

export interface OwnerApplicationDiagnostics {
  report(
    event: string,
    context: Record<string, string | number | boolean | null>,
  ): void;
}

type DraftInput = Record<string, unknown>;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedMediaTypes = new Map([
  ["application/pdf", "pdf"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
]);
const allowedAmenities = new Set([
  "garden",
  "parking",
  "pool",
  "air_conditioning",
  "wifi",
  "outdoor_seating",
]);
const maximumLengths = {
  legalName: 120,
  companyName: 120,
  exemptionBasis: 1000,
  cottageName: 120,
  governorate: 120,
  approximateLocation: 240,
  exactAddress: 240,
  description: 2000,
  houseRules: 1500,
} as const;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalInteger(
  value: unknown,
  maximum: number,
): { value: number | null; valid: boolean } {
  if (value === "" || value === null || value === undefined) {
    return { value: null, valid: true };
  }
  const parsed =
    typeof value === "number" ? value : Number(text(value as unknown));
  return {
    value: Number.isInteger(parsed) ? parsed : null,
    valid: Number.isInteger(parsed) && parsed >= 1 && parsed <= maximum,
  };
}

function parseDraft(
  value: unknown,
):
  | { status: "valid"; draft: OwnerApplicationDraft }
  | { status: "invalid"; fields: string[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { status: "invalid", fields: ["application"] };
  }
  const input = value as DraftInput;
  const invalid: string[] = [];
  const applicantKind = input.applicantKind;
  if (applicantKind !== "individual" && applicantKind !== "company") {
    invalid.push("applicantKind");
  }
  const capacity = optionalInteger(input.capacity, 100);
  const bedrooms = optionalInteger(input.bedrooms, 50);
  const bathrooms = optionalInteger(input.bathrooms, 50);
  if (!capacity.valid) invalid.push("capacity");
  if (!bedrooms.valid) invalid.push("bedrooms");
  if (!bathrooms.valid) invalid.push("bathrooms");

  const licensingBasis = input.licensingBasis;
  if (licensingBasis !== "licence" && licensingBasis !== "exemption") {
    invalid.push("licensingBasis");
  }
  for (const [field, maximum] of Object.entries(maximumLengths)) {
    if (text(input[field]).length > maximum) invalid.push(field);
  }

  if (invalid.length > 0) return { status: "invalid", fields: invalid };

  const amenities = Array.isArray(input.amenities)
    ? [...new Set(input.amenities.map(text).filter(Boolean))]
    : [];
  if (amenities.some((amenity) => !allowedAmenities.has(amenity))) {
    return { status: "invalid", fields: ["amenities"] };
  }

  return {
    status: "valid",
    draft: {
      applicantKind: applicantKind as OwnerApplicantKind,
      legalName: text(input.legalName),
      companyName: applicantKind === "company" ? text(input.companyName) : "",
      licensingBasis: licensingBasis as OwnerLicensingBasis,
      exemptionBasis:
        licensingBasis === "exemption" ? text(input.exemptionBasis) : "",
      cottageName: text(input.cottageName),
      governorate: text(input.governorate),
      approximateLocation: text(input.approximateLocation),
      exactAddress: text(input.exactAddress),
      capacity: capacity.value,
      bedrooms: bedrooms.value,
      bathrooms: bathrooms.value,
      amenities,
      description: text(input.description),
      houseRules: text(input.houseRules),
    },
  };
}

function isVerificationKind(value: unknown): value is VerificationDocumentKind {
  return verificationDocumentKinds.includes(value as VerificationDocumentKind);
}

export function isVerificationDocumentKindRequired(
  kind: VerificationDocumentKind,
  applicantKind: OwnerApplicantKind,
  licensingBasis: OwnerLicensingBasis,
): boolean {
  if (kind === "identity") return applicantKind === "individual";
  if (kind === "company_registration" || kind === "authorised_representative") {
    return applicantKind === "company";
  }
  if (kind === "licensing_or_exemption") {
    return licensingBasis === "licence";
  }
  return true;
}

export function documentAccessDeadlineVerdict(
  attemptStartedAt: number,
  expiresInSeconds: number,
  resolvedAt: number,
) {
  const remainingMilliseconds =
    attemptStartedAt + expiresInSeconds * 1_000 - resolvedAt;
  return remainingMilliseconds > 0
    ? { status: "ready" as const, remainingMilliseconds }
    : { status: "expired" as const };
}

const consoleDiagnostics: OwnerApplicationDiagnostics = {
  report(event, context) {
    console.error("Owner Application operation failed", {
      event,
      ...context,
    });
  },
};

function reportFailure(
  diagnostics: OwnerApplicationDiagnostics,
  event: string,
  cause: unknown,
  context: Record<string, string | number | boolean | null> = {},
) {
  try {
    void cause;
    const safeContext = Object.fromEntries(
      Object.entries(context).filter(([key]) =>
        ["documentKind", "cleanupCount"].includes(key),
      ),
    );
    diagnostics.report(event, safeContext);
  } catch {}
}

function bytesMatchMediaType(bytes: Uint8Array, mediaType: string): boolean {
  if (mediaType === "application/pdf") {
    return (
      bytes.length >= 5 &&
      bytes[0] === 0x25 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x44 &&
      bytes[3] === 0x46 &&
      bytes[4] === 0x2d
    );
  }
  if (mediaType === "image/png") {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return signature.every((byte, index) => bytes[index] === byte);
  }
  return (
    mediaType === "image/jpeg" &&
    bytes.length >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  );
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function createOwnerApplication({
  repository,
  storage,
  createId = () => crypto.randomUUID(),
  diagnostics = consoleDiagnostics,
}: {
  repository: OwnerApplicationRepository;
  storage: VerificationDocumentStorage;
  createId?: () => string;
  diagnostics?: OwnerApplicationDiagnostics;
}) {
  return {
    load: () => repository.load(),

    async saveDraft(value: unknown) {
      const parsed = parseDraft(value);
      if (parsed.status === "invalid") return parsed;
      let pendingCleanup: PendingVerificationDocumentCleanup[];
      try {
        pendingCleanup = await repository.saveDraft(parsed.draft);
      } catch (error) {
        reportFailure(diagnostics, "save_draft_persistence_failed", error);
        return { status: "unavailable" } as const;
      }
      if (pendingCleanup.length > 0) {
        try {
          await storage.remove(pendingCleanup.map((item) => item.objectPath));
        } catch (error) {
          reportFailure(
            diagnostics,
            "save_draft_evidence_cleanup_failed",
            error,
            {
              cleanupCount: pendingCleanup.length,
            },
          );
          return { status: "saved_cleanup_required" } as const;
        }
        for (const item of pendingCleanup) {
          try {
            await repository.completeDocumentCleanup(item.cleanupId);
          } catch (error) {
            reportFailure(
              diagnostics,
              "save_draft_evidence_audit_failed",
              error,
              { cleanupId: item.cleanupId },
            );
            return { status: "saved_deletion_audit_required" } as const;
          }
        }
      }
      return { status: "saved" } as const;
    },

    async submit() {
      let missingItems: string[];
      try {
        missingItems = await repository.missingItems();
      } catch (error) {
        reportFailure(
          diagnostics,
          "submission_completeness_check_failed",
          error,
        );
        return { status: "unavailable" } as const;
      }
      if (missingItems.length > 0) {
        return { status: "incomplete", missingItems } as const;
      }
      try {
        await repository.submit();
      } catch (error) {
        reportFailure(diagnostics, "submission_persistence_failed", error);
        return { status: "unavailable" } as const;
      }
      let application: OwnerApplicationSnapshot | null;
      try {
        application = await repository.load();
      } catch (error) {
        reportFailure(diagnostics, "submission_reload_failed", error);
        return { status: "unavailable" } as const;
      }
      if (!application || application.status !== "submitted") {
        reportFailure(
          diagnostics,
          "submission_state_unconfirmed",
          new Error("Submitted state was not returned"),
        );
        return { status: "unavailable" } as const;
      }
      return { status: "submitted", application } as const;
    },

    async uploadDocument(kind: unknown, file: VerificationUpload) {
      const extension = allowedMediaTypes.get(file.type);
      if (
        !isVerificationKind(kind) ||
        !extension ||
        !Number.isInteger(file.size) ||
        file.size < 1 ||
        file.size > verificationDocumentMaximumBytes ||
        file.bytes.byteLength !== file.size ||
        !bytesMatchMediaType(file.bytes, file.type) ||
        file.name.trim().length < 1 ||
        file.name.trim().length > 180
      ) {
        return { status: "invalid_document" } as const;
      }

      let application: OwnerApplicationSnapshot | null;
      try {
        application = await repository.load();
      } catch (error) {
        reportFailure(diagnostics, "document_application_load_failed", error, {
          documentKind: kind,
        });
        return { status: "unavailable" } as const;
      }
      if (
        !application ||
        !["draft", "needs_information", "expired"].includes(application.status)
      ) {
        return { status: "application_required" } as const;
      }
      if (
        !isVerificationDocumentKindRequired(
          kind,
          application.applicantKind,
          application.licensingBasis,
        )
      ) {
        return { status: "application_required" } as const;
      }
      let objectPath: string;
      try {
        objectPath = `${application.ownerUserId}/${application.applicationId}/${kind}/${createId()}.${extension}`;
      } catch (error) {
        reportFailure(
          diagnostics,
          "document_identifier_generation_failed",
          error,
          {
            applicationId: application.applicationId,
            documentKind: kind,
          },
        );
        return { status: "unavailable" } as const;
      }
      const normalizedFile = { ...file, name: file.name.trim() };

      let cleanupId: string;
      try {
        const contentDigest = await sha256Hex(file.bytes);
        cleanupId = await repository.prepareDocumentUpload({
          ownerUserId: application.ownerUserId,
          applicationId: application.applicationId,
          kind,
          objectPath,
          originalFilename: normalizedFile.name,
          mediaType: file.type,
          sizeBytes: file.size,
          contentDigest,
        });
      } catch (error) {
        reportFailure(diagnostics, "document_upload_prepare_failed", error, {
          applicationId: application.applicationId,
          documentKind: kind,
        });
        return { status: "unavailable" } as const;
      }
      try {
        await storage.upload(objectPath, normalizedFile);
      } catch (error) {
        reportFailure(diagnostics, "document_storage_upload_failed", error, {
          cleanupId,
          documentKind: kind,
        });
        try {
          await repository.completeDocumentCleanup(cleanupId);
        } catch (cleanupError) {
          reportFailure(
            diagnostics,
            "document_failed_upload_cleanup_audit_failed",
            cleanupError,
            { cleanupId, documentKind: kind },
          );
        }
        return { status: "unavailable" } as const;
      }

      let registered: RegisteredVerificationDocument;
      try {
        registered = await repository.registerDocument(cleanupId);
      } catch (registrationError) {
        reportFailure(
          diagnostics,
          "document_registration_response_failed",
          registrationError,
          { cleanupId, documentKind: kind },
        );
        let reconciliation: VerificationDocumentRegistrationReconciliation;
        try {
          reconciliation =
            await repository.reconcileDocumentRegistration(cleanupId);
        } catch (reconciliationError) {
          reportFailure(
            diagnostics,
            "document_registration_reconciliation_failed",
            reconciliationError,
            { cleanupId, documentKind: kind },
          );
          return { status: "registration_reconciliation_required" } as const;
        }
        if (reconciliation.status === "registered") {
          registered = reconciliation;
        } else {
          try {
            await storage.remove([objectPath]);
          } catch (cleanupError) {
            reportFailure(
              diagnostics,
              "document_unregistered_object_cleanup_failed",
              cleanupError,
              { cleanupId, documentKind: kind },
            );
            return { status: "failed_cleanup_required" } as const;
          }
          try {
            await repository.completeDocumentCleanup(cleanupId);
          } catch (cleanupAuditError) {
            reportFailure(
              diagnostics,
              "document_unregistered_cleanup_audit_failed",
              cleanupAuditError,
              { cleanupId, documentKind: kind },
            );
          }
          return { status: "unavailable" } as const;
        }
      }
      if (registered.previousObjectPath && registered.previousCleanupId) {
        try {
          await storage.remove([registered.previousObjectPath]);
        } catch (error) {
          reportFailure(
            diagnostics,
            "document_replacement_cleanup_failed",
            error,
            {
              cleanupId: registered.previousCleanupId,
              documentKind: kind,
            },
          );
          return { status: "uploaded_cleanup_required" } as const;
        }
        try {
          await repository.completeDocumentCleanup(
            registered.previousCleanupId,
          );
        } catch (error) {
          reportFailure(
            diagnostics,
            "document_replacement_audit_failed",
            error,
            {
              cleanupId: registered.previousCleanupId,
              documentKind: kind,
            },
          );
          return { status: "uploaded_deletion_audit_required" } as const;
        }
      }
      return { status: "uploaded" } as const;
    },

    async createDocumentAccess(documentId: unknown) {
      if (typeof documentId !== "string" || !uuidPattern.test(documentId)) {
        return { status: "denied" } as const;
      }
      let access: VerificationDocumentAccessPreparation;
      try {
        access = await repository.prepareDocumentAccess(documentId);
      } catch (error) {
        reportFailure(
          diagnostics,
          "document_access_preparation_failed",
          error,
          {
            documentId,
          },
        );
        return { status: "unavailable" } as const;
      }
      if (access.status === "denied") return access;
      const expiresInSeconds = 60;
      let url: string;
      try {
        url = await storage.createSignedUrl(
          access.objectPath,
          expiresInSeconds,
        );
      } catch (error) {
        reportFailure(
          diagnostics,
          "document_signed_url_creation_failed",
          error,
          {
            documentId,
            grantId: access.grantId,
          },
        );
        return { status: "unavailable" } as const;
      }
      try {
        const completion = await repository.completeDocumentAccess(
          access.grantId,
          expiresInSeconds,
        );
        if (completion === "expired") {
          return { status: "expired" } as const;
        }
      } catch (error) {
        reportFailure(diagnostics, "document_access_completion_failed", error, {
          documentId,
          grantId: access.grantId,
        });
        return { status: "unavailable" } as const;
      }
      return { status: "ready", url, expiresInSeconds } as const;
    },
  };
}
