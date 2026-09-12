import "server-only";
import { createRequestSupabaseClient } from "@/access/supabase-server";
import { bookingRequestTestRuntimeIsEnabled } from "./booking-request-test-runtime";
import {
  getBookingFinancialView,
  type BookingParticipantRole,
} from "./booking-financial-view";
export async function loadBookingFinancialView(
  reference: string,
  actorRole: BookingParticipantRole,
) {
  if (!bookingRequestTestRuntimeIsEnabled()) return null;
  const client = await createRequestSupabaseClient();
  return getBookingFinancialView(client, reference, actorRole);
}
