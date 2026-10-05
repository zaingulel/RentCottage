"use server";
import { revalidatePath } from "next/cache";
import { createRequestSupabaseClient } from "@/access/supabase-server";
import { isLocale } from "@/i18n/routing";
import { SupabaseBookingNotificationStatusRepository } from "./notification-status-repository";
import { bookingRequestTestRuntimeIsEnabled } from "@/booking-request/booking-request-test-runtime";
import {
  isBookingRequestReference,
  isIdentifier,
} from "@/booking-request/booking-request-identifiers";

export type RetryPaidConfirmationNotificationState = {
  readonly status: "idle" | "queued" | "invalid" | "unavailable" | "failed";
};

export async function retryPaidConfirmationNotification(
  _previous: RetryPaidConfirmationNotificationState,
  formData: FormData,
): Promise<RetryPaidConfirmationNotificationState> {
  if (!bookingRequestTestRuntimeIsEnabled()) return { status: "unavailable" };
  const locale = formData.get("locale");
  const reference = formData.get("reference");
  const receiptId = formData.get("receiptId");
  const eventId = formData.get("eventId");
  if (
    typeof locale !== "string" ||
    typeof reference !== "string" ||
    (receiptId !== null && typeof receiptId !== "string") ||
    (receiptId === null && eventId === null) ||
    (eventId !== null &&
      (typeof eventId !== "string" || !isIdentifier(eventId))) ||
    !isLocale(locale) ||
    !isBookingRequestReference(reference) ||
    (receiptId !== null && !isIdentifier(receiptId))
  )
    return { status: "invalid" };
  try {
    const repository = new SupabaseBookingNotificationStatusRepository(
      await createRequestSupabaseClient(),
    );
    if (eventId === null) await repository.retry(receiptId);
    else await repository.retry(receiptId, eventId as string);
  } catch {
    console.error("Booking notice retry failed", {
      code: "booking_notice_retry_failed",
    });
    return { status: "failed" };
  }
  revalidatePath(`/${locale}/booking-requests/${reference}`);
  revalidatePath(`/${locale}/owner/booking-requests/${reference}`);
  return { status: "queued" };
}
