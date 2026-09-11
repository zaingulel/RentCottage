import { createClient } from "@supabase/supabase-js";

import { bookingRequestTestRuntimeIsEnabled } from "@/booking-request/booking-request-test-runtime-core";
import { FictionalNotificationAdapter } from "./fictional-notification-adapter";
import { createBookingNotificationDelivery } from "./notification-delivery";
import { SupabaseNotificationDeliveryRepository } from "./supabase-notification-delivery";

interface NotificationScheduleEnvironment {
  readonly APP_ENVIRONMENT?: string;
  readonly SUPABASE_PROJECT_REF?: string;
  readonly SUPABASE_URL?: string;
  readonly SUPABASE_PUBLISHABLE_KEY?: string;
  readonly SUPABASE_SECRET_KEY?: string;
}

type ProcessDue = ReturnType<
  typeof createBookingNotificationDelivery
>["processDue"];

export async function runScheduledBookingNotifications(
  environment: NotificationScheduleEnvironment,
  injectedProcessDue?: ProcessDue,
) {
  if (
    !bookingRequestTestRuntimeIsEnabled(environment) ||
    !environment.SUPABASE_PUBLISHABLE_KEY ||
    !environment.SUPABASE_SECRET_KEY
  ) {
    throw new Error(
      "Booking notifications require the exact local test runtime and credentials",
    );
  }

  let processDue = injectedProcessDue;
  if (!processDue) {
    const client = createClient(
      environment.SUPABASE_URL as string,
      environment.SUPABASE_SECRET_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const repository = new SupabaseNotificationDeliveryRepository(client);
    processDue = createBookingNotificationDelivery({
      repository,
      adapter: new FictionalNotificationAdapter(repository, environment),
    }).processDue;
  }
  return processDue(50);
}
