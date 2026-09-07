import {
  isPaymentDisplayStatus,
  type BookingRequestDisplayStatus,
} from "@/booking-request/booking-request-display";
import {
  bookingRequestDisplayStatusMessages,
  bookingRequestPaymentDisplayMessages,
  bookingRequestPaymentRequiredMessages,
  bookingRequestPaymentRequiredExpiryMessages,
} from "@/i18n/booking-request-status-messages";
import type { BookingRequestPaymentRequiredExpiry } from "@/booking-request/booking-request-status";
import type { Locale } from "@/i18n/routing";

export function BookingRequestStatusContent({
  locale,
  status,
  role,
  paymentRequiredPhase,
  paymentRequiredExpiry,
}: {
  locale: Locale;
  status: BookingRequestDisplayStatus;
  role: "customer" | "owner";
  paymentRequiredPhase?: "open" | "elapsed";
  paymentRequiredExpiry?: BookingRequestPaymentRequiredExpiry | null;
}) {
  const label = bookingRequestDisplayStatusMessages[locale][status];
  const expiryCopy = bookingRequestPaymentRequiredExpiryMessages[locale];
  if (
    paymentRequiredExpiry?.status === "refunding" ||
    paymentRequiredExpiry?.status === "quarantined" ||
    paymentRequiredExpiry?.status === "quarantined-released" ||
    paymentRequiredExpiry?.status === "refunded-expired"
  ) {
    const copy =
      paymentRequiredExpiry.status === "refunding"
        ? [expiryCopy.refundingLabel, expiryCopy.refundingDescription]
        : paymentRequiredExpiry.status === "quarantined-released"
          ? [
              expiryCopy.quarantinedLabel,
              expiryCopy.quarantinedReleasedDescription,
            ]
          : paymentRequiredExpiry.status === "quarantined"
            ? [expiryCopy.quarantinedLabel, expiryCopy.quarantinedDescription]
            : [expiryCopy.refundedLabel, expiryCopy.refundedDescription];
    return (
      <>
        <strong>{copy[0]}</strong>
        <span> {copy[1]}</span>
      </>
    );
  }
  if (status === "expired" && paymentRequiredExpiry?.status === "expired")
    return (
      <>
        <strong>{expiryCopy.expiredLabel}</strong>
        <span> {expiryCopy.expiredDescription}</span>
      </>
    );
  if (!isPaymentDisplayStatus(status)) return label;
  if (status === "payment-required") {
    if (!paymentRequiredPhase)
      throw new Error("Payment Required phase is missing");
    return (
      <>
        <strong>{label}</strong>
        <span>
          {" "}
          {paymentRequiredExpiry?.status === "attention-required"
            ? expiryCopy.attention
            : bookingRequestPaymentRequiredMessages[locale][role][
                paymentRequiredPhase
              ]}
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
