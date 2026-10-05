import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  confirmedAccess,
  createReview,
  customerRequest,
  deliveryStatus,
  financialView,
  getOwnReview,
  ownerRequest,
  rethrow,
} = vi.hoisted(() => ({
  confirmedAccess: vi.fn(),
  createReview: vi.fn(),
  customerRequest: vi.fn(),
  deliveryStatus: vi.fn(),
  financialView: vi.fn(),
  getOwnReview: vi.fn(),
  ownerRequest: vi.fn(),
  rethrow: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ unstable_rethrow: rethrow }));
vi.mock("./request-confirmed-booking-access", () => ({
  loadConfirmedBookingAccess: confirmedAccess,
}));
vi.mock("./request-booking-financial-view", () => ({
  loadBookingFinancialView: financialView,
}));
vi.mock("./request-customer-booking-request", () => ({
  loadCustomerBookingRequest: customerRequest,
}));
vi.mock("./request-owner-booking-request-notifications", () => ({
  loadOwnerBookingRequest: ownerRequest,
}));
vi.mock("@/customer-review/request-customer-review", () => ({
  createRequestCustomerReview: createReview,
}));
vi.mock("@/notification/request-notification-status", () => ({
  loadRequestNotificationStatus: deliveryStatus,
}));

import {
  customerDisplayFixtures,
  ownerDisplayFixtures,
} from "../../tests/fixtures/booking-request-display.fixtures";
import { loadBookingRequestDetails } from "./request-booking-request-details";

type Role = "customer" | "cottage_owner";

const reference = "RC-REQ-AAAAAAAAAAAAAAAA";
const delivery = { status: "available", notices: [] };
const customerAccess = {
  access: { actorRole: "customer", exactAddress: "14 Private Lane" },
  notification: { receiptId: "receipt-572", state: "pending" },
  navigation: null,
};
const ownerAccess = {
  access: { actorRole: "cottage_owner", exactAddress: "14 Private Lane" },
  notification: { receiptId: "receipt-572", state: "pending" },
  navigation: null,
};
const confirmedView = {
  cancellation: null,
  lifecycle: { status: "confirmed" },
};
const cancelledView = {
  cancellation: { occurredAt: "2099-08-22T09:00:00.000Z" },
  lifecycle: { status: "cancelled" },
};
const ownReview = {
  status: "eligible",
  reviewExpiresAt: "2099-09-21T09:00:00.000Z",
};

const load = (role: Role) =>
  role === "customer"
    ? loadBookingRequestDetails(reference, "customer")
    : loadBookingRequestDetails(reference, "cottage_owner");

