import type { MessagingBookingSummary } from "@/messaging/supabase-messaging-reader";
import { bookingLifecycleMessages } from "./booking-lifecycle-messages";
import { bookingRequestDisplayStatusMessages } from "./booking-request-status-messages";
import type { Locale } from "./routing";

export function messagingBookingStatusLabel(
  locale: Locale,
  booking: Pick<
    MessagingBookingSummary,
    "lifecycleStatus" | "paymentStatus" | "requestStatus"
  >,
): string {
  return booking.lifecycleStatus !== null
    ? bookingLifecycleMessages[locale][booking.lifecycleStatus]
    : bookingRequestDisplayStatusMessages[locale][
        booking.paymentStatus ?? booking.requestStatus
      ];
}
