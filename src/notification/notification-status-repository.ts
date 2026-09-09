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
    !(
      v.supplierDeliveryReference === null ||
      typeof v.supplierDeliveryReference === "string"
    ) ||
    !(v.deliveredAt === null || typeof v.deliveredAt === "string") ||
    !(v.suppressedAt === null || typeof v.suppressedAt === "string") ||
    typeof v.historical !== "boolean"
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
