"use server";

import { revalidatePath } from "next/cache";

import { isLocale } from "@/i18n/routing";

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
  | { status: "idle" | "denied" | "unavailable" }
  | {
      status: "ready";
      url: string;
      expiresInSeconds: number;
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
