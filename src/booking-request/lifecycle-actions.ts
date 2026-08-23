"use server";

import { revalidatePath } from "next/cache";

import { SupabaseAccountContextStore } from "@/access/supabase-account-access";
import { createRequestSupabaseClient } from "@/access/supabase-server";
import { isLocale } from "@/i18n/routing";

import type {
  BookingRequestDeclineReason,
  BookingRequestLifecycleResult,
} from "./booking-request-lifecycle";
import { createRequestBookingRequestLifecycle } from "./request-booking-request-lifecycle";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function actOnBookingRequest(
  value: unknown,
): Promise<BookingRequestLifecycleResult> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { status: "invalid" };
  }
  const input = value as Record<string, unknown>;
  if (
    typeof input.bookingRequestId !== "string" ||
    !uuid.test(input.bookingRequestId) ||
    typeof input.locale !== "string" ||
    !isLocale(input.locale) ||
    !["accept", "decline", "withdraw"].includes(String(input.action))
  ) {
    return { status: "invalid" };
  }
  try {
    const lifecycle = createRequestBookingRequestLifecycle();
    if (!lifecycle) return { status: "unavailable" };
    const context = await new SupabaseAccountContextStore(
      await createRequestSupabaseClient(),
    ).resolve();
    if (!context) return { status: "access-required" };
    let result: BookingRequestLifecycleResult;
    if (input.action === "withdraw") {
      if (context.role !== "customer") return { status: "access-required" };
      result = await lifecycle.act({
        actor: "customer",
        actorUserId: context.userId,
        bookingRequestId: input.bookingRequestId,
        action: "withdraw",
      });
    } else {
      if (
        context.role !== "cottage_owner" ||
        context.approvalState !== "approved"
      ) {
        return { status: "access-required" };
      }
      result = await lifecycle.act(
        input.action === "accept"
          ? {
              actor: "owner",
              actorUserId: context.userId,
              bookingRequestId: input.bookingRequestId,
              action: "accept",
            }
          : {
              actor: "owner",
              actorUserId: context.userId,
              bookingRequestId: input.bookingRequestId,
              action: "decline",
              declineReason: input.declineReason as BookingRequestDeclineReason,
              declineNote:
                typeof input.declineNote === "string"
                  ? input.declineNote.trim() || null
                  : null,
            },
      );
    }
    revalidatePath(`/${input.locale}/owner/cottages`);
    if ("bookingRequestReference" in result) {
      revalidatePath(
        `/${input.locale}/booking-requests/${result.bookingRequestReference}`,
      );
    }
    return result;
  } catch {
    console.error("Booking Request lifecycle action failed", {
      code: "booking_request_lifecycle_action_failed",
    });
    return { status: "unavailable" };
  }
}
