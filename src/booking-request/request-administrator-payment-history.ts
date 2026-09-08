import "server-only";

import { createRequestSupabaseClient } from "@/access/supabase-server";
import { getAdministratorPaymentHistory } from "./supabase-administrator-payment-history";

export async function loadAdministratorPaymentHistory(reference: string) {
  return getAdministratorPaymentHistory(
    await createRequestSupabaseClient(),
    reference,
  );
}
