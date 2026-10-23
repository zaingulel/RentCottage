import { createClient } from "@supabase/supabase-js";

import { fictionalSupplierEnvironment } from "@/booking-request/fictional-supplier-environment-core";
import { FictionalNotificationAdapter } from "./fictional-notification-adapter";
import { createBookingNotificationDelivery } from "./notification-delivery";
import { SupabaseNotificationDeliveryRepository } from "./supabase-notification-delivery";

type NotificationScheduleEnvironment = NonNullable<
  Parameters<typeof fictionalSupplierEnvironment>[0]
>;

type ProcessDue = ReturnType<
  typeof createBookingNotificationDelivery
>["processDue"];

export async function runScheduledBookingNotifications(
  environment: NotificationScheduleEnvironment,
  injectedProcessDue?: ProcessDue,
) {
  const supplierEnvironment = fictionalSupplierEnvironment(environment);
  if (
    !supplierEnvironment ||
    !environment.SUPABASE_PUBLISHABLE_KEY ||
    !environment.SUPABASE_SECRET_KEY
  ) {
    throw new Error(
      "Booking notifications require an approved fictional runtime and credentials",
    );
  }

  let processDue = injectedProcessDue;
  if (!processDue) {
    const client = createClient(
      environment.SUPABASE_URL as string,
      environment.SUPABASE_SECRET_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const repository = new SupabaseNotificationDeliveryRepository(
      client,
      supplierEnvironment,
    );
    processDue = createBookingNotificationDelivery({
      repository,
      adapter: new FictionalNotificationAdapter(repository, environment),
    }).processDue;
  }
  return processDue(50);
}
