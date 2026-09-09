import "server-only";
import { createRequestSupabaseClient } from "@/access/supabase-server";
import { bookingRequestTestRuntimeIsEnabled } from "./booking-request-test-runtime";
import { getConfirmedBookingAccess } from "./confirmed-booking-access";
import { SupabasePaidConfirmationNotificationStatusRepository } from "@/notification/notification-status-repository";
import type { PaidConfirmationNotificationStatus } from "@/notification/notification-status-repository";

export type PaidConfirmationNotificationPresentationStatus =
  | PaidConfirmationNotificationStatus
  | {
      readonly receiptId: string;
      readonly state: "unavailable";
      readonly lastOutcome: null;
      readonly supplierDeliveryReference: null;
      readonly deliveredAt: null;
      readonly suppressedAt: null;
      readonly historical: false;
    };

export async function loadConfirmedBookingAccess(reference: string) {
  if (!bookingRequestTestRuntimeIsEnabled()) return undefined;
  const client = await createRequestSupabaseClient();
  const access = await getConfirmedBookingAccess(client, reference);
  if (!access) return null;
  let notification: PaidConfirmationNotificationPresentationStatus;
  try {
    notification =
      await new SupabasePaidConfirmationNotificationStatusRepository(
        client,
      ).get(access.receiptId);
  } catch {
    notification = {
      receiptId: access.receiptId,
      state: "unavailable",
      lastOutcome: null,
      supplierDeliveryReference: null,
      deliveredAt: null,
      suppressedAt: null,
      historical: false,
    };
  }
  return { access, notification };
}
