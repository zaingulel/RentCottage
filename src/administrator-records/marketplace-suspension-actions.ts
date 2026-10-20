"use server";

import { revalidatePath } from "next/cache";

import { isLocale } from "@/i18n/routing";
import {
  parseMarketplaceSuspensionTarget,
  parseMarketplaceSuspensionCommand,
  type MarketplaceSuspensionCommandResult,
  parseMarketplaceSuspensionCursor,
  type MarketplaceSuspensionReadResult,
} from "./marketplace-suspension";
import {
  loadMarketplaceSuspension,
  executeMarketplaceSuspension,
} from "./supabase-marketplace-suspension";

export async function readMarketplaceSuspension(
  value: unknown,
): Promise<MarketplaceSuspensionReadResult> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { status: "invalid" };
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).some(
      (key) => !["locale", "target", "cursor"].includes(key),
    ) ||
    typeof row.locale !== "string" ||
    !isLocale(row.locale)
  )
    return { status: "invalid" };
  let target: ReturnType<typeof parseMarketplaceSuspensionTarget>;
  let cursor: ReturnType<typeof parseMarketplaceSuspensionCursor>;
  try {
    target = parseMarketplaceSuspensionTarget(row.target);
    cursor = parseMarketplaceSuspensionCursor(
      row.cursor === undefined ? null : row.cursor,
    );
  } catch {
    return { status: "invalid" };
  }
  return loadMarketplaceSuspension(target, cursor);
}

export async function setMarketplaceSuspension(
  value: unknown,
): Promise<MarketplaceSuspensionCommandResult> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { status: "invalid" };
  const { locale, ...input } = value as Record<string, unknown>;
  if (typeof locale !== "string" || !isLocale(locale))
    return { status: "invalid" };
  let command: ReturnType<typeof parseMarketplaceSuspensionCommand>;
  try {
    command = parseMarketplaceSuspensionCommand(input);
  } catch {
    return { status: "invalid" };
  }
  const result = await executeMarketplaceSuspension(command);
  if (result.status === "completed") {
    revalidatePath(`/${locale}/administrator/records`);
    revalidatePath(
      command.target.kind === "cottage"
        ? `/${locale}/administrator/cottages/${command.target.id}`
        : `/${locale}/administrator/records/account/${command.target.id}`,
    );
    if (result.target.applicationId !== null) {
      revalidatePath(
        `/${locale}/administrator/owner-applications/${result.target.applicationId}`,
      );
      revalidatePath(`/${locale}/administrator/owner-applications`);
      revalidatePath(`/${locale}/owner/application`);
    }
  }
  return result;
}