describe("Booking Request details access", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    deliveryStatus.mockResolvedValue(delivery);
    confirmedAccess.mockResolvedValue(null);
    financialView.mockResolvedValue(null);
    customerRequest.mockResolvedValue(null);
    ownerRequest.mockResolvedValue(null);
    createReview.mockResolvedValue({ getOwn: getOwnReview });
    getOwnReview.mockResolvedValue(ownReview);
  });

  afterEach(() => consoleError.mockRestore());

  it.each<[string, string, Role, unknown]>([
    ["Customer", "no read returns a row", "customer", null],
    ["Cottage Owner", "no read returns a row", "cottage_owner", null],
    [
      "Customer",
      "access is held as the Cottage Owner",
      "customer",
      ownerAccess,
    ],
    [
      "Cottage Owner",
      "access is held as the Customer",
      "cottage_owner",
      customerAccess,
    ],
  ])(
    "returns only the denied outcome to a non-party on the %s page: %s",
    async (_page, _state, role, access) => {
      confirmedAccess.mockResolvedValue(access);

      await expect(load(role)).resolves.toStrictEqual({ outcome: "denied" });
      expect(createReview).not.toHaveBeenCalled();
    },
  );

  it.each<[Role, "denied" | "unavailable"]>([
    ["customer", "denied"],
    ["cottage_owner", "denied"],
    ["customer", "unavailable"],
    ["cottage_owner", "unavailable"],
  ])(
    "reads delivery status once, first and for the %s role, even when the outcome is %s",
    async (role, outcome) => {
      if (outcome === "unavailable")
        confirmedAccess.mockRejectedValue(new Error("access unavailable"));

      await expect(load(role)).resolves.toStrictEqual({ outcome });
      expect(deliveryStatus).toHaveBeenCalledTimes(1);
      expect(deliveryStatus).toHaveBeenCalledWith(reference, role);
      expect(deliveryStatus.mock.invocationCallOrder[0]).toBeLessThan(
        confirmedAccess.mock.invocationCallOrder[0],
      );
    },
  );

  const readFailure = new Error("read unavailable");

  it.each<[string, string, string, Role, string, () => void, number]>([
    [
      "Customer",
      "customer_confirmed_booking_failed",
      "access",
      "customer",
      "Customer confirmed Booking load failed",
      () => confirmedAccess.mockRejectedValue(readFailure),
      0,
    ],
    [
      "Customer",
      "customer_confirmed_booking_failed",
      "financial",
      "customer",
      "Customer confirmed Booking load failed",
      () => {
        confirmedAccess.mockResolvedValue(ownerAccess);
        financialView.mockRejectedValue(readFailure);
      },
      0,
    ],
    [
      "Customer",
      "customer_booking_request_status_failed",
      "Booking Request",
      "customer",
      "Customer Booking Request status failed",
      () => customerRequest.mockRejectedValue(readFailure),
      1,
    ],
    [
      "Cottage Owner",
      "owner_confirmed_booking_failed",
      "access",
      "cottage_owner",
      "Owner confirmed Booking load failed",
      () => confirmedAccess.mockRejectedValue(readFailure),
      0,
    ],
    [
      "Cottage Owner",
      "owner_confirmed_booking_failed",
      "financial",
      "cottage_owner",
      "Owner confirmed Booking load failed",
      () => {
        confirmedAccess.mockResolvedValue(customerAccess);
        financialView.mockRejectedValue(readFailure);
      },
      0,
    ],
    [
      "Cottage Owner",
      "owner_confirmed_booking_failed",
      "Booking Request",
      "cottage_owner",
      "Owner confirmed Booking load failed",
      () => ownerRequest.mockRejectedValue(readFailure),
      0,
    ],
  ])(
    "reports the %s page unavailable and logs only %s when the %s read fails",
    async (_page, code, _read, role, message, failRead, customerReads) => {
      failRead();

      await expect(load(role)).resolves.toStrictEqual({
        outcome: "unavailable",
      });
      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(consoleError).toHaveBeenCalledWith(message, { code });
      expect(rethrow).toHaveBeenCalledWith(readFailure);
      expect(customerRequest).toHaveBeenCalledTimes(customerReads);
    },
  );

  it.each<[string, Role]>([
    ["Customer", "customer"],
    ["Cottage Owner", "cottage_owner"],
  ])(
    "reports the %s page unavailable without logging when the Booking Request runtime is off",
    async (_page, role) => {
      confirmedAccess.mockResolvedValue(undefined);
      customerRequest.mockResolvedValue(undefined);
      ownerRequest.mockResolvedValue(undefined);

      await expect(load(role)).resolves.toStrictEqual({
        outcome: "unavailable",
      });
      expect(consoleError).not.toHaveBeenCalled();
    },
  );

  it.each<[string, Role]>([
    ["Customer", "customer"],
    ["Cottage Owner", "cottage_owner"],
  ])(
    "returns the cancelled outcome with the %s financial view and no Access Details",
    async (_page, role) => {
      financialView.mockResolvedValue(cancelledView);

      await expect(load(role)).resolves.toStrictEqual({
        outcome: "cancelled",
        financial: cancelledView,
        delivery,
      });
      expect(financialView).toHaveBeenCalledWith(reference, role);
      expect(customerRequest).not.toHaveBeenCalled();
    },
  );

  it("keeps a Cottage Owner's cancelled booking when the Booking Request read fails after the financial view", async () => {
    financialView.mockResolvedValue(cancelledView);
    ownerRequest.mockRejectedValue(readFailure);

    await expect(
      loadBookingRequestDetails(reference, "cottage_owner"),
    ).resolves.toStrictEqual({
      outcome: "cancelled",
      financial: cancelledView,
      delivery,
    });
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      "Owner confirmed Booking load failed",
      { code: "owner_confirmed_booking_failed" },
    );
  });

  it("returns a Customer's Confirmed Booking with their own review", async () => {
    confirmedAccess.mockResolvedValue(customerAccess);
    financialView.mockResolvedValue(confirmedView);

    await expect(
      loadBookingRequestDetails(reference, "customer"),
    ).resolves.toStrictEqual({
      outcome: "confirmed",
      confirmed: customerAccess,
      financial: confirmedView,
      review: ownReview,
      delivery,
    });
    expect(getOwnReview).toHaveBeenCalledWith(reference);
  });

  it("keeps a Customer's Confirmed Booking when their review cannot be read", async () => {
    confirmedAccess.mockResolvedValue(customerAccess);
    financialView.mockResolvedValue(confirmedView);
    getOwnReview.mockRejectedValue(readFailure);

    await expect(
      loadBookingRequestDetails(reference, "customer"),
    ).resolves.toStrictEqual({
      outcome: "confirmed",
      confirmed: customerAccess,
      financial: confirmedView,
      review: { status: "unavailable" },
      delivery,
    });
    expect(rethrow).toHaveBeenCalledWith(readFailure);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith("Customer review load failed", {
      code: "customer_review_load_unavailable",
    });
  });

  it("returns a Cottage Owner's Confirmed Booking without reading a review", async () => {
    confirmedAccess.mockResolvedValue(ownerAccess);

    await expect(
      loadBookingRequestDetails(reference, "cottage_owner"),
    ).resolves.toStrictEqual({
      outcome: "confirmed",
      confirmed: ownerAccess,
      financial: null,
      delivery,
    });
    expect(createReview).not.toHaveBeenCalled();
  });

  it.each([
    [
      "Customer",
      "customer",
      customerRequest,
      customerDisplayFixtures["capture-processing"],
    ],
    [
      "Cottage Owner",
      "cottage_owner",
      ownerRequest,
      ownerDisplayFixtures["capture-processing"],
    ],
  ] as const)(
    "returns the pending outcome with the %s Booking Request when no Confirmed Booking exists",
    async (_page, role, reader, request) => {
      reader.mockResolvedValue(request);

      await expect(load(role)).resolves.toStrictEqual({
        outcome: "pending",
        request,
        delivery,
      });
      expect(reader).toHaveBeenCalledWith(reference);
    },
  );
});
