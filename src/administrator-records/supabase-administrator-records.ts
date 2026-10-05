import "server-only";

import {
  resolvePlatformAdministratorAccess,
  type PlatformAdministratorAccess,
} from "@/access/platform-administrator-gate";
import { createRequestSupabaseClient } from "@/access/supabase-server";
import {
  parseAdministratorDetailTarget,
  parseAdministratorRecordDetail,
  parseAdministratorRecordSearch,
  parseAdministratorSearchResult,
  type AdministratorRecordDetail,
  type AdministratorSearchPage,
} from "./administrator-records";

type SearchOutcome =
  | { status: "ready"; page: AdministratorSearchPage }
  | { status: "invalid" | "access_required" | "unavailable" };
type DetailOutcome =
  | { status: "ready"; record: AdministratorRecordDetail }
  | { status: "invalid" | "access_required" | "not_found" | "unavailable" };

function denied(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "42501"
  );
}

function unavailable(operation: string): { status: "unavailable" } {
  console.error("Administrator records request failed", {
    operation,
    outcome: "unavailable",
  });
  return { status: "unavailable" };
}

export async function searchAdministratorRecords(
  input: unknown,
): Promise<SearchOutcome> {
  let search: ReturnType<typeof parseAdministratorRecordSearch>;
  try {
    search = parseAdministratorRecordSearch(input);
  } catch {
    return { status: "invalid" };
  }

  let access: PlatformAdministratorAccess;
  try {
    access = await resolvePlatformAdministratorAccess();
  } catch {
    return unavailable("search_authorization");
  }
  if (access !== "allowed") return { status: "access_required" };

  try {
    const client = await createRequestSupabaseClient();
    const result = await client.rpc("search_administrator_records", {
      target_kind: search.kind,
      target_query: search.query,
      target_status: search.status,
      target_from: search.from,
      target_through: search.through,
      target_owner_id: search.ownerId,
      after_at: search.afterAt,
      after_id: search.afterId,
    });
    if (denied(result.error)) return { status: "access_required" };
    if (result.error) return unavailable("search_records");
    return {
      status: "ready",
      page: parseAdministratorSearchResult(result.data, search.kind),
    };
  } catch {
    return unavailable("search_records");
  }
}

export async function loadAdministratorRecord(
  kind: unknown,
  id: unknown,
): Promise<DetailOutcome> {
  let target: ReturnType<typeof parseAdministratorDetailTarget>;
  try {
    target = parseAdministratorDetailTarget(kind, id);
  } catch {
    return { status: "invalid" };
  }

  let access: PlatformAdministratorAccess;
  try {
    access = await resolvePlatformAdministratorAccess();
  } catch {
    return unavailable("detail_authorization");
  }
  if (access !== "allowed") return { status: "access_required" };

  try {
    const client = await createRequestSupabaseClient();
    const result = await client.rpc("get_administrator_record", {
      target_kind: target.kind,
      target_id: target.id,
    });
    if (denied(result.error)) return { status: "access_required" };
    if (result.error) return unavailable("load_detail");
    if (result.data === null) return { status: "not_found" };
    return {
      status: "ready",
      record: parseAdministratorRecordDetail(result.data, target.kind),
    };
  } catch {
    return unavailable("load_detail");
  }
}
