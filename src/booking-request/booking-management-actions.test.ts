import { beforeEach, describe, expect, it, vi } from "vitest";
const { client, resolve, cancel, view, runtime, refresh } = vi.hoisted(() => ({
  client: {
    auth: {
      getUser: vi.fn(),
      mfa: { getAuthenticatorAssuranceLevel: vi.fn() },
    },
    rpc: vi.fn(),
  },
  resolve: vi.fn(),
  cancel: vi.fn(),
  view: vi.fn(),
  runtime: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ refresh }));
vi.mock("@/access/supabase-server", () => ({
  createRequestSupabaseClient: async () => client,
}));
vi.mock("@/access/supabase-account-access", () => ({
  SupabaseAccountContextStore: class {
    resolve = resolve;
  },
}));
vi.mock("./booking-cancellation", () => ({
  createBookingCancellation: () => ({ cancel }),
}));
vi.mock("./supabase-booking-cancellation", () => ({
  SupabaseBookingCancellationRepository: class {},
}));
vi.mock("./booking-request-test-runtime", () => ({
  bookingRequestTestRuntimeIsEnabled: runtime,
}));
vi.mock("./booking-financial-view", () => ({ getBookingFinancialView: view }));
import { manageConfirmedBooking } from "./booking-management-actions";
const commandId = "90000000-0000-4000-8000-000000003851";
const request = "60000000-0000-4000-8000-000000001001";
const form = (values: Record<string, string | undefined> = {}) => {
  const f = new FormData();
  Object.entries({
    locale: "en",
    reference: "RC-REQ-0000000000001001",
    actorRole: "customer",
    commandId,
    action: "cancel",
    reason: "",
    category: "",
    ...values,
  }).forEach(([k, v]) => {
    if (v !== undefined) f.set(k, v);
  });
  return f;
};
describe("confirmed booking command authority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtime.mockReturnValue(true);
    client.auth.getUser.mockResolvedValue({
      data: { user: { id: "actor" } },
      error: null,
    });
    resolve.mockResolvedValue({ userId: "actor", role: "customer" });
    view.mockResolvedValue({ bookingRequestId: request });
    cancel.mockResolvedValue({ status: "cancelled" });
    client.rpc.mockResolvedValue({
      data: { status: "requested" },
      error: null,
    });
    client.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({
      data: { currentLevel: "aal2" },
      error: null,
    });
  });
  it("uses the authenticated participant projection and preserves command identity", async () => {
    expect(
      await manageConfirmedBooking(
        { status: "idle" },
        form({ actorUserId: "forged" }),
      ),
    ).toEqual({ status: "cancelled" });
    expect(view).toHaveBeenCalledWith(
      client,
      "RC-REQ-0000000000001001",
      "customer",
    );
    expect(cancel).toHaveBeenCalledWith({
      bookingRequestId: request,
      commandId,
      actorRole: "customer",
      reason: null,
      category: null,
    });
    expect(refresh).toHaveBeenCalled();
  });
  it("retains customer capability for an owner booking as a customer", async () => {
    resolve.mockResolvedValue({
      userId: "actor",
      role: "cottage_owner",
      approvalState: "suspended",
    });
    expect(await manageConfirmedBooking({ status: "idle" }, form())).toEqual({
      status: "cancelled",
    });
  });
  it("denies owner command from a customer before any booking operation", async () => {
    expect(
      await manageConfirmedBooking(
        { status: "idle" },
        form({ actorRole: "cottage_owner", reason: "Unavailable" }),
      ),
    ).toEqual({ status: "access-required" });
    expect(view).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });
  it("denies a participant projection outside this booking role", async () => {
    view.mockResolvedValue(null);
    expect(await manageConfirmedBooking({ status: "idle" }, form())).toEqual({
      status: "access-required",
    });
    expect(cancel).not.toHaveBeenCalled();
  });
  it("requires reason for owner cancellation", async () => {
    expect(
      await manageConfirmedBooking(
        { status: "idle" },
        form({ actorRole: "cottage_owner" }),
      ),
    ).toEqual({ status: "invalid" });
    expect(cancel).not.toHaveBeenCalled();
  });
  it("requires administrator strong authentication and attribution fields", async () => {
    resolve.mockResolvedValue({
      userId: "actor",
      role: "platform_administrator",
    });
    client.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({
      data: { currentLevel: "aal1" },
      error: null,
    });
    expect(
      await manageConfirmedBooking(
        { status: "idle" },
        form({
          actorRole: "platform_administrator",
          category: "safety",
          reason: "Private incident",
        }),
      ),
    ).toEqual({ status: "access-required" });
    expect(cancel).not.toHaveBeenCalled();
  });
  it("binds administrator cancellation category and reason without returning them", async () => {
    resolve.mockResolvedValue({
      userId: "actor",
      role: "platform_administrator",
    });
    expect(
      await manageConfirmedBooking(
        { status: "idle" },
        form({
          actorRole: "platform_administrator",
          category: "safety",
          reason: "Private incident",
        }),
      ),
    ).toEqual({ status: "cancelled" });
    expect(cancel).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "safety",
        reason: "Private incident",
      }),
    );
  });
  it("sends explicit exact-fils exception components through the authenticated RPC", async () => {
    resolve.mockResolvedValue({
      userId: "actor",
      role: "platform_administrator",
    });
    expect(
      await manageConfirmedBooking(
        { status: "idle" },
        form({
          actorRole: "platform_administrator",
          action: "refund",
          reason: "Private compensation",
          price: "20000.01",
          fee: "1.001",
        }),
      ),
    ).toEqual({ status: "requested" });
    expect(client.rpc).toHaveBeenCalledWith(
      "request_booking_refund_exception",
      {
        target_booking_request_id: request,
        target_command_id: commandId,
        target_reason: "Private compensation",
        target_allocation: {
          bookingPriceFils: 20000010,
          bookingServiceFeeFils: 1001,
        },
      },
    );
  });
  it.each([
    { action: "refund", price: "20", fee: "0", reason: "x" },
    { actorRole: "platform_administrator", category: "other", reason: "x" },
    { commandId: "invalid" },
    { locale: "de" },
  ])("rejects invalid or unauthorized command %j", async (values) => {
    expect(["invalid", "access-required"]).toContain(
      (await manageConfirmedBooking({ status: "idle" }, form(values))).status,
    );
    expect(cancel).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled();
  });
  it("does not expose database reasons or error content", async () => {
    view.mockRejectedValue(new Error("PRIVATE record"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await manageConfirmedBooking({ status: "idle" }, form())).toEqual({
      status: "unavailable",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("PRIVATE");
    log.mockRestore();
  });
  it("keeps the exact nonproduction runtime gate", async () => {
    runtime.mockReturnValue(false);
    expect(await manageConfirmedBooking({ status: "idle" }, form())).toEqual({
      status: "unavailable",
    });
    expect(resolve).not.toHaveBeenCalled();
  });
});
