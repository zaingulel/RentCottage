import type { AccountContext } from "@/access/account-access";
import { SupabaseAccountContextStore } from "@/access/supabase-account-access";
import { createRequestSupabaseClient } from "@/access/supabase-server";

import { createRequestCottageProfile } from "./request-cottage-profile";

type CottageOwnerApprovalState = Extract<
  AccountContext,
  { role: "cottage_owner" }
>["approvalState"];

export async function loadOwnerCottageAccess<Result>(
  load: (
    cottageProfile: Awaited<ReturnType<typeof createRequestCottageProfile>>,
    approvalState: CottageOwnerApprovalState,
  ) => Promise<Result>,
) {
  const client = await createRequestSupabaseClient();
  const context = await new SupabaseAccountContextStore(client).resolve();
  if (context?.role !== "cottage_owner") {
    return { status: "access_required" as const };
  }
  if (context.approvalState === "prospective") {
    return { status: "prospective" as const };
  }
  return {
    status: "ready" as const,
    value: await load(
      await createRequestCottageProfile(),
      context.approvalState,
    ),
  };
}
