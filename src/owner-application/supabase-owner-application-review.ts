import type { SupabaseClient } from "@supabase/supabase-js";

import {
  ownerApplicationResponseFields,
  type OwnerApplicationResponseField,
} from "./owner-application-review";
import {
  isOwnerApplicationStatus,
  type OwnerApplicationStatus,
} from "./owner-application-status";
import {
  verificationDocumentKinds,
  type OwnerApplicantKind,
  type OwnerLicensingBasis,
  type OwnerVerificationDocument,
  type VerificationDocumentKind,
} from "./owner-application";

export interface OwnerApplicationReviewDetail {
  applicationId: string;
  version: number;
  status: OwnerApplicationStatus;
  submittedAt: string;
  reviewDueAt: string | null;
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
  activeInformationRequest: {
    reason: string;
    requestedFields: OwnerApplicationResponseField[];
    requestedDocumentKinds: VerificationDocumentKind[];
    requestedAt: string;
  } | null;
  transitions: Array<{
    fromStatus: OwnerApplicationStatus;
    toStatus: OwnerApplicationStatus;
    occurredAt: string;
    reason: string;
  }>;
}

export interface OwnerApplicationOwnerReview {
  activeRequest: {
    reason: string;
    requestedFields: OwnerApplicationResponseField[];
    requestedDocumentKinds: VerificationDocumentKind[];
  } | null;
  renewalDocumentKinds: VerificationDocumentKind[];
  notices: Array<{
    kind:
      | "information_requested"
      | "response_received"
      | "approved"
      | "rejected"
      | "expired"
      | "suspended";
    reason: string;
    createdAt: string;
  }>;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Owner Application review detail is invalid");
  }
  return value as Record<string, unknown>;
}

function requiredText(value: unknown): string {
  if (typeof value !== "string" || value.length < 1) {
    throw new Error("Owner Application review detail is invalid");
  }
  return value;
}

function optionalText(value: unknown): string {
  if (value === null) return "";
  return requiredText(value);
}

function integerOrNull(value: unknown): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value)) {
    throw new Error("Owner Application review detail is invalid");
  }
  return value as number;
}

function assertSuccess(error: unknown): void {
  if (error) throw new Error("Owner Application review detail is unavailable");
}

export async function loadOwnerApplicationReviewDetail(
  client: SupabaseClient,
  applicationId: string,
): Promise<OwnerApplicationReviewDetail | null> {
  if (!uuidPattern.test(applicationId)) {
    throw new Error("Owner Application review identifier is invalid");
  }
  const applicationResult = await client
    .from("owner_applications")
    .select(
      "id, version, status, submitted_at, review_due_at, applicant_kind, legal_name, company_name, licensing_basis, exemption_basis",
    )
    .eq("id", applicationId)
    .maybeSingle();
  assertSuccess(applicationResult.error);
  if (!applicationResult.data) return null;

  const [profileResult, documentsResult, requestResult, transitionsResult] =
    await Promise.all([
      client
        .from("owner_application_cottage_profiles")
        .select(
          "name, governorate, approximate_location, exact_address, capacity, bedrooms, bathrooms, amenities, description, house_rules",
        )
        .eq("application_id", applicationId)
        .maybeSingle(),
      client
        .from("owner_verification_documents")
        .select(
          "id, kind, original_filename, media_type, size_bytes, updated_at",
        )
        .eq("application_id", applicationId)
        .order("kind"),
      client
        .from("owner_application_information_requests")
        .select(
          "reason, requested_fields, requested_document_kinds, requested_at",
        )
        .eq("application_id", applicationId)
        .is("responded_at", null)
        .maybeSingle(),
      client
        .from("owner_application_transitions")
        .select("from_status, to_status, occurred_at, reason")
        .eq("application_id", applicationId)
        .order("occurred_at"),
    ]);
  for (const result of [
    profileResult,
    documentsResult,
    requestResult,
    transitionsResult,
  ]) {
    assertSuccess(result.error);
  }
  if (!profileResult.data || !Array.isArray(documentsResult.data)) {
    throw new Error("Owner Application review detail is invalid");
  }

  const application = row(applicationResult.data);
  const profile = row(profileResult.data);
  const status = application.status;
  const applicantKind = application.applicant_kind;
  const licensingBasis = application.licensing_basis;
  if (
    !isOwnerApplicationStatus(status) ||
    status === "draft" ||
    !Number.isInteger(application.version) ||
    (applicantKind !== "individual" && applicantKind !== "company") ||
    (licensingBasis !== "licence" && licensingBasis !== "exemption") ||
    !Array.isArray(profile.amenities) ||
    !profile.amenities.every((value) => typeof value === "string")
  ) {
    throw new Error("Owner Application review detail is invalid");
  }

  const documents = documentsResult.data.map((value) => {
    const document = row(value);
    const kind = document.kind as VerificationDocumentKind;
    if (
      !uuidPattern.test(requiredText(document.id)) ||
      !verificationDocumentKinds.includes(kind) ||
      !Number.isInteger(document.size_bytes)
    ) {
      throw new Error("Owner Application review evidence is invalid");
    }
    return {
      id: document.id as string,
      kind,
      originalFilename: requiredText(document.original_filename),
      mediaType: requiredText(document.media_type),
      sizeBytes: document.size_bytes as number,
      updatedAt: requiredText(document.updated_at),
    };
  });

  const request = requestResult.data ? row(requestResult.data) : null;
  const requestedFields = request?.requested_fields;
  const requestedKinds = request?.requested_document_kinds;
  if (
    request &&
    (!Array.isArray(requestedFields) ||
      !requestedFields.every((value) =>
        ownerApplicationResponseFields.includes(
          value as OwnerApplicationResponseField,
        ),
      ) ||
      !Array.isArray(requestedKinds) ||
      !requestedKinds.every((value) =>
        verificationDocumentKinds.includes(value as VerificationDocumentKind),
      ))
  ) {
    throw new Error("Owner Application information request is invalid");
  }

  return {
    applicationId: requiredText(application.id),
    version: application.version as number,
    status,
    submittedAt: requiredText(application.submitted_at),
    reviewDueAt:
      application.review_due_at === null
        ? null
        : requiredText(application.review_due_at),
    applicantKind,
    legalName: requiredText(application.legal_name),
    companyName: optionalText(application.company_name),
    licensingBasis,
    exemptionBasis: optionalText(application.exemption_basis),
    cottage: {
      name: requiredText(profile.name),
      governorate: requiredText(profile.governorate),
      approximateLocation: requiredText(profile.approximate_location),
      exactAddress: requiredText(profile.exact_address),
      capacity: integerOrNull(profile.capacity),
      bedrooms: integerOrNull(profile.bedrooms),
      bathrooms: integerOrNull(profile.bathrooms),
      amenities: profile.amenities as string[],
      description: requiredText(profile.description),
      houseRules: requiredText(profile.house_rules),
    },
    documents,
    activeInformationRequest: request
      ? {
          reason: requiredText(request.reason),
          requestedFields: requestedFields as OwnerApplicationResponseField[],
          requestedDocumentKinds: requestedKinds as VerificationDocumentKind[],
          requestedAt: requiredText(request.requested_at),
        }
      : null,
    transitions: (transitionsResult.data ?? []).map((value) => {
      const transition = row(value);
      const fromStatus = transition.from_status;
      const toStatus = transition.to_status;
      if (
        !isOwnerApplicationStatus(fromStatus) ||
        !isOwnerApplicationStatus(toStatus)
      ) {
        throw new Error("Owner Application transition is invalid");
      }
      return {
        fromStatus,
        toStatus,
        occurredAt: requiredText(transition.occurred_at),
        reason: optionalText(transition.reason),
      };
    }),
  };
}

