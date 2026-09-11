"use server";
import { revalidatePath } from "next/cache";
import { createRequestSupabaseClient } from "@/access/supabase-server";
import { isLocale } from "@/i18n/routing";
import { SupabaseBookingNotificationStatusRepository } from "./notification-status-repository";
import { bookingRequestTestRuntimeIsEnabled } from "@/booking-request/booking-request-test-runtime";

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
    typeof receiptId !== "string" ||
    (eventId !== null &&
      (typeof eventId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          eventId,
        ))) ||
    !isLocale(locale) ||
    !/^RC-REQ-[A-F0-9]{16}$/.test(reference) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      receiptId,
    )
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
