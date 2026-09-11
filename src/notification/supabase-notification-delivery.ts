import { refundAllocationTotal } from "@/payment/payment-refund-allocation";
import {
  bookingEventNotice,
  type BookingNoticeEvent,
} from "./booking-event-notice";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FictionalNotificationEffectRepository } from "./fictional-notification-adapter";
import type {
  NotificationBinding,
  NotificationCandidate,
  NotificationDeliveryRepository,
  NotificationDeliveryResult,
  NotificationEffect,
  NotificationExecuteResult,
  NotificationLease,
  NotificationQueryResult,
} from "./notification-delivery";

type Row = Record<string, unknown>;
const row = (v: unknown): Row | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Row) : null;
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v,
  );
const text = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const payloadKeys = new Set([
  "kind",
  "title",
  "body",
  "bookingReference",
  "detailsPath",
  "linkLabel",
  "fictional",
]);

function validPayload(
  payload: Row | null,
  base: NotificationCandidate,
): payload is Row & NotificationBinding["payload"] {
  const expectedPath = `/${base.locale}/${
    base.recipientRole === "customer"
      ? "booking-requests"
      : "owner/booking-requests"
  }/${base.bookingRequestReference}`;
  if (base.event) {
    const expected = bookingEventNotice({ ...base, event: base.event });
    return (
      payload !== null &&
      Object.keys(payload).length === Object.keys(expected).length &&
      Object.entries(expected).every(([key, value]) =>
        key === "allocation"
          ? row(payload[key])?.bookingPriceFils ===
              base.event?.allocation.bookingPriceFils &&
            row(payload[key])?.bookingServiceFeeFils ===
              base.event?.allocation.bookingServiceFeeFils &&
            Object.keys(row(payload[key]) ?? {}).length === 2
          : payload[key] === value,
      )
    );
  }
  return (
    payload !== null &&
    Object.keys(payload).length === payloadKeys.size &&
    Object.keys(payload).every((key) => payloadKeys.has(key)) &&
    payload.kind === "paid-confirmation" &&
    text(payload.title) &&
    text(payload.body) &&
    payload.bookingReference === base.bookingReference &&
    payload.detailsPath === expectedPath &&
    text(payload.linkLabel) &&
    payload.fictional === true
  );
}

function parseCandidate(value: unknown): NotificationCandidate {
  const v = row(value);
  if (
    !v ||
    !uuid(v.receiptId) ||
    !uuid(v.recipientUserId) ||
    !["customer", "cottage_owner"].includes(String(v.recipientRole)) ||
    !text(v.bookingRequestReference) ||
    !text(v.bookingReference) ||
    !["ar", "ckb", "en"].includes(String(v.locale))
  )
    throw new Error("Database returned an invalid notification candidate");
  let event: BookingNoticeEvent | undefined;
  if (v.event !== undefined) {
    const source = row(v.event);
    const allocation = row(source?.allocation);
    if (
      !source ||
      !uuid(source.id) ||
      ![
        "cancelled",
        "refund_requested",
        "refund_returned",
        "refund_attention",
      ].includes(String(source.kind)) ||
      !allocation ||
      typeof allocation.bookingPriceFils !== "number" ||
      typeof allocation.bookingServiceFeeFils !== "number"
    )
      throw new Error("Database returned an invalid notification event");
    event = {
      id: source.id,
      kind: source.kind as BookingNoticeEvent["kind"],
      allocation: {
        bookingPriceFils: allocation.bookingPriceFils,
        bookingServiceFeeFils: allocation.bookingServiceFeeFils,
      },
    };
    refundAllocationTotal(event.allocation);
  }
  return {
    ...(event ? { event } : {}),
    receiptId: v.receiptId,
    recipientUserId: v.recipientUserId,
    recipientRole: v.recipientRole as NotificationCandidate["recipientRole"],
    bookingRequestReference: v.bookingRequestReference,
    bookingReference: v.bookingReference,
    locale: v.locale as NotificationCandidate["locale"],
  };
}
function parseLease(value: unknown): NotificationLease {
  const v = row(value),
    base = parseCandidate(value),
    payload = row(v?.payload);
  const templateVersion = base.event
    ? "booking-event-v1"
    : "paid-confirmation-v1";
  if (
    !v ||
    v.logicalId !==
      (base.event
        ? `booking-event:${base.event.id}`
        : `paid-confirmation:${base.receiptId}`) ||
    v.templateVersion !== templateVersion ||
    !validPayload(payload, base) ||
    typeof v.payloadSha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(v.payloadSha256) ||
    !Number.isSafeInteger(v.leaseGeneration) ||
    (v.leaseGeneration as number) < 1 ||
    !uuid(v.leaseToken) ||
    !text(v.leaseExpiresAt) ||
    Number.isNaN(Date.parse(v.leaseExpiresAt))
  )
    throw new Error("Database returned an invalid notification lease");
  return {
    ...base,
    logicalId: v.logicalId,
    templateVersion,
    payload,
    payloadSha256: v.payloadSha256,
    leaseGeneration: v.leaseGeneration as number,
    leaseToken: v.leaseToken,
    leaseExpiresAt: v.leaseExpiresAt,
  };
}
const binding = (v: NotificationLease) => ({
  ...(v.event ? { event: v.event } : {}),
  receiptId: v.receiptId,
  recipientUserId: v.recipientUserId,
  recipientRole: v.recipientRole,
  bookingRequestReference: v.bookingRequestReference,
  bookingReference: v.bookingReference,
  locale: v.locale,
  logicalId: v.logicalId,
  templateVersion: v.templateVersion,
  payload: v.payload,
  payloadSha256: v.payloadSha256,
});
function parseEffect<S extends "found" | "delivered">(
  v: Row,
  status: S,
): { status: S } & NotificationEffect {
  if (
    !uuid(v.effectId) ||
    !text(v.supplierDeliveryReference) ||
    !text(v.executedAt) ||
    Number.isNaN(Date.parse(v.executedAt))
  )
    throw new Error("Database returned invalid notification effect evidence");
  return {
    status,
    effectId: v.effectId,
    supplierDeliveryReference: v.supplierDeliveryReference,
    executedAt: v.executedAt,
  };
}
function parseResult(value: unknown): NotificationDeliveryResult {
  const v = row(value);
  if (
    !v ||
    ![
      "delivered",
      "retryable",
      "uncertain",
      "stale",
      "suppressed",
      "unavailable",
    ].includes(String(v.status))
  )
    throw new Error("Database returned an invalid notification outcome");
  if (v.status === "delivered") {
    if (typeof v.historical !== "boolean")
      throw new Error("Database returned an invalid notification outcome");
    return { status: "delivered", historical: v.historical };
  }
  return {
    status: v.status as
      | "retryable"
      | "uncertain"
      | "stale"
      | "suppressed"
      | "unavailable",
  };
}

