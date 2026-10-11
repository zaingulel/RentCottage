import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClient, resolve } = vi.hoisted(() => ({
  createClient: vi.fn(),
  resolve: vi.fn(),
}));
vi.mock("@/access/supabase-server", () => ({
  createRequestSupabaseClient: createClient,
}));
vi.mock("@/access/supabase-account-access", () => ({
  SupabaseAccountContextStore: class {
    resolve = resolve;
  },
}));
vi.mock("server-only", () => ({}));
import { readAdministratorBookingMoney } from "./supabase-administrator-booking-money";

const zero = { bookingPriceFils: 0, bookingServiceFeeFils: 0 };
const uuid = (n: number) =>
  `43000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const confirmedAt = (n: number) =>
  new Date(Date.UTC(2026, 9, 1, 0, 0, n))
    .toISOString()
    .replace(".000Z", ".123456+00:00");

// Price 100,000 IQD and fee 5,000 IQD, paid out at 90,000 IQD, then 10,000 IQD of price refunded.
const paidThenRefunded = {
  status: "captured",
  captured: { bookingPriceFils: 100_000_000, bookingServiceFeeFils: 5_000_000 },
  refunded: { bookingPriceFils: 10_000_000, bookingServiceFeeFils: 0 },
  reserved: zero,
  obligation: zero,
  marketplaceCommissionRateBasisPoints: 1_000,
  marketplaceCommissionAmountFils: 10_000_000,
  refunds: [
    {
      state: "succeeded",
      allocation: { bookingPriceFils: 10_000_000, bookingServiceFeeFils: 0 },
    },
  ],
  maturity: {
    status: "completed",
    effectivePeriodEnd: "2101-01-01T12:00:00Z",
    assessedAt: "2101-01-01T12:00:01Z",
    reviewExpiresAt: "2101-01-15T12:00:00Z",
    reviewAvailable: true,
    payoutPrerequisiteAt: "2101-01-01T12:00:00Z",
    payoutPrerequisiteAvailable: true,
  },
  administratorHoldActive: false,
  disputes: [],
  settlement: {
    amountFils: 90_000_000,
    state: "succeeded",
    retrySafe: false,
    receipt: { paidFils: 90_000_000, recordedAt: "2101-01-02T12:00:00Z" },
  },
  recovery: {
    status: "paid",
    paidFils: 90_000_000,
    ownerEntitlementFils: 81_000_000,
    paidWhileBlocked: false,
    recoveryExposureFils: 9_000_000,
    recoveryBalanceFils: 9_000_000,
    automaticOwnerDebitFils: 0,
  },
};
const bookingReply = (n: number, earnings: object = paidThenRefunded) => ({
  bookingRequestId: uuid(n),
  reference: `RC-REQ-${n.toString(16).toUpperCase().padStart(16, "0")}`,
  confirmedAt: confirmedAt(n),
  state: "completed",
  earnings,
  refundRecords: [
    {
      id: uuid(900 + n),
      source: "administrator",
      state: "succeeded",
      bookingPriceFils: 10_000_000,
      bookingServiceFeeFils: 0,
      requestedAt: "2026-10-02T09:00:00.000001+00:00",
    },
  ],
  settlementIntentId: uuid(800 + n),
});
// Newest first, as the database returns them.
const readyReply = (count: number) => ({
  status: "ready",
  bookings: Array.from({ length: count }, (_, i) => bookingReply(count - i)),
  missingPaymentEvidence: [],
});

describe("administrator booking money read", () => {
  const rpc = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    createClient.mockResolvedValue({ rpc });
    resolve.mockResolvedValue({ role: "platform_administrator" });
  });
  const allow = () => rpc.mockResolvedValueOnce({ data: true, error: null });
  const callNames = () => rpc.mock.calls.map(([name]) => name);

  it("does not query booking money when administrator access is not resolved", async () => {
    resolve.mockResolvedValue(undefined);
    allow();
    await expect(readAdministratorBookingMoney({})).resolves.toEqual({
      status: "access_required",
    });
    resolve.mockResolvedValue({ role: "platform_administrator" });
    rpc.mockResolvedValueOnce({ data: false, error: null });
    await expect(readAdministratorBookingMoney({})).resolves.toEqual({
      status: "access_required",
    });
    expect(callNames()).toEqual([
      "is_platform_administrator",
      "is_platform_administrator",
    ]);
  });

  it("maps a database refusal to access required", async () => {
    allow();
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    await expect(readAdministratorBookingMoney({})).resolves.toEqual({
      status: "access_required",
    });
    expect(callNames()).toEqual([
      "is_platform_administrator",
      "list_administrator_booking_money",
    ]);
  });

  it("returns invalid for an unknown status without querying", async () => {
    allow();
    await expect(
      readAdministratorBookingMoney({ state: "refunded" }),
    ).resolves.toEqual({ status: "invalid" });
    allow();
    await expect(
      readAdministratorBookingMoney({
        from: "2026-10-02",
        through: "2026-10-01",
      }),
    ).resolves.toEqual({ status: "invalid" });
    expect(callNames()).toEqual([
      "is_platform_administrator",
      "is_platform_administrator",
    ]);
  });

  it("returns unavailable for a malformed reply", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    allow();
    rpc.mockResolvedValueOnce({
      data: { ...readyReply(1), limit: 500 },
      error: null,
    });
    await expect(readAdministratorBookingMoney({})).resolves.toEqual({
      status: "unavailable",
    });
    allow();
    rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST500" } });
    await expect(readAdministratorBookingMoney({})).resolves.toEqual({
      status: "unavailable",
    });
    expect(logged.mock.calls).toEqual([
      [
        "Administrator records request failed",
        { operation: "booking_money_read", outcome: "unavailable" },
      ],
      [
        "Administrator records request failed",
        { operation: "booking_money_read", outcome: "unavailable" },
      ],
    ]);
    logged.mockRestore();
  });

  it("returns unavailable when a total exceeds the safe integer range", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const huge = {
      ...paidThenRefunded,
      captured: {
        bookingPriceFils: 5_000_000_000_000_000,
        bookingServiceFeeFils: 0,
      },
      refunded: zero,
      refunds: [],
      marketplaceCommissionAmountFils: 500_000_000_000_000,
      settlement: null,
      recovery: { status: "unsettled" },
    };
    const hugeBooking = (n: number) => ({
      ...bookingReply(n, huge),
      refundRecords: [],
      settlementIntentId: null,
    });
    allow();
    rpc.mockResolvedValueOnce({
      data: {
        status: "ready",
        bookings: [hugeBooking(2), hugeBooking(1)],
        missingPaymentEvidence: [],
      },
      error: null,
    });
    await expect(readAdministratorBookingMoney({})).resolves.toEqual({
      status: "unavailable",
    });
    expect(logged).toHaveBeenCalledTimes(1);
    logged.mockRestore();
  });

  it("reports a failed Platform Administrator check as unavailable without reading", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST500" } });
    await expect(readAdministratorBookingMoney({})).resolves.toEqual({
      status: "unavailable",
    });
    expect(logged.mock.calls.map(([, detail]) => detail.operation)).toEqual([
      "booking_money_authorization",
    ]);
    expect(callNames()).toEqual(["is_platform_administrator"]);
    logged.mockRestore();
  });

  it("returns too many with the limit", async () => {
    allow();
    rpc.mockResolvedValueOnce({
      data: { status: "too_many", limit: 500 },
      error: null,
    });
    await expect(
      readAdministratorBookingMoney({ state: "completed" }),
    ).resolves.toEqual({
      status: "too_many",
      search: {
        state: "completed",
        from: null,
        through: null,
        afterAt: null,
        afterId: null,
      },
      limit: 500,
    });
  });

  it("returns the summary and the first page", async () => {
    allow();
    rpc.mockResolvedValueOnce({ data: readyReply(26), error: null });
    const outcome = await readAdministratorBookingMoney({
      state: "completed",
      from: "2026-10-01",
      through: "2026-10-31",
    });
    expect(rpc).toHaveBeenNthCalledWith(1, "is_platform_administrator", {
      required_assurance: "aal2",
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "list_administrator_booking_money", {
      target_state: "completed",
      target_from: "2026-10-01",
      target_through: "2026-10-31",
    });
    if (outcome.status !== "ready") throw new Error(outcome.status);
    expect(outcome.summary.bookingCount).toBe(26);
    expect(outcome.summary.flagged).toEqual([]);
    // 26 bookings of the single-booking figures: 100,000 IQD price, 5,000 IQD fee, 10,000 IQD refunded.
    expect(outcome.summary.totals).toEqual({
      status: "available",
      figures: {
        bookingPriceFils: 2_600_000_000,
        bookingServiceFeeFils: 130_000_000,
        customerTotalFils: 2_730_000_000,
        commissionAtCaptureFils: 260_000_000,
        refundedBookingPriceFils: 260_000_000,
        refundedBookingServiceFeeFils: 0,
        pendingRefundFils: 0,
        commissionAfterRefundsFils: 234_000_000,
        ownerShareAtCaptureFils: 2_340_000_000,
        ownerShareAfterRefundsFils: 2_106_000_000,
        ownerShareReductionFils: 234_000_000,
        paidPayoutFils: 2_340_000_000,
        expectedUnpaidPayoutFils: 0,
        toRecoverFils: 234_000_000,
      },
    });
    expect(outcome.page.rows.map((row) => row.bookingRequestId)).toEqual(
      Array.from({ length: 25 }, (_, i) => uuid(26 - i)),
    );
    expect(outcome.page.nextCursor).toEqual({
      afterAt: confirmedAt(2),
      afterId: uuid(2),
    });
  });

  it("keeps the totals of the whole selection when a cursor selects a later page", async () => {
    allow();
    rpc.mockResolvedValueOnce({ data: readyReply(26), error: null });
    const outcome = await readAdministratorBookingMoney({
      afterAt: confirmedAt(2),
      afterId: uuid(2),
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "list_administrator_booking_money", {
      target_state: null,
      target_from: null,
      target_through: null,
    });
    if (outcome.status !== "ready") throw new Error(outcome.status);
    expect(outcome.summary.bookingCount).toBe(26);
    expect(outcome.page.rows.map((row) => row.bookingRequestId)).toEqual([
      uuid(1),
    ]);
    expect(outcome.page.nextCursor).toBeNull();
  });
});
