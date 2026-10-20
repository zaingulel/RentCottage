import "server-only";

import { resolvePlatformAdministratorAccess } from "@/access/platform-administrator-gate";
import { createRequestSupabaseClient } from "@/access/supabase-server";
import {
  parseMarketplaceSuspensionTarget,
  parseMarketplaceSuspensionCommand,
  parseMarketplaceSuspensionCommandResult,
  type MarketplaceSuspensionCommandResult,
  parseMarketplaceSuspensionCursor,
  parseMarketplaceSuspensionReadResult,
  type MarketplaceSuspensionReadResult,
} from "./marketplace-suspension";

function unavailable(operation: string): { status: "unavailable" } {
  console.error("Marketplace suspension request failed", {
    operation,
    outcome: "unavailable",
  });
  return { status: "unavailable" };
}
function denied(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "42501"
  );
}
export async function loadMarketplaceSuspension(
  input: unknown,
  cursor: unknown = null,
): Promise<MarketplaceSuspensionReadResult> {
  let target: ReturnType<typeof parseMarketplaceSuspensionTarget>;
  let page: ReturnType<typeof parseMarketplaceSuspensionCursor>;
  try {
    target = parseMarketplaceSuspensionTarget(input);
    page = parseMarketplaceSuspensionCursor(cursor);
  } catch {
    return { status: "invalid" };
  }
  try {
    if ((await resolvePlatformAdministratorAccess()) !== "allowed")
      return { status: "access_required" };
    const client = await createRequestSupabaseClient();
    const result = await client.rpc("get_marketplace_suspension", {
      target_kind: target.kind,
      target_id: target.id,
      before_created_at: page?.createdAt ?? null,
      before_id: page?.id ?? null,
      page_size: 20,
    });
    if (denied(result.error)) return { status: "access_required" };
    if (result.error) return unavailable("read");
    return parseMarketplaceSuspensionReadResult(result.data, target);
  } catch {
    return unavailable("read");
  }
}

export async function executeMarketplaceSuspension(
  input: unknown,
): Promise<MarketplaceSuspensionCommandResult> {
  let command: ReturnType<typeof parseMarketplaceSuspensionCommand>;
  try {
    command = parseMarketplaceSuspensionCommand(input);
  } catch {
    return { status: "invalid" };
  }
  try {
    if ((await resolvePlatformAdministratorAccess()) !== "allowed")
      return { status: "access_required" };
    const client = await createRequestSupabaseClient();
    const result = await client.rpc("set_marketplace_suspension", {
      target_kind: command.target.kind,
      target_id: command.target.id,
      target_action: command.action,
      expected_revision: command.expectedRevision,
      target_reason: command.reason,
      target_command_id: command.commandId,
    });
    if (denied(result.error)) return { status: "access_required" };
    if (result.error) return unavailable("command");
    return parseMarketplaceSuspensionCommandResult(result.data, command);
  } catch {
    return unavailable("command");
  }
}
