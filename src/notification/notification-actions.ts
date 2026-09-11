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
  if (
    typeof locale !== "string" ||
    typeof reference !== "string" ||
    typeof receiptId !== "string" ||
    !isLocale(locale) ||
    !/^RC-REQ-[A-F0-9]{16}$/.test(reference) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      receiptId,
    )
  )
    return { status: "invalid" };
  try {
    await new SupabaseBookingNotificationStatusRepository(
      await createRequestSupabaseClient(),
    ).retry(receiptId);
  } catch {
    console.error("Confirmation notice retry failed", {
      code: "confirmation_notice_retry_failed",
    });
    return { status: "failed" };
  }
  revalidatePath(`/${locale}/booking-requests/${reference}`);
  revalidatePath(`/${locale}/owner/booking-requests/${reference}`);
  return { status: "queued" };
}
