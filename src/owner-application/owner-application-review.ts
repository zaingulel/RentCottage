import type { SupabaseClient } from "@supabase/supabase-js";

import {
  verificationDocumentKinds,
  type OwnerLicensingBasis,
  type VerificationDocumentKind,
} from "./owner-application";
import {
  isOwnerApplicationStatus,
  type OwnerApplicationStatus,
} from "./owner-application-status";

export { ownerApplicationStatuses } from "./owner-application-status";
export type { OwnerApplicationStatus } from "./owner-application-status";

export const ownerApplicationResponseFields = [
  "legal_name",
  "company_name",
  "licensing_basis",
  "exemption_basis",
  "cottage_name",
  "governorate",
  "approximate_location",
  "exact_address",
  "capacity",
  "bedrooms",
  "bathrooms",
  "amenities",
  "description",
  "house_rules",
] as const;

export type OwnerApplicationResponseField =
  (typeof ownerApplicationResponseFields)[number];

type ReviewCommandBase = {
  applicationId: string;
  expectedVersion: number;
};

export type OwnerApplicationReviewCommand =
  | (ReviewCommandBase & { action: "start_review" })
  | (ReviewCommandBase & {
      action: "request_information";
      reason: string;
      requestedFields: OwnerApplicationResponseField[];
      requestedDocumentKinds: VerificationDocumentKind[];
    })
  | (ReviewCommandBase & {
      action: "approve";
      reason: string;
      jurisdiction: string;
      licensingBasis: OwnerLicensingBasis;
      licenceOrExemptionBasis: string;
      relevantExpiryDates: Partial<Record<VerificationDocumentKind, string>>;
    })
  | (ReviewCommandBase & { action: "reject"; reason: string })
  | (ReviewCommandBase & { action: "suspend"; reason: string });

