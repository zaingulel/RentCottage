import "server-only";
import { createRequestSupabaseClient } from "@/access/supabase-server";
import { bookingRequestTestRuntimeIsEnabled } from "./booking-request-test-runtime";
import { listConfirmedBookingHistory } from "./confirmed-booking-history";
export async function loadConfirmedBookingHistory() {
  if (!bookingRequestTestRuntimeIsEnabled()) return undefined;
  return listConfirmedBookingHistory(await createRequestSupabaseClient());
}
