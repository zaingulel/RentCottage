"use server";

import { revalidatePath } from "next/cache";

import { isLocale, type Locale } from "@/i18n/routing";
import { cottageProfileMaximumPhotoBytes } from "./cottage-profile";
import { createRequestCottageProfile } from "./request-cottage-profile";

export type CottageProfileActionState = {
  status:
    | "idle"
    | "saved"
    | "created"
    | "uploaded"
    | "deleted"
    | "submitted"
    | "invalid"
    | "invalid_photo"
    | "incomplete"
    | "conflict"
    | "denied"
    | "upload_reconciliation_required"
    | "registration_reconciliation_required"
    | "deletion_reconciliation_required"
    | "unavailable";
  fields?: string[];
  profileId?: string;
};

export type CottagePhotoPreviewState =
  | { status: "idle" | "denied" | "unavailable" }
  | { status: "ready"; url: string; expiresInSeconds: number };

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function locale(formData: FormData): Locale | undefined {
  const value = text(formData, "locale");
  return isLocale(value) ? value : undefined;
}

function draftValues(formData: FormData) {
  return {
    name: text(formData, "name"),
    governorate: text(formData, "governorate"),
    approximateLocation: text(formData, "approximateLocation"),
    exactAddress: text(formData, "exactAddress"),
    exactLatitude: text(formData, "exactLatitude"),
    exactLongitude: text(formData, "exactLongitude"),
    privateDirections: text(formData, "privateDirections"),
    capacity: text(formData, "capacity"),
    bedrooms: text(formData, "bedrooms"),
    bathrooms: text(formData, "bathrooms"),
    amenities: formData
      .getAll("amenities")
      .filter((value): value is string => typeof value === "string"),
    sourceLanguage: text(formData, "sourceLanguage"),
    description: text(formData, "description"),
    houseRules: text(formData, "houseRules"),
  };
}

function revalidateOwnerPaths(requestedLocale: Locale, profileId: string) {
  revalidatePath(`/${requestedLocale}/owner/cottages/${profileId}`);
  revalidatePath(`/${requestedLocale}/owner/cottages`);
}

function revalidateAdministratorPaths(
  requestedLocale: Locale,
  profileId: string,
) {
  revalidatePath(`/${requestedLocale}/administrator/cottages/${profileId}`);
  revalidatePath(`/${requestedLocale}/administrator/cottages`);
}

export async function saveOwnerCottageProfileAction(
  _previous: CottageProfileActionState,
  formData: FormData,
): Promise<CottageProfileActionState> {
  const requestedLocale = locale(formData);
  if (!requestedLocale) return { status: "invalid" };
  const profileId = text(formData, "profileId");
  const cottageProfile = await createRequestCottageProfile();
  const result = await cottageProfile.saveOwnerDraft(
    profileId,
    Number(text(formData, "expectedVersion")),
    draftValues(formData),
  );
  if (result.status === "saved") {
    revalidateOwnerPaths(requestedLocale, profileId);
    return { status: "saved" };
  }
  return result;
}

export async function saveAdministratorCottageProfileAction(
  _previous: CottageProfileActionState,
  formData: FormData,
): Promise<CottageProfileActionState> {
  const requestedLocale = locale(formData);
  if (!requestedLocale) return { status: "invalid" };
  const profileId = text(formData, "profileId");
  const cottageProfile = await createRequestCottageProfile();
  const result = await cottageProfile.saveAdministratorDraft(
    profileId,
    Number(text(formData, "expectedVersion")),
    draftValues(formData),
  );
  if (result.status === "saved") {
    revalidateAdministratorPaths(requestedLocale, profileId);
    return { status: "saved" };
  }
  return result;
}

export async function createCottageProfileDraftAction(
  _previous: CottageProfileActionState,
  formData: FormData,
): Promise<CottageProfileActionState> {
  const requestedLocale = locale(formData);
  if (!requestedLocale) return { status: "invalid" };
  const cottageProfile = await createRequestCottageProfile();
  const result = await cottageProfile.createDraft();
  if (result.status === "created") {
    revalidateOwnerPaths(requestedLocale, result.profile.id);
    return { status: "created", profileId: result.profile.id };
  }
  return result;
}

export async function uploadCottageProfilePhotoAction(
  _previous: CottageProfileActionState,
  formData: FormData,
): Promise<CottageProfileActionState> {
  const requestedLocale = locale(formData);
  const profileId = text(formData, "profileId");
  const photo = formData.get("photo");
  if (
    !requestedLocale ||
    !(photo instanceof File) ||
    !Number.isInteger(photo.size) ||
    photo.size < 1 ||
    photo.size > cottageProfileMaximumPhotoBytes
  ) {
    return { status: "invalid_photo" };
  }
  const cottageProfile = await createRequestCottageProfile();
  const result = await cottageProfile.uploadPhoto(profileId, {
    name: photo.name,
    type: photo.type,
    size: photo.size,
    bytes: new Uint8Array(await photo.arrayBuffer()),
  });
  if (result.status === "uploaded") {
    revalidateOwnerPaths(requestedLocale, profileId);
    revalidateAdministratorPaths(requestedLocale, profileId);
    return { status: "uploaded" };
  }
  return result;
}

export async function previewCottageProfilePhotoAction(
  _previous: CottagePhotoPreviewState,
  formData: FormData,
): Promise<CottagePhotoPreviewState> {
  const cottageProfile = await createRequestCottageProfile();
  return cottageProfile.previewPhoto(text(formData, "photoId"));
}

export async function deleteCottageProfilePhotoAction(
  _previous: CottageProfileActionState,
  formData: FormData,
): Promise<CottageProfileActionState> {
  const requestedLocale = locale(formData);
  const profileId = text(formData, "profileId");
  if (!requestedLocale) return { status: "invalid" };
  const cottageProfile = await createRequestCottageProfile();
  const result = await cottageProfile.deletePhoto(text(formData, "photoId"));
  if (result.status === "deleted") {
    revalidateOwnerPaths(requestedLocale, profileId);
    revalidateAdministratorPaths(requestedLocale, profileId);
  }
  return result;
}

export async function submitCottageProfileAction(
  _previous: CottageProfileActionState,
  formData: FormData,
): Promise<CottageProfileActionState> {
  const requestedLocale = locale(formData);
  const profileId = text(formData, "profileId");
  if (!requestedLocale) return { status: "invalid" };
  const cottageProfile = await createRequestCottageProfile();
  const result = await cottageProfile.submit(
    profileId,
    Number(text(formData, "expectedVersion")),
  );
  if (result.status === "submitted") {
    revalidateOwnerPaths(requestedLocale, profileId);
    revalidateAdministratorPaths(requestedLocale, profileId);
    return { status: "submitted" };
  }
  return result;
}
