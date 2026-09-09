import { describe, expect, it, vi } from "vitest";
import { SupabasePaidConfirmationNotificationStatusRepository } from "./notification-status-repository";
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
      new SupabasePaidConfirmationNotificationStatusRepository({
        rpc,
      } as never).get(receipt),
    ).resolves.toMatchObject({ state: "delivered", historical: true });
  });
  it("fails closed on malformed status", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { receiptId: receipt, state: "delivered", historical: false },
      error: null,
    });
    await expect(
      new SupabasePaidConfirmationNotificationStatusRepository({
        rpc,
      } as never).get(receipt),
    ).rejects.toThrow("invalid notification status");
  });
  it("queues an authenticated retry through its narrow RPC", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: { status: "queued" }, error: null });
    await expect(
      new SupabasePaidConfirmationNotificationStatusRepository({
        rpc,
      } as never).retry(receipt),
    ).resolves.toEqual({ status: "queued" });
    expect(rpc).toHaveBeenCalledWith(
      "retry_booking_confirmation_notification",
      { target_receipt_id: receipt },
    );
  });
});