export class SupabaseNotificationDeliveryRepository
  implements
    NotificationDeliveryRepository,
    FictionalNotificationEffectRepository
{
  constructor(private readonly client: SupabaseClient) {}
  async listCandidates(limit: number) {
    const { data, error } = await this.client.rpc(
      "list_due_booking_confirmation_notifications",
      { target_limit: limit },
    );
    if (error || !Array.isArray(data) || data.length > limit)
      throw new Error("Notification selection is unavailable");
    return data.map(parseCandidate);
  }
  async prepare(v: NotificationBinding) {
    const { error } = await this.client.rpc(
      "ensure_booking_confirmation_notification_work",
      {
        target_receipt_id: v.receiptId,
        ...(v.event ? { target_event_id: v.event.id } : {}),
        target_locale: v.locale,
        target_template: v.templateVersion,
        target_payload: v.payload,
      },
    );
    if (error)
      throw new Error("Notification binding preparation is unavailable");
  }
  async lease(receiptId: string, eventId?: string) {
    const { data, error } = await this.client.rpc(
      "lease_booking_confirmation_notification_work",
      {
        target_receipt_id: receiptId,
        ...(eventId ? { target_event_id: eventId } : {}),
      },
    );
    if (error) throw new Error("Notification lease is unavailable");
    if (data === null) return null;
    const lease = parseLease(data);
    if (lease.receiptId !== receiptId || lease.event?.id !== eventId)
      throw new Error(
        "Database returned an invalid notification lease binding",
      );
    return lease;
  }
  async queryEffect(v: NotificationLease): Promise<NotificationQueryResult> {
    const { data, error } = await this.client.rpc(
      "query_fictional_booking_confirmation_notification_effect",
      {
        target_receipt_id: v.receiptId,
        ...(v.event ? { target_event_id: v.event.id } : {}),
        target_generation: v.leaseGeneration,
        target_token: v.leaseToken,
        target_binding: binding(v),
      },
    );
    if (error) throw new Error("Notification effect query is unavailable");
    const r = row(data);
    if (r?.status === "found") return parseEffect(r, "found");
    if (r?.status === "not-found" || r?.status === "stale")
      return { status: r.status };
    throw new Error("Database returned an invalid notification query");
  }
  async executeEffect(
    v: NotificationLease,
  ): Promise<NotificationExecuteResult> {
    const { data, error } = await this.client.rpc(
      "execute_fictional_booking_confirmation_notification_effect",
      {
        target_receipt_id: v.receiptId,
        ...(v.event ? { target_event_id: v.event.id } : {}),
        target_generation: v.leaseGeneration,
        target_token: v.leaseToken,
        target_binding: binding(v),
      },
    );
    if (error) throw new Error("Notification effect execution is unavailable");
    const r = row(data);
    if (r?.status === "delivered") return parseEffect(r, "delivered");
    if (
      r &&
      ["failed", "unknown", "stale", "suppressed"].includes(String(r.status))
    )
      return {
        status: r.status as "failed" | "unknown" | "stale" | "suppressed",
      };
    throw new Error("Database returned an invalid notification execution");
  }
  async completeDelivered(
    v: NotificationLease,
    e: { status: "found" | "delivered" } & NotificationEffect,
  ) {
    const { data, error } = await this.client.rpc(
      "complete_booking_confirmation_notification_delivery",
      {
        target_receipt_id: v.receiptId,
        ...(v.event ? { target_event_id: v.event.id } : {}),
        target_generation: v.leaseGeneration,
        target_token: v.leaseToken,
        target_binding: binding(v),
        target_effect_id: e.effectId,
      },
    );
    if (error) throw new Error("Notification completion is unavailable");
    return parseResult(data);
  }
  recordFailure(v: NotificationLease) {
    return this.record(v, "failed");
  }
  recordUnknown(v: NotificationLease) {
    return this.record(v, "unknown");
  }
  private async record(v: NotificationLease, outcome: "failed" | "unknown") {
    const { data, error } = await this.client.rpc(
      "record_booking_confirmation_notification_failure",
      {
        target_receipt_id: v.receiptId,
        ...(v.event ? { target_event_id: v.event.id } : {}),
        target_generation: v.leaseGeneration,
        target_token: v.leaseToken,
        target_outcome: outcome,
      },
    );
    if (error) throw new Error("Notification outcome recording is unavailable");
    return parseResult(data);
  }
}
