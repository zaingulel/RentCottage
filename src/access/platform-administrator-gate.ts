import "server-only";

import { SupabaseAccountContextStore } from "./supabase-account-access";
import { createRequestSupabaseClient } from "./supabase-server";

export type PlatformAdministratorAccess = "allowed" | "refused";

// Rejects when the check cannot be completed, so a failed check is never an answer.
export async function resolvePlatformAdministratorAccess(): Promise<PlatformAdministratorAccess> {
  const client = await createRequestSupabaseClient();
  const [context, authorization] = await Promise.all([
    new SupabaseAccountContextStore(client).resolve(),
    client.rpc("is_platform_administrator", { required_assurance: "aal2" }),
  ]);
  if (context?.role !== "platform_administrator") return "refused";
  if (authorization.error)
    throw new Error("Platform Administrator check failed", {
      cause: authorization.error,
    });
  if (typeof authorization.data !== "boolean")
    throw new Error("Platform Administrator check returned no decision");
  return authorization.data ? "allowed" : "refused";
}
