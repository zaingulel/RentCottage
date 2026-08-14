export const verificationDocumentKinds = [
  "identity",
  "company_registration",
  "authorised_representative",
  "authority_to_rent",
  "licensing_or_exemption",
  "payout_account",
] as const;

export type VerificationDocumentKind =
  (typeof verificationDocumentKinds)[number];
export type OwnerApplicantKind = "individual" | "company";
export type OwnerLicensingBasis = "licence" | "exemption";
export type OwnerApplicationStatus = "draft" | "submitted";

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
}

export interface RegisteredVerificationDocument {
  documentId: string;
  previousObjectPath: string | null;
  previousCleanupId: string | null;
}

export interface OwnerApplicationRepository {
  load(): Promise<OwnerApplicationSnapshot | null>;
  saveDraft(draft: OwnerApplicationDraft): Promise<void>;
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
  }): Promise<string>;
  registerDocument(cleanupId: string): Promise<RegisteredVerificationDocument>;
  authorizeDocumentAccess(documentId: string): Promise<string>;
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
    bytes[2] === 0xff &&
    bytes.at(-2) === 0xff &&
    bytes.at(-1) === 0xd9
  );
}

export function createOwnerApplication({
  repository,
  storage,
  createId = crypto.randomUUID,
}: {
  repository: OwnerApplicationRepository;
  storage: VerificationDocumentStorage;
  createId?: () => string;
}) {
  return {
    load: () => repository.load(),

    async saveDraft(value: unknown) {
      const parsed = parseDraft(value);
      if (parsed.status === "invalid") return parsed;
      try {
        await repository.saveDraft(parsed.draft);
        return { status: "saved" } as const;
      } catch {
        return { status: "unavailable" } as const;
      }
    },

    async submit() {
      try {
        const missingItems = await repository.missingItems();
        if (missingItems.length > 0) {
          return { status: "incomplete", missingItems } as const;
        }
        await repository.submit();
        const application = await repository.load();
        if (!application || application.status !== "submitted") {
          return { status: "unavailable" } as const;
        }
        return { status: "submitted", application } as const;
      } catch {
        return { status: "unavailable" } as const;
      }
    },

    async uploadDocument(kind: unknown, file: VerificationUpload) {
      const extension = allowedMediaTypes.get(file.type);
      if (
        !isVerificationKind(kind) ||
        !extension ||
        !Number.isInteger(file.size) ||
        file.size < 1 ||
        file.size > 5_242_880 ||
        file.bytes.byteLength !== file.size ||
        !bytesMatchMediaType(file.bytes, file.type) ||
        file.name.trim().length < 1 ||
        file.name.trim().length > 180
      ) {
        return { status: "invalid_document" } as const;
      }

      const application = await repository.load();
      if (!application || application.status !== "draft") {
        return { status: "application_required" } as const;
      }
      const objectPath = `${application.ownerUserId}/${application.applicationId}/${kind}/${createId()}.${extension}`;
      const normalizedFile = { ...file, name: file.name.trim() };

      try {
        const cleanupId = await repository.prepareDocumentUpload({
          ownerUserId: application.ownerUserId,
          applicationId: application.applicationId,
          kind,
          objectPath,
          originalFilename: normalizedFile.name,
          mediaType: file.type,
          sizeBytes: file.size,
        });
        try {
          await storage.upload(objectPath, normalizedFile);
        } catch {
          await repository.completeDocumentCleanup(cleanupId).catch(() => {});
          return { status: "unavailable" } as const;
        }
        let registered: RegisteredVerificationDocument;
        try {
          registered = await repository.registerDocument(cleanupId);
        } catch {
          try {
            await storage.remove([objectPath]);
          } catch {
            return { status: "failed_cleanup_required" } as const;
          }
          await repository.completeDocumentCleanup(cleanupId).catch(() => {});
          return { status: "unavailable" } as const;
        }
        if (registered.previousObjectPath && registered.previousCleanupId) {
          try {
            await storage.remove([registered.previousObjectPath]);
          } catch {
            return { status: "uploaded_cleanup_required" } as const;
          }
          try {
            await repository.completeDocumentCleanup(
              registered.previousCleanupId,
            );
          } catch {
            return { status: "uploaded_deletion_audit_required" } as const;
          }
        }
        return { status: "uploaded" } as const;
      } catch {
        return { status: "unavailable" } as const;
      }
    },

    async createDocumentAccess(documentId: unknown) {
      if (typeof documentId !== "string" || !uuidPattern.test(documentId)) {
        return { status: "denied" } as const;
      }
      try {
        const objectPath = await repository.authorizeDocumentAccess(documentId);
        const url = await storage.createSignedUrl(objectPath, 60);
        return { status: "ready", url, expiresInSeconds: 60 } as const;
      } catch {
        return { status: "unavailable" } as const;
      }
    },
  };
}
