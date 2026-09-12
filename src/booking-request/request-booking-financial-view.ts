import "server-only";
import { SupabaseBookingPayoutRepository } from "./supabase-booking-payout";
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
  const view = await getBookingFinancialView(client, reference, actorRole);
  if (!view || actorRole !== "platform_administrator") return view;
  return {
    ...view,
    payout: await new SupabaseBookingPayoutRepository(client).facts(
      view.bookingRequestId,
    ),
  };
}
