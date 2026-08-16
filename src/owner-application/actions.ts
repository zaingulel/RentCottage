"use server";

import { revalidatePath } from "next/cache";

import { isLocale } from "@/i18n/routing";
import { verificationDocumentMaximumBytes } from "./owner-application";
import {
  executeOwnerApplicationInformationResponse,
  executeOwnerApplicationRenewalSubmission,
} from "./owner-application-review";
import { createRequestSupabaseClient } from "@/access/supabase-server";

import { createRequestOwnerApplication } from "./request-owner-application";

export type SaveOwnerApplicationState =
  | {
      status:
        | "idle"
        | "saved"
        | "saved_cleanup_required"
        | "saved_deletion_audit_required"
        | "unavailable";
    }
  | {
      status: "invalid";
      fields: string[];
      values: OwnerApplicationFormValues;
    };

export interface OwnerApplicationFormValues {
  applicantKind: string;
  legalName: string;
  companyName: string;
  licensingBasis: string;
  exemptionBasis: string;
  cottageName: string;
  governorate: string;
  approximateLocation: string;
  exactAddress: string;
  capacity: string;
  bedrooms: string;
  bathrooms: string;
  amenities: string[];
  description: string;
  houseRules: string;
}

export type UploadOwnerDocumentState = {
  status:
    | "idle"
    | "uploaded"
    | "uploaded_cleanup_required"
    | "uploaded_deletion_audit_required"
    | "failed_cleanup_required"
    | "registration_reconciliation_required"
    | "invalid_document"
    | "application_required"
    | "unavailable";
};

export type SubmitOwnerApplicationState =
  | { status: "idle" | "submitted" | "unavailable" }
  | { status: "incomplete"; missingItems: string[] };

export type OwnerDocumentAccessState =
  | { status: "idle" | "denied" | "unavailable" | "expired" }
  | {
      status: "ready";
      url: string;
      expiresInSeconds: number;
    };

export type OwnerApplicationResponseState = {
  status: "idle" | "submitted" | "invalid" | "unavailable";
};

function localeFrom(formData: FormData) {
  const value = formData.get("locale");
  return typeof value === "string" && isLocale(value) ? value : undefined;
}

