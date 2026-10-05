"use server";
import { refresh } from "next/cache";
import { isLocale } from "@/i18n/routing";
import { refundInputAllocation } from "./booking-financial-presentation";
import type { BookingParticipantRole } from "./booking-financial-view";
import {
  isBookingRequestReference,
  isIdentifier,
} from "./booking-request-identifiers";
import { bookingRequestTestRuntimeIsEnabled } from "./booking-request-test-runtime";
import type {
  ConfirmedBookingCommand,
  ConfirmedBookingManagementResult,
} from "./confirmed-booking-management";
import { createRequestConfirmedBookingManagement } from "./request-confirmed-booking-management";
export type BookingManagementActionState = {
  readonly status:
    | "idle"
    | "invalid"
    | ConfirmedBookingManagementResult["status"];
};
const actorRoles = [
  "customer",
  "cottage_owner",
  "platform_administrator",
] as const;
const commandKinds = [
  "cancel",
  "refund",
  "no_show",
  "incident",
  "place_hold",
  "release_hold",
  "open_dispute",
  "resolve_dispute",
  "settle",
] as const;
const cancellationCategories = [
  "safety",
  "fraud",
  "legal",
  "serious_operational",
] as const;
const incidentCategories = [
  "safety",
  "property_damage",
  "conduct",
  "other",
] as const;
const disputeOutcomes = [
  "owner_won",
  "customer_won",
  "partial_customer_award",
] as const;
function member<const T extends string>(
  values: readonly T[],
  value: FormDataEntryValue | null,
): T | undefined {
  return values.find((candidate) => candidate === value);
}
function reasonFrom(form: FormData) {
  const reason = form.get("reason");
  if (typeof reason !== "string") return undefined;
  const trimmed = reason.trim();
  return trimmed.length >= 1 && trimmed.length <= 2000 ? trimmed : undefined;
}
function identifierFrom(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" && isIdentifier(value) ? value : undefined;
}
function allocationFrom(form: FormData) {
  const price = form.get("price"),
    fee = form.get("fee");
  if (typeof price !== "string" || typeof fee !== "string") return undefined;
  try {
    return refundInputAllocation(price, fee);
  } catch {
    return undefined;
  }
}
function commandFrom(
  form: FormData,
  actorRole: BookingParticipantRole,
  kind: (typeof commandKinds)[number],
  target: { readonly reference: string; readonly commandId: string },
): ConfirmedBookingCommand | undefined {
  if (kind === "cancel" && actorRole === "customer")
    return { ...target, kind, reason: null, category: null };
  const reason = reasonFrom(form);
  if (!reason) return undefined;
  switch (kind) {
    case "cancel": {
      if (actorRole === "cottage_owner")
        return { ...target, kind, reason, category: null };
      const category = member(cancellationCategories, form.get("category"));
      return category && { ...target, kind, reason, category };
    }
    case "refund": {
      const allocation = allocationFrom(form);
      return allocation && { ...target, kind, reason, allocation };
    }
    case "incident": {
      const category = member(incidentCategories, form.get("category"));
      return category && { ...target, kind, category, narrative: reason };
    }
    case "no_show":
    case "place_hold":
    case "open_dispute":
    case "settle":
      return { ...target, kind, reason };
    case "release_hold": {
      const subjectId = identifierFrom(form, "subjectId");
      return subjectId ? { ...target, kind, reason, subjectId } : undefined;
    }
    case "resolve_dispute": {
      const subjectId = identifierFrom(form, "subjectId");
      const outcome = member(disputeOutcomes, form.get("outcome"));
      if (!subjectId || !outcome) return undefined;
      if (outcome !== "partial_customer_award")
        return { ...target, kind, reason, subjectId, outcome };
      const allocation = allocationFrom(form);
      return (
        allocation && {
          ...target,
          kind,
          reason,
          subjectId,
          outcome,
          allocation,
        }
      );
    }
  }
}
function submissionFrom(form: FormData):
  | {
      readonly actorRole: BookingParticipantRole;
      readonly command: ConfirmedBookingCommand;
    }
  | undefined {
  const locale = form.get("locale"),
    reference = form.get("reference"),
    commandId = identifierFrom(form, "commandId"),
    actorRole = member(actorRoles, form.get("actorRole")),
    kind = member(commandKinds, form.get("action"));
  if (
    typeof locale !== "string" ||
    !isLocale(locale) ||
    typeof reference !== "string" ||
    !isBookingRequestReference(reference) ||
    !commandId ||
    !actorRole ||
    !kind
  )
    return undefined;
  const command = commandFrom(form, actorRole, kind, { reference, commandId });
  return command && { actorRole, command };
}
export async function manageConfirmedBooking(
  _previous: BookingManagementActionState,
  form: FormData,
): Promise<BookingManagementActionState> {
  if (!bookingRequestTestRuntimeIsEnabled()) return { status: "unavailable" };
  const submission = submissionFrom(form);
  if (!submission) return { status: "invalid" };
  const result = await createRequestConfirmedBookingManagement().run(
    submission.actorRole,
    submission.command,
  );
  if (!["access-required", "conflict", "unavailable"].includes(result.status))
    refresh();
  return result;
}
