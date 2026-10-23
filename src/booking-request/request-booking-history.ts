import "server-only";
import { createRequestSupabaseClient } from "@/access/supabase-server";
import { fictionalSupplierEnvironment } from "./fictional-supplier-environment";
import { listBookingHistory } from "./booking-history";

export async function loadBookingHistory(
  actorRole: "customer" | "cottage_owner",
) {
  if (!fictionalSupplierEnvironment()) return undefined;
  return listBookingHistory(await createRequestSupabaseClient(), actorRole);
}
