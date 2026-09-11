import { describe, expect, it, vi } from "vitest";
import { SupabaseBookingNotificationStatusRepository } from "./notification-status-repository";
const receipt = "00000000-0000-4000-8000-000000000035";
describe("paid confirmation notification status repository", () => {
  it("parses truthful historical delivery status", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        receiptId: receipt,
        state: "delivered",
        lastOutcome: "delivered",
        supplierDeliveryReference: "fictional-35",
        deliveredAt: "2099-01-01T00:00:00Z",
        suppressedAt: null,
        historical: true,
      },
      error: null,
    });
    await expect(
      new SupabaseBookingNotificationStatusRepository({
        rpc,
      } as never).get(receipt),
    ).resolves.toMatchObject({ state: "delivered", historical: true });
  });
  it.each([
    {
      state: "pending",
      lastOutcome: null,
      supplierDeliveryReference: null,
      deliveredAt: null,
      suppressedAt: null,
      historical: false,
    },
    {
      state: "processing",
      lastOutcome: "unknown",
      supplierDeliveryReference: null,
      deliveredAt: null,
      suppressedAt: null,
      historical: false,
    },
    {
      state: "retryable",
      lastOutcome: "failed",
      supplierDeliveryReference: null,
      deliveredAt: null,
      suppressedAt: null,
      historical: false,
    },
    {
      state: "uncertain",
      lastOutcome: "unknown",
      supplierDeliveryReference: null,
      deliveredAt: null,
      suppressedAt: null,
      historical: false,
    },
    {
      state: "suppressed",
      lastOutcome: "suppressed",
      supplierDeliveryReference: null,
      deliveredAt: null,
      suppressedAt: "2099-01-01T00:00:00Z",
      historical: false,
    },
  ] as const)("accepts the database's valid $state shape", async (status) => {
    const rpc = vi.fn().mockResolvedValue({
      data: { receiptId: receipt, ...status },
      error: null,
    });
    await expect(
      new SupabaseBookingNotificationStatusRepository({
        rpc,
      } as never).get(receipt),
    ).resolves.toMatchObject(status);
  });
  it("fails closed on malformed status", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { receiptId: receipt, state: "delivered", historical: false },
      error: null,
    });
    await expect(
      new SupabaseBookingNotificationStatusRepository({
        rpc,
      } as never).get(receipt),
    ).rejects.toThrow("invalid notification status");
  });
  it.each([
    {
      state: "delivered",
      lastOutcome: "failed",
      supplierDeliveryReference: "fictional-35",
      deliveredAt: "2099-01-01T00:00:00Z",
      suppressedAt: null,
      historical: false,
    },
    {
      state: "suppressed",
      lastOutcome: "suppressed",
      supplierDeliveryReference: null,
      deliveredAt: "2099-01-01T00:00:00Z",
      suppressedAt: "2099-01-01T00:00:00Z",
      historical: false,
    },
    {
      state: "pending",
      lastOutcome: null,
      supplierDeliveryReference: null,
      deliveredAt: null,
      suppressedAt: null,
      historical: true,
    },
  ])("rejects contradictory delivery evidence", async (status) => {
    const rpc = vi.fn().mockResolvedValue({
      data: { receiptId: receipt, ...status },
      error: null,
    });
    await expect(
      new SupabaseBookingNotificationStatusRepository({
        rpc,
      } as never).get(receipt),
    ).rejects.toThrow("invalid notification status");
  });
  it("rejects malformed delivery timestamps", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        receiptId: receipt,
        state: "delivered",
        lastOutcome: "delivered",
        supplierDeliveryReference: "fictional-35",
        deliveredAt: "tomorrow",
        suppressedAt: null,
        historical: false,
      },
      error: null,
    });
    await expect(
      new SupabaseBookingNotificationStatusRepository({
        rpc,
      } as never).get(receipt),
    ).rejects.toThrow("invalid notification status");
  });
  it("queues an authenticated retry through its narrow RPC", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: { status: "queued" }, error: null });
    await expect(
      new SupabaseBookingNotificationStatusRepository({
        rpc,
      } as never).retry(receipt),
    ).resolves.toEqual({ status: "queued" });
    expect(rpc).toHaveBeenCalledWith(
      "retry_booking_confirmation_notification",
      { target_receipt_id: receipt },
    );
  });
});

describe("event notification status and retry", () => {
  const eventId = "00000000-0000-4000-8000-000000000081";
  const status = {
    receiptId: receipt,
    eventId,
    state: "pending",
    lastOutcome: null,
    supplierDeliveryReference: null,
    deliveredAt: null,
    suppressedAt: null,
    historical: false,
  };
  it("reads the chosen event instead of the original confirmation notice", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: status, error: null });
    await expect(
      new SupabaseBookingNotificationStatusRepository({ rpc } as never).get(
        receipt,
        eventId,
      ),
    ).resolves.toEqual(status);
    expect(rpc).toHaveBeenCalledWith(
      "get_booking_confirmation_notification_status",
      { target_receipt_id: receipt, target_event_id: eventId },
    );
  });
  it("rejects status for another event on the same receipt", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { ...status, eventId: "00000000-0000-4000-8000-000000000082" },
      error: null,
    });
    await expect(
      new SupabaseBookingNotificationStatusRepository({ rpc } as never).get(
        receipt,
        eventId,
      ),
    ).rejects.toThrow("invalid notification status");
  });
  it("retries only the selected failed event", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: { status: "queued" }, error: null });
    await expect(
      new SupabaseBookingNotificationStatusRepository({ rpc } as never).retry(
        receipt,
        eventId,
      ),
    ).resolves.toEqual({ status: "queued" });
    expect(rpc).toHaveBeenCalledWith(
      "retry_booking_confirmation_notification",
      { target_receipt_id: receipt, target_event_id: eventId },
    );
  });
});
