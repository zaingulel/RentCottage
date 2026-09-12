import "server-only";
import { createRequestSupabaseClient } from "@/access/supabase-server";
import { bookingRequestTestRuntimeIsEnabled } from "./booking-request-test-runtime";
import { listBookingHistory } from "./booking-history";

export async function loadBookingHistory(
  actorRole: "customer" | "cottage_owner",
) {
  if (!bookingRequestTestRuntimeIsEnabled()) return undefined;
  return listBookingHistory(await createRequestSupabaseClient(), actorRole);
}