function textFrom(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function valuesFrom(formData: FormData): OwnerApplicationFormValues {
  return {
    applicantKind: textFrom(formData, "applicantKind"),
    legalName: textFrom(formData, "legalName"),
    companyName: textFrom(formData, "companyName"),
    licensingBasis: textFrom(formData, "licensingBasis"),
    exemptionBasis: textFrom(formData, "exemptionBasis"),
    cottageName: textFrom(formData, "cottageName"),
    governorate: textFrom(formData, "governorate"),
    approximateLocation: textFrom(formData, "approximateLocation"),
    exactAddress: textFrom(formData, "exactAddress"),
    capacity: textFrom(formData, "capacity"),
    bedrooms: textFrom(formData, "bedrooms"),
    bathrooms: textFrom(formData, "bathrooms"),
    amenities: formData
      .getAll("amenities")
      .filter((value): value is string => typeof value === "string"),
    description: textFrom(formData, "description"),
    houseRules: textFrom(formData, "houseRules"),
  };
}

export async function saveOwnerApplicationAction(
  _previous: SaveOwnerApplicationState,
  formData: FormData,
): Promise<SaveOwnerApplicationState> {
  const locale = localeFrom(formData);
  if (!locale) return { status: "unavailable" };
  const application = await createRequestOwnerApplication();
  const values = valuesFrom(formData);
  const result = await application.saveDraft(values);
  if (result.status === "invalid") {
    return { ...result, values };
  }
  if (
    result.status === "saved" ||
    result.status === "saved_cleanup_required" ||
    result.status === "saved_deletion_audit_required"
  ) {
    revalidatePath(`/${locale}/owner/application`);
  }
  return result;
}

export async function uploadOwnerDocumentAction(
  _previous: UploadOwnerDocumentState,
  formData: FormData,
): Promise<UploadOwnerDocumentState> {
  const locale = localeFrom(formData);
  const kind = formData.get("kind");
  const document = formData.get("document");
  if (!locale) return { status: "unavailable" };
  if (!(document instanceof File)) {
    return { status: "invalid_document" };
  }
  if (document.size < 1 || document.size > verificationDocumentMaximumBytes) {
    return { status: "invalid_document" };
  }
  const application = await createRequestOwnerApplication();
  const result = await application.uploadDocument(kind, {
    name: document.name,
    type: document.type,
    size: document.size,
    bytes: new Uint8Array(await document.arrayBuffer()),
  });
  if (
    result.status === "uploaded" ||
    result.status === "uploaded_cleanup_required" ||
    result.status === "uploaded_deletion_audit_required" ||
    result.status === "registration_reconciliation_required"
  ) {
    revalidatePath(`/${locale}/owner/application`);
  }
  return result;
}

export async function submitOwnerApplicationAction(
  _previous: SubmitOwnerApplicationState,
  formData: FormData,
): Promise<SubmitOwnerApplicationState> {
  const locale = localeFrom(formData);
  if (!locale) return { status: "unavailable" };
  const application = await createRequestOwnerApplication();
  const result = await application.submit();
  if (result.status === "submitted") {
    revalidatePath(`/${locale}/owner/application`);
    return { status: "submitted" };
  }
  return result;
}

export async function createOwnerDocumentAccessAction(
  _previous: OwnerDocumentAccessState,
  formData: FormData,
): Promise<OwnerDocumentAccessState> {
  const application = await createRequestOwnerApplication();
  return application.createDocumentAccess(formData.get("documentId"));
}

export async function respondToOwnerApplicationAction(
  _previous: OwnerApplicationResponseState,
  formData: FormData,
): Promise<OwnerApplicationResponseState> {
  const locale = localeFrom(formData);
  if (!locale) return { status: "invalid" };
  const requestedFields = formData
    .getAll("requestedField")
    .filter((value): value is string => typeof value === "string");
  const fieldValues: Record<string, unknown> = {};
  for (const field of requestedFields) {
    const values = formData
      .getAll(field)
      .filter((value): value is string => typeof value === "string");
    if (field === "amenities") fieldValues[field] = values;
    else if (["capacity", "bedrooms", "bathrooms"].includes(field)) {
      fieldValues[field] = Number(values[0]);
    } else fieldValues[field] = values[0] ?? "";
  }
  try {
    const client = await createRequestSupabaseClient();
    await executeOwnerApplicationInformationResponse(client, {
      expectedVersion: Number(textFrom(formData, "expectedVersion")),
      fieldValues,
      confirmedDocumentKinds: formData
        .getAll("confirmedDocumentKinds")
        .filter((value): value is string => typeof value === "string"),
    });
  } catch (error) {
    return {
      status:
        error instanceof Error &&
        error.message === "Owner Application review command is invalid"
          ? "invalid"
          : "unavailable",
    };
  }
  revalidatePath(`/${locale}/owner/application`);
  revalidatePath(`/${locale}/administrator/owner-applications`);
  return { status: "submitted" };
}

export async function submitOwnerApplicationRenewalAction(
  _previous: OwnerApplicationResponseState,
  formData: FormData,
): Promise<OwnerApplicationResponseState> {
  const locale = localeFrom(formData);
  if (!locale) return { status: "invalid" };
  try {
    const client = await createRequestSupabaseClient();
    await executeOwnerApplicationRenewalSubmission(client, {
      expectedVersion: Number(textFrom(formData, "expectedVersion")),
      confirmedDocumentKinds: formData
        .getAll("confirmedDocumentKinds")
        .filter((value): value is string => typeof value === "string"),
    });
  } catch {
    return { status: "unavailable" };
  }
  revalidatePath(`/${locale}/owner/application`);
  revalidatePath(`/${locale}/administrator/owner-applications`);
  return { status: "submitted" };
}
