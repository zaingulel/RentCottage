import type { SupabaseClient } from "@supabase/supabase-js";

import { parseAdministratorPaymentHistory } from "./administrator-payment-history";

export type AdministratorPaymentHistoryLoad =
  | {
      readonly status: "ready";
      readonly history: ReturnType<typeof parseAdministratorPaymentHistory>;
    }
  | { readonly status: "access_required" }
  | { readonly status: "not_found" };

export async function getAdministratorPaymentHistory(
  client: SupabaseClient,
  reference: string,
): Promise<AdministratorPaymentHistoryLoad> {
  const { data, error } = await client.rpc(
    "get_administrator_booking_request_payment_history",
    { target_reference: reference },
  );
  if (error) {
    if ((error as { code?: unknown }).code === "42501")
      return { status: "access_required" };
    throw new Error("Administrator payment history is unavailable", {
      cause: error,
    });
  }
  if (data === null) return { status: "not_found" };
  return { status: "ready", history: parseAdministratorPaymentHistory(data) };
}
