import "server-only";
import { cache } from "react";
import { redirect, unstable_rethrow } from "next/navigation";
import type { Locale } from "@/i18n/routing";
import type { AccountContext } from "./account-access";
import { accountAccessHref } from "./return-destination";
import { createRequestSupabaseClient } from "./supabase-server";
import { SupabaseAccountContextStore } from "./supabase-account-access";

export type RequestAccount =
  | { status: "signed_out" }
  | { status: "unavailable" }
  | { status: "authenticated"; context: AccountContext | undefined };

export const resolveRequestAccount = cache(
  async (): Promise<RequestAccount> => {
    try {
      const client = await createRequestSupabaseClient();
      const { data, error } = await client.auth.getUser();
      if (
        error?.name === "AuthSessionMissingError" ||
        error?.code === "session_not_found" ||
        error?.code === "refresh_token_not_found" ||
        error?.code === "refresh_token_already_used" ||
        error?.code === "user_not_found"
      )
        return { status: "signed_out" };
      if (error) return { status: "unavailable" };
      if (!data.user) return { status: "signed_out" };
      const context = await new SupabaseAccountContextStore(client).resolve();
      if (context && context.userId !== data.user.id)
        return { status: "unavailable" };
      return { status: "authenticated", context };
    } catch (error) {
      unstable_rethrow(error);
      return { status: "unavailable" };
    }
  },
);

export async function requireRequestAccount(locale: Locale, returnTo: string) {
  const account = await resolveRequestAccount();
  if (account.status === "signed_out")
    redirect(accountAccessHref(locale, returnTo));
  return account;
}