export async function loadOwnerApplicationOwnerReview(
  client: SupabaseClient,
  applicationId: string,
): Promise<OwnerApplicationOwnerReview> {
  if (!uuidPattern.test(applicationId)) {
    throw new Error("Owner Application identifier is invalid");
  }
  const [requestResult, renewalResult, noticesResult] = await Promise.all([
    client.rpc("owner_application_active_information_request"),
    client
      .from("owner_application_renewal_work")
      .select("requested_document_kinds")
      .eq("application_id", applicationId)
      .in("status", ["open", "submitted"])
      .maybeSingle(),
    client
      .from("owner_application_notices")
      .select("kind, reason, created_at")
      .eq("application_id", applicationId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  for (const result of [requestResult, renewalResult, noticesResult]) {
    assertSuccess(result.error);
  }
  const request = requestResult.data ? row(requestResult.data) : null;
  const requestedFields = request?.requested_fields;
  const requestedKinds = request?.requested_document_kinds;
  const renewal = renewalResult.data ? row(renewalResult.data) : null;
  const renewalKinds = renewal?.requested_document_kinds ?? [];
  if (
    (request &&
      (!Array.isArray(requestedFields) ||
        !requestedFields.every((value) =>
          ownerApplicationResponseFields.includes(
            value as OwnerApplicationResponseField,
          ),
        ) ||
        !Array.isArray(requestedKinds) ||
        !requestedKinds.every((value) =>
          verificationDocumentKinds.includes(value as VerificationDocumentKind),
        ))) ||
    !Array.isArray(renewalKinds) ||
    !renewalKinds.every((value) =>
      verificationDocumentKinds.includes(value as VerificationDocumentKind),
    ) ||
    !Array.isArray(noticesResult.data)
  ) {
    throw new Error("Owner Application owner review data is invalid");
  }
  return {
    activeRequest: request
      ? {
          reason: requiredText(request.reason),
          requestedFields: requestedFields as OwnerApplicationResponseField[],
          requestedDocumentKinds: requestedKinds as VerificationDocumentKind[],
        }
      : null,
    renewalDocumentKinds: renewalKinds as VerificationDocumentKind[],
    notices: noticesResult.data.map((value) => {
      const notice = row(value);
      const kind = notice.kind;
      if (
        kind !== "information_requested" &&
        kind !== "response_received" &&
        kind !== "approved" &&
        kind !== "rejected" &&
        kind !== "expired" &&
        kind !== "suspended"
      ) {
        throw new Error("Owner Application notice is invalid");
      }
      return {
        kind,
        reason: optionalText(notice.reason),
        createdAt: requiredText(notice.created_at),
      };
    }),
  };
}
