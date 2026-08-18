"use server";

import { revalidatePath } from "next/cache";

import { isLocale } from "@/i18n/routing";
import { createRequestCottagePublication } from "./request-cottage-publication";

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class InvalidCottagePublicationActionError extends Error {
  constructor() {
    super("Cottage publication action input is invalid");
    this.name = "InvalidCottagePublicationActionError";
  }
}

function invalid(): never {
  throw new InvalidCottagePublicationActionError();
}

function validText(value: string, maximum: number) {
  return value.length >= 1 && value.length <= maximum;
}

function decision(formData: FormData): boolean | null {
  const value = text(formData, "approved");
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function input(formData: FormData) {
  const locale = text(formData, "locale");
  const targetLocale = text(formData, "targetLocale");
  const reviewCycleId = text(formData, "reviewCycleId");
  if (
    !isLocale(locale) ||
    !isLocale(targetLocale) ||
    !uuidPattern.test(reviewCycleId)
  )
    return null;
  return { locale, targetLocale, reviewCycleId };
}

function refresh(locale: string) {
  revalidatePath(`/${locale}/administrator/cottages`);
  revalidatePath(`/${locale}/owner/cottages`);
}

export async function correctCottageLocalizationAction(formData: FormData) {
  const values = input(formData);
  const description = text(formData, "description");
  const houseRules = text(formData, "houseRules");
  const reason = text(formData, "reason");
  if (
    !values ||
    !validText(description, 2000) ||
    !validText(houseRules, 1500) ||
    !validText(reason, 1000)
  )
    invalid();
  await (
    await createRequestCottagePublication()
  ).correct(
    values.reviewCycleId,
    values.targetLocale,
    description,
    houseRules,
    reason,
  );
  refresh(values.locale);
}

export async function decideCottageLocalizationAction(formData: FormData) {
  const values = input(formData);
  const approved = decision(formData);
  const reason = text(formData, "reason");
  if (!values || approved === null || !validText(reason, 1000)) invalid();
  await (
    await createRequestCottagePublication()
  ).decideLocale(values.reviewCycleId, values.targetLocale, approved, reason);
  refresh(values.locale);
}

export async function decideCottagePublicationAction(formData: FormData) {
  const locale = text(formData, "locale");
  const reviewCycleId = text(formData, "reviewCycleId");
  const approved = decision(formData);
  const reason = text(formData, "reason");
  if (
    !isLocale(locale) ||
    !uuidPattern.test(reviewCycleId) ||
    approved === null ||
    !validText(reason, 1000)
  )
    invalid();
  await (
    await createRequestCottagePublication()
  ).decidePublication(reviewCycleId, approved, reason);
  refresh(locale);
}
