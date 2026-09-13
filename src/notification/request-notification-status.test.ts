import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), runtime: vi.fn(() => true) }));
vi.mock("@/access/supabase-server", () => ({
  createRequestSupabaseClient: async () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/booking-request/booking-request-test-runtime", () => ({
  bookingRequestTestRuntimeIsEnabled: mocks.runtime,
}));
import { loadRequestNotificationStatus } from "./request-notification-status";
import { SupabaseBookingNotificationStatusRepository } from "./notification-status-repository";
const notice = {
  receiptId: null,
  eventId: "00000000-0000-4000-8000-000000000228",
  kind: "request_new",
  createdAt: "2101-01-01T00:00:00Z",
  retryAllowed: false,
  state: "pending",
  lastOutcome: null,
  supplierDeliveryReference: null,
  deliveredAt: null,
  suppressedAt: null,
  historical: false,
};
it("lists only the authenticated role projection with explicit no receipt", async () => {
  mocks.rpc.mockResolvedValue({ data: [notice], error: null });
  await expect(
    loadRequestNotificationStatus("RC-REQ-0000000000000228", "cottage_owner"),
  ).resolves.toEqual({ status: "available", notices: [notice] });
  expect(mocks.rpc).toHaveBeenCalledWith(
    "list_booking_request_notification_status",
    {
      target_reference: "RC-REQ-0000000000000228",
      target_actor_role: "cottage_owner",
    },
  );
});
it.each([
  { data: null, error: {} },
  { data: [{ ...notice, state: "delivered" }], error: null },
])(
  "preserves a distinct unavailable presentation on failed/malformed reads",
  async (result) => {
    mocks.rpc.mockResolvedValue(result);
    await expect(
      loadRequestNotificationStatus("RC-REQ-0000000000000228", "customer"),
    ).resolves.toEqual({ status: "unavailable" });
  },
);
it("retries a request event with a null receipt binding", async () => {
  mocks.rpc.mockResolvedValue({ data: { status: "queued" }, error: null });
  await new SupabaseBookingNotificationStatusRepository({
    rpc: mocks.rpc,
  } as never).retry(null, notice.eventId);
  expect(mocks.rpc).toHaveBeenCalledWith(
    "retry_booking_confirmation_notification",
    { target_receipt_id: null, target_event_id: notice.eventId },
  );
});
