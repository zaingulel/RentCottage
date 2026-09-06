import {
  isPaymentDisplayStatus,
  type BookingRequestDisplayStatus,
} from "@/booking-request/booking-request-display";
import {
  bookingRequestDisplayStatusMessages,
  bookingRequestPaymentDisplayMessages,
  bookingRequestPaymentRequiredMessages,
} from "@/i18n/booking-request-status-messages";
import type { Locale } from "@/i18n/routing";

export function BookingRequestStatusContent({
  locale,
  status,
  role,
  paymentRequiredPhase,
}: {
  locale: Locale;
  status: BookingRequestDisplayStatus;
  role: "customer" | "owner";
  paymentRequiredPhase?: "open" | "elapsed";
}) {
  const label = bookingRequestDisplayStatusMessages[locale][status];
  if (!isPaymentDisplayStatus(status)) return label;
  if (status === "payment-required") {
    if (!paymentRequiredPhase)
      throw new Error("Payment Required phase is missing");
    return (
      <>
        <strong>{label}</strong>
        <span>
          {" "}
          {
            bookingRequestPaymentRequiredMessages[locale][role][
              paymentRequiredPhase
            ]
          }
        </span>
      </>
    );
  }
  return (
    <>
      <strong>{label}</strong>
      <span> {bookingRequestPaymentDisplayMessages[locale][status]}</span>
    </>
  );
}
