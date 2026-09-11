import { describe, it, expect, vi } from "vitest";
import {
  getBookingFinancialView,
  parseBookingFinancialView,
} from "./booking-financial-view";
const reference = "RC-REQ-0000000000001001";
const zero = { bookingPriceFils: 0, bookingServiceFeeFils: 0 };
const view = {
  bookingRequestId: "60000000-0000-4000-8000-000000001001",
  bookingRequestReference: reference,
  bookingReference: "BOOKING-38",
  actorRole: "customer" as const,
  cottageName: "Preserved Cottage",
  firstStartsAt: "2101-01-01T05:00:00Z",
  bookingTermsBody: "Original accepted terms",
  captured: { bookingPriceFils: 110000000, bookingServiceFeeFils: 5000000 },
  refunded: zero,
  reserved: zero,
  cancellation: null,
  refunds: [],
  notifications: [],
};
describe("safe financial projection binding", () => {
  it("returns an explicit whitelist without private access fields", () => {
    expect(
      parseBookingFinancialView(
        {
          ...view,
          exactAddress: "PRIVATE address",
          ownerPhone: "+9647500000000",
        },
        reference,
        "customer",
      ),
    ).toEqual(view);
  });
  it.each([
    { actorRole: "cottage_owner" },
    { bookingRequestReference: "RC-REQ-0000000000009999" },
    { audit: { reason: "PRIVATE" } },
  ])(
    "rejects a changed participant binding or privileged audit %j",
    (change) => {
      expect(() =>
        parseBookingFinancialView(
          { ...view, ...change },
          reference,
          "customer",
        ),
      ).toThrow();
    },
  );
  it("rejects money beyond the original capture", () => {
    expect(() =>
      parseBookingFinancialView(
        {
          ...view,
          refunded: { bookingPriceFils: 120000000, bookingServiceFeeFils: 0 },
        },
        reference,
        "customer",
      ),
    ).toThrow();
  });
  it("retains each approval without summing historical failed and replacement amounts", () => {
    const approval = {
      id: "90000000-0000-4000-8000-000000003851",
      occurredAt: "2100-12-01T12:00:00Z",
      source: "administrator",
      state: "failed",
      allocation: view.captured,
    };
    const source = {
      ...view,
      refunds: [
        approval,
        {
          ...approval,
          id: "90000000-0000-4000-8000-000000003852",
          state: "requested",
        },
      ],
    };
    expect(
      parseBookingFinancialView(source, reference, "customer").refunds,
    ).toEqual(source.refunds);
  });
  it("keeps an authorized administrator audit while stripping unexpected access details", () => {
    const audit = {
      cancellation: {
        reason: "Privileged reason",
        category: "safety",
        actorUserId: "10000000-0000-4000-8000-000000003801",
        actorRole: "platform_administrator",
      },
      refunds: [],
    };
    const result = parseBookingFinancialView(
      {
        ...view,
        actorRole: "platform_administrator",
        audit,
        exactAddress: "PRIVATE",
      },
      reference,
      "platform_administrator",
    );
    expect(result.audit).toEqual(audit);
    expect(result).not.toHaveProperty("exactAddress");
  });
  it("maps authority denial to no view and preserves operational failure as failure", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { code: "42501" } })
      .mockResolvedValueOnce({
        data: null,
        error: { code: "XX000", message: "PRIVATE diagnostic" },
      });
    await expect(
      getBookingFinancialView({ rpc } as never, reference, "customer"),
    ).resolves.toBeNull();
    await expect(
      getBookingFinancialView({ rpc } as never, reference, "customer"),
    ).rejects.toThrow("Booking financial view is unavailable");
  });
});
