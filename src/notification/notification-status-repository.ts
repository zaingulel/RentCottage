import type { SupabaseClient } from "@supabase/supabase-js";

export type PaidConfirmationNotificationStatus = {
  readonly receiptId: string;
  readonly state:
    | "pending"
    | "processing"
    | "retryable"
    | "uncertain"
    | "delivered"
    | "suppressed";
  readonly lastOutcome:
    | "failed"
    | "unknown"
    | "delivered"
    | "suppressed"
    | null;
  readonly supplierDeliveryReference: string | null;
  readonly deliveredAt: string | null;
  readonly suppressedAt: string | null;
  readonly historical: boolean;
};
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v,
  );
const timestamp = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
    v,
  ) &&
  !Number.isNaN(Date.parse(v));
const optionalText = (v: unknown): v is string | null =>
  v === null || (typeof v === "string" && v.length > 0);
const optionalTimestamp = (v: unknown): v is string | null =>
  v === null || timestamp(v);

function hasValidStateShape(v: Record<string, unknown>) {
  const sharedNonterminal =
    v.historical === false && v.deliveredAt === null && v.suppressedAt === null;
  switch (v.state) {
    case "pending":
      return (
        sharedNonterminal &&
        v.lastOutcome === null &&
        v.supplierDeliveryReference === null
      );
    case "processing":
      return sharedNonterminal;
    case "retryable":
      return (
        sharedNonterminal &&
        v.lastOutcome === "failed" &&
        v.supplierDeliveryReference === null
      );
    case "uncertain":
      return sharedNonterminal && v.lastOutcome === "unknown";
    case "delivered":
      return (
        v.lastOutcome === "delivered" &&
        typeof v.supplierDeliveryReference === "string" &&
        v.supplierDeliveryReference.length > 0 &&
        timestamp(v.deliveredAt) &&
        v.suppressedAt === null
      );
    case "suppressed":
      return (
        v.historical === false &&
        v.lastOutcome === "suppressed" &&
        v.supplierDeliveryReference === null &&
        v.deliveredAt === null &&
        timestamp(v.suppressedAt)
      );
    default:
      return false;
  }
}
function parse(value: unknown): PaidConfirmationNotificationStatus {
  const v = value as Record<string, unknown> | null;
  if (
    !v ||
    !uuid(v.receiptId) ||
    ![
      "pending",
      "processing",
      "retryable",
      "uncertain",
      "delivered",
      "suppressed",
    ].includes(String(v.state)) ||
    !(
      v.lastOutcome === null ||
      ["failed", "unknown", "delivered", "suppressed"].includes(
        String(v.lastOutcome),
      )
    ) ||
    !optionalText(v.supplierDeliveryReference) ||
    !optionalTimestamp(v.deliveredAt) ||
    !optionalTimestamp(v.suppressedAt) ||
    typeof v.historical !== "boolean" ||
    !hasValidStateShape(v)
  )
    throw new Error("Database returned invalid notification status");
  return v as PaidConfirmationNotificationStatus;
}

export class SupabasePaidConfirmationNotificationStatusRepository {
  constructor(private readonly client: SupabaseClient) {}
  async get(receiptId: string) {
    const { data, error } = await this.client.rpc(
      "get_booking_confirmation_notification_status",
      { target_receipt_id: receiptId },
    );
    if (error) throw new Error("Notification status is unavailable");
    return parse(data);
  }
  async retry(receiptId: string) {
    const { data, error } = await this.client.rpc(
      "retry_booking_confirmation_notification",
      { target_receipt_id: receiptId },
    );
    if (error || (data as { status?: unknown } | null)?.status !== "queued")
      throw new Error("Notification retry is unavailable");
    return { status: "queued" as const };
  }
}
