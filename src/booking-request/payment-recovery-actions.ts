"use server";

import { refresh } from "next/cache";
import { isLocale } from "@/i18n/routing";
import type { PaymentRecoveryStatus } from "./booking-request-payment-recovery";
import { createRequestBookingRequestPaymentRecovery } from "./request-booking-request-payment-recovery";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function recoverBookingRequestPayment(
  value: unknown,
): Promise<{ readonly status: PaymentRecoveryStatus | "invalid" }> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { status: "invalid" };
  const input = value as Record<string, unknown>;
  if (
    typeof input.bookingRequestId !== "string" ||
    !uuid.test(input.bookingRequestId) ||
    typeof input.commandKey !== "string" ||
    !uuid.test(input.commandKey) ||
    typeof input.locale !== "string" ||
    !isLocale(input.locale)
  )
    return { status: "invalid" };
  try {
    const recovery = await createRequestBookingRequestPaymentRecovery();
    if (!recovery) return { status: "unavailable" };
    const result = await recovery.execute({
      bookingRequestId: input.bookingRequestId,
      commandKey: input.commandKey,
    });
    refresh();
    return result;
  } catch {
    console.error("Booking Request payment recovery failed", {
      code: "booking_request_payment_recovery_failed",
    });
    return { status: "unavailable" };
  }
}
