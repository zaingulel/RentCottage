import "server-only";

import { createRequestSupabaseClient } from "@/access/supabase-server";

import { listOwnerBookingRequestNotifications } from "./owner-booking-request-notifications";
import { bookingRequestTestRuntimeIsEnabled } from "./booking-request-test-runtime";

export async function loadOwnerBookingRequestNotifications() {
  if (!bookingRequestTestRuntimeIsEnabled()) return undefined;
  return listOwnerBookingRequestNotifications(
    await createRequestSupabaseClient(),
  );
}
