import type { BookingParticipantRole } from "./booking-financial-view";
export const bookingLifecycleStatuses = [
  "confirmed",
  "completed",
  "no_show",
  "cancelled",
  "incident_pending",
] as const;
export type BookingLifecycleStatus = (typeof bookingLifecycleStatuses)[number];
export interface BookingIncidentView {
  readonly id: string;
  readonly source: "lifecycle" | "cancellation";
  readonly cancellationId?: string;
  readonly category: string | null;
  readonly narrative: string;
  readonly actorUserId: string;
  readonly actorRole: "cottage_owner" | "platform_administrator";
  readonly recordedAt: string;
}
export interface BookingLifecycle {
  readonly bookingRequestId: string;
  readonly status: BookingLifecycleStatus;
  readonly incidents?: readonly BookingIncidentView[];
  readonly noShow?: null | {
    readonly actorUserId: string;
    readonly reason: string;
    readonly recordedAt: string;
  };
}
export type BookingCompletionEligibility =
  | {
      readonly status: "unavailable";
      readonly reviewAvailable: false;
      readonly payoutPrerequisiteAvailable: false;
    }
  | {
      readonly status: "completed" | "no_show" | "late_customer_cancellation";
      readonly effectivePeriodEnd: string;
      readonly assessedAt: string;
      readonly reviewExpiresAt: string | null;
      readonly reviewAvailable: boolean;
      readonly payoutPrerequisiteAt: string;
      readonly payoutPrerequisiteAvailable: boolean;
    };
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid booking lifecycle projection");
  return value as Record<string, unknown>;
};
const text = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim())
    throw new Error("Invalid booking lifecycle text");
  return value;
};
const uuid = (value: unknown): string => {
  const result = text(value);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      result,
    )
  )
    throw new Error("Invalid booking lifecycle identity");
  return result;
};
const timestamp = (value: unknown): string => {
  const result = text(value);
  if (
    !/(?:Z|[+-]\d{2}:\d{2})$/.test(result) ||
    !Number.isFinite(Date.parse(result))
  )
    throw new Error("Invalid booking lifecycle timestamp");
  return result;
};
export function parseBookingLifecycle(
  value: unknown,
  bookingRequestId: string,
  role: BookingParticipantRole,
): BookingLifecycle {
  const v = object(value);
  if (
    v.bookingRequestId !== bookingRequestId ||
    !bookingLifecycleStatuses.includes(v.status as BookingLifecycleStatus)
  )
    throw new Error("Invalid booking lifecycle binding");
  const result = {
    bookingRequestId: uuid(v.bookingRequestId),
    status: v.status as BookingLifecycleStatus,
  };
  if (role !== "platform_administrator") {
    if (v.incidents !== undefined || v.noShow !== undefined)
      throw new Error("Restricted booking lifecycle projection");
    return result;
  }
  if (!Array.isArray(v.incidents))
    throw new Error("Invalid restricted incident history");
  const incidents = v.incidents.map((value): BookingIncidentView => {
    const i = object(value);
    if (
      (i.source !== "lifecycle" && i.source !== "cancellation") ||
      (i.actorRole !== "cottage_owner" &&
        i.actorRole !== "platform_administrator")
    )
      throw new Error("Invalid booking incident attribution");
    return {
      id: uuid(i.id),
      source: i.source,
      ...(i.source === "cancellation"
        ? { cancellationId: uuid(i.cancellationId) }
        : {}),
      category: i.category === null ? null : text(i.category),
      narrative: text(i.narrative),
      actorUserId: uuid(i.actorUserId),
      actorRole: i.actorRole,
      recordedAt: timestamp(i.recordedAt),
    };
  });
  const noShow = v.noShow === null ? null : object(v.noShow);
  return {
    ...result,
    incidents,
    noShow: noShow
      ? {
          actorUserId: uuid(noShow.actorUserId),
          reason: text(noShow.reason),
          recordedAt: timestamp(noShow.recordedAt),
        }
      : null,
  };
}
export function parseBookingCompletionEligibility(
  value: unknown,
): BookingCompletionEligibility {
  const v = object(value);
  if (v.status === "unavailable") {
    if (v.reviewAvailable !== false || v.payoutPrerequisiteAvailable !== false)
      throw new Error("Invalid unavailable lifecycle eligibility");
    return {
      status: "unavailable",
      reviewAvailable: false,
      payoutPrerequisiteAvailable: false,
    };
  }
  if (
    !["completed", "no_show", "late_customer_cancellation"].includes(
      String(v.status),
    ) ||
    typeof v.reviewAvailable !== "boolean" ||
    typeof v.payoutPrerequisiteAvailable !== "boolean" ||
    (v.status !== "completed" &&
      (v.reviewExpiresAt !== null || v.reviewAvailable))
  )
    throw new Error("Invalid booking completion eligibility");
  return {
    status: v.status as "completed" | "no_show" | "late_customer_cancellation",
    effectivePeriodEnd: timestamp(v.effectivePeriodEnd),
    assessedAt: timestamp(v.assessedAt),
    reviewExpiresAt:
      v.status === "completed" ? timestamp(v.reviewExpiresAt) : null,
    reviewAvailable: v.reviewAvailable,
    payoutPrerequisiteAt: timestamp(v.payoutPrerequisiteAt),
    payoutPrerequisiteAvailable: v.payoutPrerequisiteAvailable,
  };
}
