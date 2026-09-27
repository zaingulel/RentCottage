"use server";

import { isLocale } from "@/i18n/routing";
import {
  parseAdministratorRecordSearch,
  UnsupportedAdministratorQueryError,
  type AdministratorSearchPage,
} from "./administrator-records";
import { searchAdministratorRecords } from "./supabase-administrator-records";

export type AdministratorRecordsActionState =
  | { status: "idle" | "access_required" | "unavailable" }
  | { status: "invalid"; reason?: "query" }
  | { status: "ready"; page: AdministratorSearchPage };

const fields = [
  "locale",
  "kind",
  "query",
  "status",
  "from",
  "through",
  "ownerId",
  "afterAt",
  "afterId",
] as const;

export async function searchAdministratorRecordsAction(
  _previous: AdministratorRecordsActionState,
  formData: FormData,
): Promise<AdministratorRecordsActionState> {
  for (const [key] of formData) {
    if (
      !fields.includes(key as (typeof fields)[number]) &&
      !key.startsWith("$ACTION_")
    )
      return { status: "invalid" };
  }
  const raw: Record<string, string> = {};
  for (const field of fields) {
    const values = formData.getAll(field);
    if (
      values.length > 1 ||
      (values.length === 1 && typeof values[0] !== "string")
    )
      return { status: "invalid" };
    if (values.length === 1) raw[field] = values[0] as string;
  }
  if (!isLocale(raw.locale) || !raw.kind) return { status: "invalid" };
  let search: ReturnType<typeof parseAdministratorRecordSearch>;
  try {
    search = parseAdministratorRecordSearch(raw);
  } catch (error) {
    return error instanceof UnsupportedAdministratorQueryError
      ? { status: "invalid", reason: "query" }
      : { status: "invalid" };
  }
  return searchAdministratorRecords(search);
}
