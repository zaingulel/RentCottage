import {
  isPaymentDisplayStatus,
  type BookingRequestDisplayStatus,
} from "@/booking-request/booking-request-display";
import {
  bookingRequestDisplayStatusMessages,
  bookingRequestPaymentDisplayMessages,
} from "@/i18n/booking-request-status-messages";
import type { Locale } from "@/i18n/routing";

export function BookingRequestStatusContent({
  locale,
  status,
}: {
  locale: Locale;
  status: BookingRequestDisplayStatus;
}) {
  const label = bookingRequestDisplayStatusMessages[locale][status];
  if (!isPaymentDisplayStatus(status)) return label;
  return (
    <>
      <strong>{label}</strong>
      <span> {bookingRequestPaymentDisplayMessages[locale][status]}</span>
    </>
  );
}
