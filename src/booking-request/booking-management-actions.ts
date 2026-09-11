"use server";
import { refresh } from "next/cache";
import { createRequestSupabaseClient } from "@/access/supabase-server";
import { SupabaseAccountContextStore } from "@/access/supabase-account-access";
import { hasCustomerCapability } from "@/access/account-access";
import { isLocale } from "@/i18n/routing";
import { bookingRequestTestRuntimeIsEnabled } from "./booking-request-test-runtime";
import {
  createBookingCancellation,
  type BookingCancellationCommand,
} from "./booking-cancellation";
import { SupabaseBookingCancellationRepository } from "./supabase-booking-cancellation";
import { getBookingFinancialView } from "./booking-financial-view";
import { refundInputAllocation } from "./booking-financial-presentation";
export type BookingManagementActionState = {
  readonly status:
    | "idle"
    | "cancelled"
    | "requested"
    | "invalid"
    | "access-required"
    | "unavailable";
};
export async function manageConfirmedBooking(
  _previous: BookingManagementActionState,
  form: FormData,
): Promise<BookingManagementActionState> {
  if (!bookingRequestTestRuntimeIsEnabled()) return { status: "unavailable" };
  const locale = form.get("locale"),
    reference = form.get("reference"),
    role = form.get("actorRole"),
    commandId = form.get("commandId"),
    action = form.get("action"),
    reason = form.get("reason"),
    category = form.get("category");
  if (
    typeof locale !== "string" ||
    !isLocale(locale) ||
    typeof reference !== "string" ||
    !/^RC-REQ-[A-F0-9]{16}$/.test(reference) ||
    typeof commandId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      commandId,
    ) ||
    !["customer", "cottage_owner", "platform_administrator"].includes(
      String(role),
    ) ||
    !["cancel", "refund"].includes(String(action))
  )
    return { status: "invalid" };
  const actorRole = role as BookingCancellationCommand["actorRole"];
  if (
    (actorRole !== "customer" || action === "refund") &&
    (typeof reason !== "string" ||
      reason.trim().length < 1 ||
      reason.trim().length > 2000)
  )
    return { status: "invalid" };
  if (
    action === "cancel" &&
    actorRole === "platform_administrator" &&
    !["safety", "fraud", "legal", "serious_operational"].includes(
      String(category),
    )
  )
    return { status: "invalid" };
  if (action === "refund" && actorRole !== "platform_administrator")
    return { status: "access-required" };
  let allocation;
  if (action === "refund") {
    const price = form.get("price"),
      fee = form.get("fee");
    if (typeof price !== "string" || typeof fee !== "string")
      return { status: "invalid" };
    try {
      allocation = refundInputAllocation(price, fee);
    } catch {
      return { status: "invalid" };
    }
  }
  try {
    const client = await createRequestSupabaseClient();
    const user = await client.auth.getUser();
    const context = await new SupabaseAccountContextStore(client).resolve();
    if (
      user.error ||
      !user.data.user ||
      !context ||
      context.userId !== user.data.user.id ||
      !(actorRole === "customer"
        ? hasCustomerCapability(context)
        : actorRole === "cottage_owner"
          ? context.role === "cottage_owner" &&
            context.approvalState === "approved"
          : context.role === "platform_administrator")
    )
      return { status: "access-required" };
    if (actorRole === "platform_administrator") {
      const assurance = await client.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assurance.error || assurance.data?.currentLevel !== "aal2")
        return { status: "access-required" };
    }
    const view = await getBookingFinancialView(client, reference, actorRole);
    if (!view) return { status: "access-required" };
    if (action === "cancel")
      await createBookingCancellation(
        new SupabaseBookingCancellationRepository(client),
      ).cancel({
        bookingRequestId: view.bookingRequestId,
        commandId,
        actorRole,
        reason: actorRole === "customer" ? null : (reason as string).trim(),
        category:
          actorRole === "platform_administrator"
            ? (category as BookingCancellationCommand["category"])
            : null,
      });
    else {
      const { data, error } = await client.rpc(
        "request_booking_refund_exception",
        {
          target_booking_request_id: view.bookingRequestId,
          target_command_id: commandId,
          target_reason: (reason as string).trim(),
          target_allocation: allocation,
        },
      );
      if (error || data?.status !== "requested")
        throw new Error("Refund exception unavailable");
    }
    refresh();
    return { status: action === "cancel" ? "cancelled" : "requested" };
  } catch {
    console.error("Booking management command failed", {
      code: "booking_management_unavailable",
    });
    return { status: "unavailable" };
  }
}
