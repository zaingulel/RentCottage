import "server-only";
import { cache } from "react";
import { unstable_rethrow } from "next/navigation";
import type { AccountContext } from "./account-access";
import { parseAccountName } from "./account-name";
import { createRequestSupabaseClient } from "./supabase-server";

export type RequestAccountName =
  | { status: "named"; firstName: string; initial: string }
  | { status: "missing" }
  | { status: "not_asked" }
  | { status: "unavailable" };

export const resolveRequestAccountName = cache(
  async (context: AccountContext): Promise<RequestAccountName> => {
    try {
      const client = await createRequestSupabaseClient();
      if (context.role === "platform_administrator") {
        const { data, error } =
          await client.auth.mfa.getAuthenticatorAssuranceLevel();
        if (error) return { status: "unavailable" };
        if (data.currentLevel !== "aal2") return { status: "not_asked" };
      }
      const { data, error } = await client
        .from("account_names")
        .select("first_name")
        .eq("user_id", context.userId)
        .maybeSingle();
      if (error) return { status: "unavailable" };
      const name = parseAccountName(data?.first_name);
      return name ? { status: "named", ...name } : { status: "missing" };
    } catch (error) {
      unstable_rethrow(error);
      return { status: "unavailable" };
    }
  },
);
