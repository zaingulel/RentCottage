vi.mock("server-only", () => ({}));
vi.mock("@/notification/notification-actions", () => ({
  retryPaidConfirmationNotification: vi.fn(),
}));
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { loadDetails, refresh } = vi.hoisted(() => ({
  loadDetails: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/access/request-account-context", () => ({
  requireRequestAccount: vi.fn().mockResolvedValue({ status: "authenticated" }),
}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
  useRouter: () => ({ refresh }),
}));
vi.mock("@/booking-request/lifecycle-actions", () => ({
  actOnBookingRequest: vi.fn(),
}));
vi.mock("@/customer-review/actions", () => ({
  submitCustomerReviewReply: vi.fn(),
}));
vi.mock("@/booking-request/request-booking-request-details", () => ({
  loadBookingRequestDetails: loadDetails,
}));
vi.mock("@/components/confirmed-booking-details", () => ({
  ConfirmedBookingDetails: () => <h1>Confirmed booking</h1>,
}));
vi.mock("@/components/booking-financial-details", () => ({
  BookingFinancialDetails: () => <h2>Cancellation and refunds</h2>,
}));
vi.mock("@/components/account-access-recovery", () => ({
  AccountAccessRecovery: () => <div role="alert">Access recovery</div>,
}));
import Page from "./page";
import { ownerDisplayFixtures } from "../../../../../../tests/fixtures/booking-request-display.fixtures";
const params = (locale: string) =>
  Promise.resolve({ locale, reference: "RC-REQ-AAAAAAAAAAAAAAAA" });
const delivery = { status: "unavailable" as const };
beforeEach(() => {
  vi.clearAllMocks();
  loadDetails.mockResolvedValue({
    outcome: "confirmed",
    confirmed: { access: { actorRole: "cottage_owner" }, navigation: null },
    financial: { cancellation: null, lifecycle: { status: "confirmed" } },
    review: { status: "no-review" },
    delivery,
  });
});
afterEach(() => vi.useRealTimers());
it.each([
  ["en", "Booking details are unavailable", "Your cottages"],
  ["ar", "تفاصيل الحجز غير متاحة", "أكواخك"],
  ["ckb", "وردەکارییەکانی حجز بەردەست نییە", "کۆتێجەکانت"],
])(
  "shows financial-load failure and a recovery link in %s",
  async (locale, message, linkLabel) => {
    loadDetails.mockResolvedValue({ outcome: "unavailable" });
    render(await Page({ params: params(locale) }));
    expect(
      within(screen.getByRole("alert")).getByRole("heading", { name: message }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: linkLabel })).toHaveAttribute(
      "href",
      `/${locale}/owner/cottages`,
    );
    expect(
      screen.queryByRole("heading", { name: "Confirmed booking" }),
    ).not.toBeInTheDocument();
  },
);
it("keeps successful private owner details and refund information together", async () => {
  render(await Page({ params: params("en") }));
  expect(
    screen.getByRole("heading", { name: "Confirmed booking" }),
  ).toBeVisible();
  expect(
    screen.getByRole("heading", { name: "Cancellation and refunds" }),
  ).toBeVisible();
  expect(loadDetails).toHaveBeenCalledWith(
    "RC-REQ-AAAAAAAAAAAAAAAA",
    "cottage_owner",
  );
});
it("retains cancellation history without reopening private access", async () => {
  loadDetails.mockResolvedValue({
    outcome: "cancelled",
    financial: { cancellation: {} },
    delivery,
  });
  render(await Page({ params: params("en") }));
  expect(
    screen.getByRole("heading", { name: "Cancellation and refunds" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "Confirmed booking" }),
  ).not.toBeInTheDocument();
});
it("opens an authorised unpaid owner request from complete history", async () => {
  loadDetails.mockResolvedValue({
    outcome: "pending",
    request: ownerDisplayFixtures["capture-processing"],
    delivery,
  });
  render(await Page({ params: params("en") }));
  expect(
    screen.getByRole("article", { name: "RC-REQ-AAAAAAAAAAAAAAAA" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "Confirmed booking" }),
  ).not.toBeInTheDocument();
});
it("replaces an unpaid request with its authoritative payment status", async () => {
  vi.useFakeTimers();
  loadDetails
    .mockResolvedValueOnce({
      outcome: "pending",
      request: ownerDisplayFixtures["capture-processing"],
      delivery,
    })
    .mockResolvedValueOnce({
      outcome: "pending",
      request: ownerDisplayFixtures["payment-required-open"],
      delivery,
    });
  const view = render(await Page({ params: params("en") }));
  expect(
    within(screen.getByRole("article")).getByRole("status"),
  ).toHaveTextContent("Payment confirmation pending");
  vi.advanceTimersToNextTimer();
  expect(refresh).toHaveBeenCalledOnce();
  view.rerender(await Page({ params: params("en") }));
  expect(
    within(screen.getByRole("article")).getByRole("status"),
  ).toHaveTextContent("The Customer’s automatic payment failed");
});
it("keeps participant role isolation", async () => {
  loadDetails.mockResolvedValue({ outcome: "denied" });
  render(await Page({ params: params("en") }));
  expect(screen.getByRole("alert")).toHaveTextContent("Access recovery");
  expect(screen.queryByRole("heading")).not.toBeInTheDocument();
});

