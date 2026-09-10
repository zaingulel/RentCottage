import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
const retryAction = vi.hoisted(() => vi.fn());
vi.mock("@/notification/notification-actions", () => ({
  retryPaidConfirmationNotification: retryAction,
}));
import { ConfirmedBookingDetails } from "./confirmed-booking-details";
const base = {
  receiptId: "82000000-0000-4000-8000-000000003502",
  bookingRequestReference: "RC-REQ-0000000000003501",
  bookingReference: "CONFIRMED-BOOKING-35",
  confirmedAt: "2100-12-31T13:00:00Z",
  actorRole: "customer" as const,
  customerName: "Fictional Customer",
  cottageName: "Preserved Cottage",
  bookingPeriod: [
    {
      serviceDay: "2101-01-01",
      displayName: "Morning",
      startsAt: "2101-01-01T08:00:00+03:00",
      endsAt: "2101-01-01T12:00:00+03:00",
      crossesMidnight: false,
      priceIqd: 110000,
      kind: "shift" as const,
      position: 1 as const,
    },
  ],
  partySize: 4,
  pricing: {
    bookingPriceIqd: 110000,
    serviceFeeIqd: 5000,
    customerTotalIqd: 115000,
  },
  houseRules: "Preserved House Rules",
  bookingTermsVersion: "terms-v1",
  bookingTermsBody: "Preserved readable booking terms.",
  cancellationPolicyVersion: "cancel-v1",
  exactAddress: "Current private address",
  privateDirections: "Turn after the fictional bridge",
  mapPin: { latitude: 33.315241, longitude: 44.366067 },
  customerPhone: "+9647500003502",
  ownerPhone: "+9647500003501",
};
const pending = {
  receiptId: base.receiptId,
  state: "pending" as const,
  lastOutcome: null,
  supplierDeliveryReference: null,
  deliveredAt: null,
  suppressedAt: null,
  historical: false,
};
describe("confirmed booking details", () => {
  it("renders preserved commercial facts and current private access for the paid customer", () => {
    render(
      <ConfirmedBookingDetails
        locale="en"
        access={base}
        notification={pending}
      />,
    );
    expect(screen.getByText("Preserved House Rules")).toBeInTheDocument();
    expect(screen.getByText("Current private address")).toBeInTheDocument();
    expect(screen.getByText("33.315241, 44.366067")).toBeInTheDocument();
    expect(screen.getByText("+9647500003502")).toBeInTheDocument();
    expect(screen.getByText("+9647500003501")).toBeInTheDocument();
    expect(
      screen.getByText(/no message was sent by a real supplier/i),
    ).toBeInTheDocument();
  });
  it("renders Sorani labels and a bounded retry only for known failure", () => {
    render(
      <ConfirmedBookingDetails
        locale="ckb"
        access={base}
        notification={{ ...pending, state: "retryable", lastOutcome: "failed" }}
      />,
    );
    expect(
      screen.getByRole("button", { name: "دووبارە هەوڵدانەوەی ئاگادارکردن" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "مێژووی حجزەکان" }),
    ).toHaveAttribute("href", "/ckb/bookings");
  });
  it("does not offer retry for uncertain delivery", () => {
    render(
      <ConfirmedBookingDetails
        locale="ar"
        access={base}
        notification={{
          ...pending,
          state: "uncertain",
          lastOutcome: "unknown",
        }}
      />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("جارٍ التحقق من التسليم")).toBeInTheDocument();
  });
  it("keeps paid details visible when delivery status is unavailable", () => {
    render(
      <ConfirmedBookingDetails
        locale="en"
        access={base}
        notification={{
          receiptId: base.receiptId,
          state: "unavailable",
          lastOutcome: null,
          supplierDeliveryReference: null,
          deliveredAt: null,
          suppressedAt: null,
          historical: false,
        }}
      />,
    );
    expect(
      screen.getByText("Preserved readable booking terms."),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Delivery status is temporarily unavailable",
    );
  });
  it.each([
    ["en", "Some practical access or contact details are unavailable."],
    ["ar", "بعض تفاصيل الوصول أو الاتصال غير متاحة."],
    ["ckb", "هەندێک وردەکاری گەیشتن یان پەیوەندی بەردەست نییە."],
  ] as const)(
    "truthfully identifies incomplete practical details in %s",
    (locale, incomplete) => {
      render(
        <ConfirmedBookingDetails
          locale={locale}
          access={{
            ...base,
            exactAddress: null,
            privateDirections: null,
            mapPin: null,
            customerPhone: null,
            ownerPhone: null,
          }}
          notification={pending}
        />,
      );
      expect(screen.getByRole("status", { name: incomplete })).toBeVisible();
      expect(
        screen.queryByText("Current private address"),
      ).not.toBeInTheDocument();
    },
  );
  it("keeps paid details visible and explains a failed retry", async () => {
    retryAction.mockResolvedValue({ status: "failed" });
    render(
      <ConfirmedBookingDetails
        locale="en"
        access={base}
        notification={{ ...pending, state: "retryable", lastOutcome: "failed" }}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Retry confirmation notice" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The notice could not be retried",
    );
    expect(screen.getByText("Preserved House Rules")).toBeInTheDocument();
    expect(screen.getByText("Current private address")).toBeInTheDocument();
  });
});
