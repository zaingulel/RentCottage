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
import { SupabaseBookingRefundRepository } from "./supabase-booking-refund";
import { SupabaseBookingCancellationRepository } from "./supabase-booking-cancellation";
import { getBookingFinancialView } from "./booking-financial-view";
import {
  createBookingNoShow,
  type BookingIncidentCommand,
} from "./booking-completion-commands";
import {
  SupabaseBookingNoShowRepository,
  recordBookingIncident,
  BookingLifecycleConflict,
} from "./supabase-booking-lifecycle";
import { refundInputAllocation } from "./booking-financial-presentation";
export type BookingManagementActionState = {
  readonly status:
    | "idle"
    | "cancelled"
    | "requested"
    | "no_show"
    | "recorded"
    | "conflict"
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
    !["cancel", "refund", "no_show", "incident"].includes(String(action))
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
  if (
    action === "incident" &&
    !["safety", "property_damage", "conduct", "other"].includes(
      String(category),
    )
  )
    return { status: "invalid" };
  if (
    (action === "incident" && actorRole === "customer") ||
    ((action === "refund" || action === "no_show") &&
      actorRole !== "platform_administrator")
  )
    return { status: "access-required" };
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
    else if (action === "no_show")
      await createBookingNoShow(
        new SupabaseBookingNoShowRepository(client),
      ).record({
        bookingRequestId: view.bookingRequestId,
        commandId,
        reason: (reason as string).trim(),
      });
    else if (action === "incident")
      await recordBookingIncident(client, {
        bookingRequestId: view.bookingRequestId,
        commandId,
        actorRole: actorRole as BookingIncidentCommand["actorRole"],
        category: category as BookingIncidentCommand["category"],
        narrative: (reason as string).trim(),
      });
    else {
      const price = form.get("price"),
        fee = form.get("fee");
      if (typeof price !== "string" || typeof fee !== "string")
        return { status: "invalid" };
      let allocation;
      try {
        allocation = refundInputAllocation(price, fee);
      } catch {
        return { status: "invalid" };
      }
      await new SupabaseBookingRefundRepository(client).requestException({
        bookingRequestId: view.bookingRequestId,
        commandId,
        reason: (reason as string).trim(),
        allocation,
      });
    }
    refresh();
    return {
      status:
        action === "cancel"
          ? "cancelled"
          : action === "refund"
            ? "requested"
            : action === "incident"
              ? "recorded"
              : "no_show",
    };
  } catch (error) {
    if (error instanceof BookingLifecycleConflict)
      return { status: "conflict" };
    console.error("Booking management command failed", {
      code: "booking_management_unavailable",
    });
    return { status: "unavailable" };
  }
}