export interface OwnerApplicationReviewResult {
  applicationId: string;
  status: OwnerApplicationStatus;
  version: number;
  occurredAt: string;
  reviewDueAt: string | null;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDate(value: string): boolean {
  if (!datePattern.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function invalid(): never {
  throw new Error("Owner Application review command is invalid");
}

const conflictMessage =
  "Owner Application review command conflicts with newer data";

function providerErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function providerFailure(error: unknown, unavailableMessage: string): never {
  const code = providerErrorCode(error);
  if (code === "RC422") invalid();
  if (code === "RC409") throw new Error(conflictMessage);
  throw new Error(unavailableMessage);
}

export function ownerApplicationReviewFailureStatus(
  error: unknown,
): "invalid" | "conflict" | "unavailable" {
  if (!(error instanceof Error)) return "unavailable";
  if (error.message === "Owner Application review command is invalid") {
    return "invalid";
  }
  if (error.message === conflictMessage) return "conflict";
  return "unavailable";
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function boundedText(value: unknown, maximum = 1000): string {
  if (typeof value !== "string") invalid();
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > maximum) invalid();
  return normalized;
}

function baseFor(input: Record<string, unknown>): ReviewCommandBase {
  if (
    typeof input.applicationId !== "string" ||
    !uuidPattern.test(input.applicationId) ||
    !Number.isInteger(input.expectedVersion) ||
    (input.expectedVersion as number) < 1
  ) {
    invalid();
  }
  return {
    applicationId: input.applicationId,
    expectedVersion: input.expectedVersion as number,
  };
}

function uniqueKnownValues<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T[] {
  if (!Array.isArray(value)) invalid();
  const values = [...new Set(value)];
  if (!values.every((item): item is T => allowed.includes(item as T))) {
    invalid();
  }
  return values;
}

export function parseOwnerApplicationReviewCommand(
  value: unknown,
): OwnerApplicationReviewCommand {
  const input = record(value);
  const base = baseFor(input);
  if (input.action === "start_review") {
    return { action: input.action, ...base };
  }
  if (input.action === "request_information") {
    const requestedFields = uniqueKnownValues(
      input.requestedFields,
      ownerApplicationResponseFields,
    );
    const requestedDocumentKinds = uniqueKnownValues(
      input.requestedDocumentKinds,
      verificationDocumentKinds,
    );
    if (requestedFields.length + requestedDocumentKinds.length < 1) invalid();
    return {
      action: input.action,
      ...base,
      reason: boundedText(input.reason),
      requestedFields,
      requestedDocumentKinds,
    };
  }
  if (input.action === "approve") {
    if (
      input.licensingBasis !== "licence" &&
      input.licensingBasis !== "exemption"
    ) {
      invalid();
    }
    const expiryInput = record(input.relevantExpiryDates);
    const relevantExpiryDates: Partial<
      Record<VerificationDocumentKind, string>
    > = {};
    for (const [kind, expiry] of Object.entries(expiryInput)) {
      if (
        !verificationDocumentKinds.includes(kind as VerificationDocumentKind) ||
        typeof expiry !== "string" ||
        !isCalendarDate(expiry)
      ) {
        invalid();
      }
      relevantExpiryDates[kind as VerificationDocumentKind] = expiry;
    }
    return {
      action: input.action,
      ...base,
      reason: boundedText(input.reason),
      jurisdiction: boundedText(input.jurisdiction, 120),
      licensingBasis: input.licensingBasis,
      licenceOrExemptionBasis: boundedText(input.licenceOrExemptionBasis, 1000),
      relevantExpiryDates,
    };
  }
  if (input.action === "reject" || input.action === "suspend") {
    return {
      action: input.action,
      ...base,
      reason: boundedText(input.reason),
    };
  }
  return invalid();
}

export function parseOwnerApplicationReviewResult(
  value: unknown,
): OwnerApplicationReviewResult {
  const input = record(value);
  if (
    typeof input.application_id !== "string" ||
    !uuidPattern.test(input.application_id) ||
    !isOwnerApplicationStatus(input.status) ||
    !Number.isInteger(input.version) ||
    (input.version as number) < 1 ||
    typeof input.occurred_at !== "string" ||
    Number.isNaN(Date.parse(input.occurred_at)) ||
    (input.review_due_at !== null &&
      (typeof input.review_due_at !== "string" ||
        Number.isNaN(Date.parse(input.review_due_at))))
  ) {
    throw new Error("Owner Application review result is invalid");
  }
  return {
    applicationId: input.application_id,
    status: input.status,
    version: input.version as number,
    occurredAt: input.occurred_at,
    reviewDueAt: input.review_due_at as string | null,
  };
}

export async function executeOwnerApplicationReviewCommand(
  client: SupabaseClient,
  value: unknown,
): Promise<OwnerApplicationReviewResult> {
  const command = parseOwnerApplicationReviewCommand(value);
  const approval = command.action === "approve" ? command : undefined;
  const information =
    command.action === "request_information" ? command : undefined;
  const { data, error } = await client.rpc("review_owner_application", {
    target_application_id: command.applicationId,
    expected_version: command.expectedVersion,
    requested_action: command.action,
    requested_reason: command.action === "start_review" ? null : command.reason,
    requested_fields: information?.requestedFields ?? [],
    requested_document_kinds: information?.requestedDocumentKinds ?? [],
    requested_jurisdiction: approval?.jurisdiction ?? null,
    requested_licensing_basis: approval?.licensingBasis ?? null,
    requested_licence_or_exemption_basis:
      approval?.licenceOrExemptionBasis ?? null,
    requested_expiry_dates: approval?.relevantExpiryDates ?? {},
  });
  if (error) providerFailure(error, "Owner Application review is unavailable");
  return parseOwnerApplicationReviewResult(data);
}

function parseResponseFieldValue(
  field: OwnerApplicationResponseField,
  value: unknown,
): string | number | string[] {
  const requiredTextMaximums: Partial<
    Record<OwnerApplicationResponseField, number>
  > = {
    legal_name: 120,
    cottage_name: 120,
    governorate: 120,
    approximate_location: 240,
    exact_address: 240,
    description: 2000,
    house_rules: 1500,
  };
  const requiredMaximum = requiredTextMaximums[field];
  if (requiredMaximum !== undefined) return boundedText(value, requiredMaximum);
  if (field === "company_name" || field === "exemption_basis") {
    if (typeof value !== "string") invalid();
    const normalized = value.trim();
    if (normalized.length > (field === "company_name" ? 120 : 1000)) invalid();
    return normalized;
  }
  if (field === "licensing_basis") {
    if (value !== "licence" && value !== "exemption") invalid();
    return value;
  }
  if (field === "capacity" || field === "bedrooms" || field === "bathrooms") {
    const maximum = field === "capacity" ? 100 : 50;
    if (
      !Number.isInteger(value) ||
      (value as number) < 1 ||
      (value as number) > maximum
    ) {
      invalid();
    }
    return value as number;
  }
  if (field === "amenities") {
    const allowed = [
      "garden",
      "parking",
      "pool",
      "air_conditioning",
      "wifi",
      "outdoor_seating",
    ] as const;
    if (
      !Array.isArray(value) ||
      value.length > 6 ||
      !value.every((item): item is string =>
        allowed.includes(item as (typeof allowed)[number]),
      )
    ) {
      invalid();
    }
    return value;
  }
  return invalid();
}

export async function executeOwnerApplicationInformationResponse(
  client: SupabaseClient,
  value: unknown,
): Promise<OwnerApplicationReviewResult> {
  const input = record(value);
  if (
    !Number.isInteger(input.expectedVersion) ||
    (input.expectedVersion as number) < 1 ||
    !input.fieldValues ||
    typeof input.fieldValues !== "object" ||
    Array.isArray(input.fieldValues)
  ) {
    invalid();
  }
  const suppliedFieldValues = input.fieldValues as Record<string, unknown>;
  const fieldValues: Record<string, string | number | string[]> = {};
  for (const [field, fieldValue] of Object.entries(suppliedFieldValues)) {
    if (
      !ownerApplicationResponseFields.includes(
        field as OwnerApplicationResponseField,
      )
    ) {
      invalid();
    }
    fieldValues[field] = parseResponseFieldValue(
      field as OwnerApplicationResponseField,
      fieldValue,
    );
  }
  const confirmedDocumentKinds = uniqueKnownValues(
    input.confirmedDocumentKinds,
    verificationDocumentKinds,
  );
  const { data, error } = await client.rpc(
    "respond_to_owner_application_request",
    {
      expected_version: input.expectedVersion as number,
      requested_field_values: fieldValues,
      confirmed_document_kinds: confirmedDocumentKinds,
    },
  );
  if (error)
    providerFailure(error, "Owner Application response is unavailable");
  return parseOwnerApplicationReviewResult(data);
}

export async function executeOwnerApplicationRenewalSubmission(
  client: SupabaseClient,
  value: unknown,
): Promise<OwnerApplicationReviewResult> {
  const input = record(value);
  if (
    !Number.isInteger(input.expectedVersion) ||
    (input.expectedVersion as number) < 1
  ) {
    invalid();
  }
  const confirmedDocumentKinds = uniqueKnownValues(
    input.confirmedDocumentKinds,
    verificationDocumentKinds,
  );
  if (confirmedDocumentKinds.length < 1) invalid();
  const { data, error } = await client.rpc("submit_owner_application_renewal", {
    expected_version: input.expectedVersion as number,
    confirmed_document_kinds: confirmedDocumentKinds,
  });
  if (error) providerFailure(error, "Owner Application renewal is unavailable");
  return parseOwnerApplicationReviewResult(data);
}
