import "server-only";

import { createRequestSupabaseClient } from "@/access/supabase-server";

import { listOwnerBookingRequestNotifications } from "./owner-booking-request-notifications";

export async function loadOwnerBookingRequestNotifications() {
  return listOwnerBookingRequestNotifications(
    await createRequestSupabaseClient(),
  );
}
