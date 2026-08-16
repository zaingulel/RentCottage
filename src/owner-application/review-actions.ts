"use server";

import { revalidatePath } from "next/cache";

import { createRequestSupabaseClient } from "@/access/supabase-server";
import { isLocale } from "@/i18n/routing";
import {
  executeOwnerApplicationReviewCommand,
  type OwnerApplicationReviewCommand,
} from "./owner-application-review";
import { verificationDocumentKinds } from "./owner-application";

export type ReviewOwnerApplicationActionState = {
  status: "idle" | "completed" | "invalid" | "unavailable";
};

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function strings(formData: FormData, name: string): string[] {
  return formData
    .getAll(name)
    .filter((value): value is string => typeof value === "string");
}

function commandFrom(formData: FormData): unknown {
  const action = text(formData, "action");
  const base = {
    action,
    applicationId: text(formData, "applicationId"),
    expectedVersion: Number(text(formData, "expectedVersion")),
  };
  if (action === "request_information") {
    return {
      ...base,
      reason: text(formData, "reason"),
      requestedFields: strings(formData, "requestedFields"),
      requestedDocumentKinds: strings(formData, "requestedDocumentKinds"),
    };
  }
  if (action === "approve") {
    const relevantExpiryDates = Object.fromEntries(
      verificationDocumentKinds
        .map((kind) => [kind, text(formData, `expiryDate:${kind}`)] as const)
        .filter(([, expiry]) => expiry),
    );
    return {
      ...base,
      reason: text(formData, "reason"),
      jurisdiction: text(formData, "jurisdiction"),
      licensingBasis: text(formData, "licensingBasis"),
      licenceOrExemptionBasis: text(formData, "licenceOrExemptionBasis"),
      relevantExpiryDates,
    };
  }
  if (action === "reject" || action === "suspend") {
    return { ...base, reason: text(formData, "reason") };
  }
  return base;
}

export async function reviewOwnerApplicationAction(
  _previous: ReviewOwnerApplicationActionState,
  formData: FormData,
): Promise<ReviewOwnerApplicationActionState> {
  const locale = text(formData, "locale");
  if (!isLocale(locale)) return { status: "invalid" };
  let command: OwnerApplicationReviewCommand;
  try {
    command = commandFrom(formData) as OwnerApplicationReviewCommand;
    const client = await createRequestSupabaseClient();
    await executeOwnerApplicationReviewCommand(client, command);
  } catch (error) {
    return {
      status:
        error instanceof Error &&
        error.message === "Owner Application review command is invalid"
          ? "invalid"
          : "unavailable",
    };
  }
  revalidatePath(
    `/${locale}/administrator/owner-applications/${command.applicationId}`,
  );
  revalidatePath(`/${locale}/administrator/owner-applications`);
  revalidatePath(`/${locale}/owner/application`);
  return { status: "completed" };
}
