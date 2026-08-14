"use server";

import { revalidatePath } from "next/cache";

import { isLocale } from "@/i18n/routing";

import { createRequestOwnerApplication } from "./request-owner-application";

export type SaveOwnerApplicationState =
  | { status: "idle" | "saved" | "unavailable" }
  | { status: "invalid"; fields: string[] };

export type UploadOwnerDocumentState = {
  status:
    | "idle"
    | "uploaded"
    | "uploaded_cleanup_required"
    | "uploaded_deletion_audit_required"
    | "failed_cleanup_required"
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

export async function saveOwnerApplicationAction(
  _previous: SaveOwnerApplicationState,
  formData: FormData,
): Promise<SaveOwnerApplicationState> {
  const locale = localeFrom(formData);
  if (!locale) return { status: "unavailable" };
  const application = await createRequestOwnerApplication();
  const result = await application.saveDraft({
    applicantKind: formData.get("applicantKind"),
    legalName: formData.get("legalName"),
    companyName: formData.get("companyName"),
    licensingBasis: formData.get("licensingBasis"),
    exemptionBasis: formData.get("exemptionBasis"),
    cottageName: formData.get("cottageName"),
    governorate: formData.get("governorate"),
    approximateLocation: formData.get("approximateLocation"),
    exactAddress: formData.get("exactAddress"),
    capacity: formData.get("capacity"),
    bedrooms: formData.get("bedrooms"),
    bathrooms: formData.get("bathrooms"),
    amenities: formData.getAll("amenities"),
    description: formData.get("description"),
    houseRules: formData.get("houseRules"),
  });
  if (result.status === "saved") {
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
  if (!locale || !(document instanceof File)) {
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
    result.status === "uploaded_deletion_audit_required"
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
