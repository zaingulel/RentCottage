import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadRequest, loadConfirmed, loadFinancial, notFound, router } =
  vi.hoisted(() => ({
    loadRequest: vi.fn(),
    loadConfirmed: vi.fn(),
    loadFinancial: vi.fn(),
    notFound: vi.fn(),
    router: { refresh: vi.fn() },
  }));

vi.mock("@/access/request-account-context", () => ({
  requireRequestAccount: vi.fn().mockResolvedValue({
    status: "authenticated",
    context: {
      userId: "fixture",
      role: "cottage_owner",
      approvalState: "approved",
    },
  }),
}));
vi.mock("@/access/actions", () => ({ signOutAccount: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound,
  unstable_rethrow: vi.fn(),
  useRouter: () => router,
}));
vi.mock("@/booking-request/request-customer-booking-request", () => ({
  loadCustomerBookingRequest: loadRequest,
}));
vi.mock("@/booking-request/request-confirmed-booking-access", () => ({
  loadConfirmedBookingAccess: loadConfirmed,
}));
vi.mock("@/booking-request/request-booking-financial-view", () => ({
  loadBookingFinancialView: loadFinancial,
}));
vi.mock("@/booking-request/lifecycle-actions", () => ({
  actOnBookingRequest: vi.fn(),
}));

vi.mock("@/components/booking-financial-details", () => ({
  BookingFinancialDetails: () => <div>Retained cancellation</div>,
}));
import CustomerBookingRequestPage from "./page";

const request = {
  id: "00000000-0000-4000-8000-000000000033",
  bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
  status: "pending" as const,
  cottageName: "Fictional Riverside Cottage",
  bookingPeriod: [
    {
      serviceDay: "2099-08-21",
      kind: "shift" as const,
      position: 2 as const,
      displayName: "Evening",
      startsAt: "2099-08-21T20:00:00+03:00",
      endsAt: "2099-08-21T23:00:00+03:00",
      crossesMidnight: false,
      priceIqd: 100_000,
    },
  ],
  partySize: 4,
  bookingPriceIqd: 100_000,
  serviceFeeIqd: 5_000,
  customerTotalIqd: 105_000,
  responseDeadline: "2099-08-21T21:00:00.000Z",
  declineReason: null,
  declineNote: null,
  statusNotifications: [],
};

describe("authenticated Customer Booking Request page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadConfirmed.mockResolvedValue(null);
    loadFinancial.mockResolvedValue(null);
  });

  it("renders a single contact-safe request and withdrawal control in right-to-left Arabic", async () => {
    loadRequest.mockResolvedValue(request);
    render(
      await CustomerBookingRequestPage({
        params: Promise.resolve({
          locale: "ar",
          reference: request.bookingRequestReference,
        }),
      }),
    );
    expect(
      screen.getByRole("heading", { name: "حالة طلب الحجز" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "سحب الطلب قيد الانتظار" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Fictional Riverside Cottage")).toBeInTheDocument();
    expect(
      screen.queryByText(/phone|email|address|provider/i),
    ).not.toBeInTheDocument();
  });

  it("does not disclose another Customer's missing request", async () => {
    loadRequest.mockResolvedValue(null);
    render(
      await CustomerBookingRequestPage({
        params: Promise.resolve({
          locale: "en",
          reference: request.bookingRequestReference,
        }),
      }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This booking is not available to this account.",
    );
  });

  it.each([
    ["en", "Booking Request status is unavailable"],
    ["ar", "حالة طلب الحجز غير متاحة"],
    ["ckb", "دۆخی داواکاری حجز بەردەست نییە"],
  ] as const)(
    "renders the localized unavailable recovery when confirmed access cannot be checked in %s",
    async (locale, unavailable) => {
      loadConfirmed.mockRejectedValueOnce(new Error("database unavailable"));

      render(
        await CustomerBookingRequestPage({
          params: Promise.resolve({
            locale,
            reference: request.bookingRequestReference,
          }),
        }),
      );

      expect(screen.getByRole("alert")).toHaveTextContent(unavailable);
      expect(loadRequest).not.toHaveBeenCalled();
      expect(screen.queryByText("Confirmed booking")).not.toBeInTheDocument();
    },
  );

  it("renders Sorani status copy without exposing the pending machine key", async () => {
    loadRequest.mockResolvedValue(request);
    render(
      await CustomerBookingRequestPage({
        params: Promise.resolve({
          locale: "ckb",
          reference: request.bookingRequestReference,
        }),
      }),
    );
    expect(screen.getByText("چاوەڕێ", { exact: true })).toBeInTheDocument();
    expect(
      screen.queryByText("pending", { exact: true }),
    ).not.toBeInTheDocument();
  });

  it("renders an Arabic decline reason and note without raw machine keys", async () => {
    loadRequest.mockResolvedValue({
      ...request,
      status: "declined",
      declineReason: "cannot_accommodate_request",
      declineNote: "لا يمكن تجهيز المكان بأمان.",
      statusNotifications: [
        {
          id: "00000000-0000-4000-8000-000000000044",
          status: "declined",
          createdAt: "2099-08-21T18:00:00.000Z",
        },
      ],
    });
    render(
      await CustomerBookingRequestPage({
        params: Promise.resolve({
          locale: "ar",
          reference: request.bookingRequestReference,
        }),
      }),
    );
    expect(screen.getAllByText("مرفوض").length).toBeGreaterThan(0);
    expect(screen.getByText("لا يمكن تلبية هذا الطلب")).toBeInTheDocument();
    expect(screen.getByText("لا يمكن تجهيز المكان بأمان.")).toBeInTheDocument();
    expect(
      screen.queryByText("declined", { exact: true }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("cannot_accommodate_request", { exact: true }),
    ).not.toBeInTheDocument();
  });
});

it("routes retained cancellation to safe history without reopening private access or pending status", async () => {
  loadConfirmed.mockResolvedValue(null);
  loadFinancial.mockResolvedValue({
    cancellation: { occurredAt: "2101-01-01T05:00:00Z" },
    actorRole: "customer",
  });
  loadRequest.mockClear();
  render(
    await CustomerBookingRequestPage({
      params: Promise.resolve({
        locale: "en",
        reference: request.bookingRequestReference,
      }),
    }),
  );
  expect(screen.getByText("Retained cancellation")).toBeVisible();
  expect(loadRequest).not.toHaveBeenCalled();
  expect(screen.queryByText("Confirmed booking")).not.toBeInTheDocument();
  expect(loadFinancial).toHaveBeenCalledWith(
    request.bookingRequestReference,
    "customer",
  );
});