it("keeps paid details visible when request delivery status cannot load", async () => {
  render(await Page({ params: params("en") }));
  expect(
    screen.getByRole("heading", { name: "Confirmed booking" }),
  ).toBeVisible();
  expect(
    screen.getByText(
      "Notification delivery status is unavailable. Your request details remain available.",
    ),
  ).toBeVisible();
});

it.each([
  ["en", "Customer review", "Public reply", "Publish reply"],
  ["ar", "تقييم العميل", "الرد العلني", "نشر الرد"],
  ["ckb", "هەڵسەنگاندنی کڕیار", "وەڵامی گشتی", "بڵاوکردنەوەی وەڵام"],
])(
  "shows the Customer review and reply form on a Confirmed Booking in %s",
  async (locale, title, bodyLabel, submitLabel) => {
    loadDetails.mockResolvedValue({
      outcome: "confirmed",
      confirmed: { access: { actorRole: "cottage_owner" }, navigation: null },
      financial: { cancellation: null, lifecycle: { status: "confirmed" } },
      review: {
        status: "reviewed",
        rating: 5,
        originalLanguage: "en",
        originalBody: "A quiet stay",
        submittedAt: "2026-09-21T12:00:00.000Z",
        reply: null,
      },
      delivery,
    });
    render(await Page({ params: params(locale) }));
    const region = screen.getByRole("region", { name: title });
    expect(within(region).getByText("A quiet stay")).toBeVisible();
    expect(
      within(region).getByRole("textbox", { name: bodyLabel }),
    ).toBeVisible();
    expect(
      within(region).getByRole("button", { name: submitLabel }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Confirmed booking" }),
    ).toBeVisible();
  },
);
it("shows no review section outside a Confirmed Booking", async () => {
  loadDetails.mockResolvedValue({
    outcome: "cancelled",
    financial: { cancellation: {} },
    delivery,
  });
  const view = render(await Page({ params: params("en") }));
  expect(
    screen.getByRole("heading", { name: "Cancellation and refunds" }),
  ).toBeVisible();
  expect(screen.queryByRole("region", { name: "Customer review" })).toBeNull();
  view.unmount();

  loadDetails.mockResolvedValue({
    outcome: "pending",
    request: ownerDisplayFixtures["capture-processing"],
    delivery,
  });
  render(await Page({ params: params("en") }));
  expect(
    screen.getByRole("article", { name: "RC-REQ-AAAAAAAAAAAAAAAA" }),
  ).toBeVisible();
  expect(screen.queryByRole("region", { name: "Customer review" })).toBeNull();
});
