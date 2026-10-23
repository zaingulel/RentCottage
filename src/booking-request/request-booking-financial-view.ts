import "server-only";
import { createRequestSupabaseClient } from "@/access/supabase-server";
import { fictionalSupplierEnvironment } from "./booking-request-test-runtime";
import {
  getBookingFinancialView,
  type BookingParticipantRole,
} from "./booking-financial-view";
export async function loadBookingFinancialView(
  reference: string,
  actorRole: BookingParticipantRole,
) {
  if (!fictionalSupplierEnvironment()) return null;
  const client = await createRequestSupabaseClient();
  return getBookingFinancialView(client, reference, actorRole);
}
