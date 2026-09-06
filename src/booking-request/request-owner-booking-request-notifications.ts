import "server-only";

import { createRequestSupabaseClient } from "@/access/supabase-server";

import { ownerBookingRequestNotificationDisplay } from "./booking-request-display";
import { listOwnerBookingRequestNotifications } from "./owner-booking-request-notifications";
import { bookingRequestTestRuntimeIsEnabled } from "./booking-request-test-runtime";

export async function loadOwnerBookingRequestNotifications() {
  if (!bookingRequestTestRuntimeIsEnabled()) return undefined;
  const notifications = await listOwnerBookingRequestNotifications(
    await createRequestSupabaseClient(),
  );
  return notifications.map(ownerBookingRequestNotificationDisplay);
}
