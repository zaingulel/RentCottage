import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { actOnBookingRequest } = vi.hoisted(() => ({
  actOnBookingRequest: vi.fn(),
}));
vi.mock("@/booking-request/lifecycle-actions", () => ({ actOnBookingRequest }));

import { OwnerBookingRequestNotifications } from "./owner-booking-request-notifications";
import {
  ownerDisplayFixtures,
  restrictedBookingRequestSentinels,
} from "../../tests/fixtures/booking-request-display.fixtures";

const pendingNotification = {
  id: "00000000-0000-4000-8000-000000000033",
  bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
  status: "pending" as const,
  customerName: "Ava Hassan",
  partySize: 4,
  bookingNote: null,
  cottageName: "Quiet Garden",
  bookingPeriod: [
    {
      serviceDay: "2099-08-21",
      kind: "shift" as const,
      position: 2 as const,
      displayName: "Evening",
      startsAt: "2099-08-21T20:00:00+03:00",
      endsAt: "2099-08-21T23:00:00+03:00",
      crossesMidnight: false,
      priceIqd: 100_003,
    },
  ],
  bookingPriceIqd: 100_003,
  marketplaceCommissionFils: 10_000_300,
  ownerNetFils: 90_002_700,
  houseRules: "No smoking",
  bookingTermsVersion: "terms-v1",
  cancellationPolicyVersion: "cancel-v1",
  statusNotifications: [],
  responseDeadline: "2099-08-21T21:00:00.000Z",
  createdAt: "2099-08-21T17:00:00.000Z",
};

describe("Owner Booking Request notifications", () => {
  beforeEach(() => actOnBookingRequest.mockReset());
  it("shows only the future notice when the privileged test path is unavailable", () => {
    render(
      <OwnerBookingRequestNotifications
        locale="en"
        notifications={undefined}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(
      "Online Booking Request alerts are not available yet",
    );
    expect(screen.queryByText("No Booking Requests")).not.toBeInTheDocument();
  });

  it("renders only the minimal customer and request details in Arabic", () => {
    render(
      <OwnerBookingRequestNotifications
        locale="ar"
        notifications={[
          {
            id: "00000000-0000-4000-8000-000000000033",
            bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
            status: "pending",
            customerName: "Ava Hassan",
            partySize: 4,
            bookingNote: "Garden seating, please.",
            cottageName: "Quiet Garden",
            bookingPeriod: [
              {
                serviceDay: "2099-08-21",
                kind: "shift",
                position: 2,
                displayName: "Evening",
                startsAt: "2099-08-21T20:00:00+03:00",
                endsAt: "2099-08-21T23:00:00+03:00",
                crossesMidnight: false,
                priceIqd: 100_003,
              },
            ],
            bookingPriceIqd: 100_003,
            marketplaceCommissionFils: 10_000_300,
            ownerNetFils: 90_002_700,
            houseRules: "No smoking",
            bookingTermsVersion: "rentcottage-mvp-2026-08-04",
            cancellationPolicyVersion: "rentcottage-cancellation-2026-08-04",
            statusNotifications: [],
            responseDeadline: "2099-08-21T21:00:00.000Z",
            createdAt: "2099-08-21T17:00:00.000Z",
          },
        ]}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "طلبات الحجز قيد الانتظار" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Ava Hassan")).toBeInTheDocument();
    expect(screen.getByText("Garden seating, please.")).toBeInTheDocument();
    expect(
      screen.queryByText(/phone|provider|payment/i),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Evening")).toBeInTheDocument();
    expect(screen.getByText("No smoking")).toBeInTheDocument();
    expect(screen.getByText("IQD 10,000.3 (10%)")).toBeInTheDocument();
    expect(screen.getByText("IQD 90,002.7")).toBeInTheDocument();
  });

  it("shows processing as static state without owner decision controls", () => {
    render(
      <OwnerBookingRequestNotifications
        locale="en"
        notifications={[{ ...pendingNotification, status: "processing" }]}
      />,
    );

    expect(screen.getByText("Processing", { exact: true })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Accept complete request" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Decline reason")).not.toBeInTheDocument();
  });

  it("updates the whole Owner card to one authoritative accepted state", async () => {
    actOnBookingRequest.mockResolvedValue({
      status: "accepted",
      bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
    });
    render(
      <OwnerBookingRequestNotifications
        locale="en"
        notifications={[
          {
            id: "00000000-0000-4000-8000-000000000033",
            bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
            status: "pending",
            customerName: "Ava Hassan",
            partySize: 4,
            bookingNote: null,
            cottageName: "Quiet Garden",
            bookingPeriod: [
              {
                serviceDay: "2099-08-21",
                kind: "shift",
                position: 2,
                displayName: "Evening",
                startsAt: "2099-08-21T20:00:00+03:00",
                endsAt: "2099-08-21T23:00:00+03:00",
                crossesMidnight: false,
                priceIqd: 100_003,
              },
            ],
            bookingPriceIqd: 100_003,
            marketplaceCommissionFils: 10_000_300,
            ownerNetFils: 90_002_700,
            houseRules: "No smoking",
            bookingTermsVersion: "terms-v1",
            cancellationPolicyVersion: "cancel-v1",
            statusNotifications: [],
            responseDeadline: "2099-08-21T21:00:00.000Z",
            createdAt: "2099-08-21T17:00:00.000Z",
          },
        ]}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Accept complete request" }),
    );
    await waitFor(() =>
      expect(screen.getByText("Accepted", { exact: true })).toBeInTheDocument(),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Accepted");
    expect(screen.queryByText("Pending")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Accept complete request" }),
    ).not.toBeInTheDocument();
  });

  it("restores the card and permits an accept retry after transport rejection", async () => {
    actOnBookingRequest
      .mockRejectedValueOnce(new Error("transport unavailable"))
      .mockResolvedValueOnce({
        status: "accepted",
        bookingRequestReference: pendingNotification.bookingRequestReference,
      });
    render(
      <OwnerBookingRequestNotifications
        locale="en"
        notifications={[pendingNotification]}
      />,
    );

    const accept = screen.getByRole("button", {
      name: "Accept complete request",
    });
    fireEvent.click(accept);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "could not be updated safely",
      ),
    );
    expect(screen.getByText("Pending", { exact: true })).toBeInTheDocument();
    expect(accept).toBeEnabled();

    fireEvent.click(accept);
    await waitFor(() =>
      expect(screen.getByText("Accepted", { exact: true })).toBeInTheDocument(),
    );
    expect(actOnBookingRequest).toHaveBeenCalledTimes(2);
  });

  it("restores the parent card and permits a decline retry after transport rejection", async () => {
    actOnBookingRequest
      .mockRejectedValueOnce(new Error("transport unavailable"))
      .mockResolvedValueOnce({
        status: "declined",
        bookingRequestReference: pendingNotification.bookingRequestReference,
      });
    render(
      <OwnerBookingRequestNotifications
        locale="en"
        notifications={[pendingNotification]}
      />,
    );

    fireEvent.change(screen.getByLabelText("Decline reason"), {
      target: { value: "other" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Decline complete request" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "could not be updated safely",
      ),
    );
    expect(screen.getByText("Pending", { exact: true })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Decline complete request" }),
    ).toBeEnabled();

    fireEvent.change(screen.getByLabelText("Decline reason"), {
      target: { value: "other" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Decline complete request" }),
    );
    await waitFor(() =>
      expect(screen.getByText("Declined", { exact: true })).toBeInTheDocument(),
    );
    expect(actOnBookingRequest).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      "en",
      "Review each request’s status. Respond to pending requests before the deadline. Customer contact and payment details stay private.",
    ],
    [
      "ar",
      "راجع حالة كل طلب. رد على الطلبات قيد الانتظار قبل الموعد النهائي. تبقى بيانات اتصال العميل والدفع خاصة.",
    ],
    [
      "ckb",
      "دۆخی هەر داواکارییەک بپشکنە. پێش کاتی کۆتایی وەڵامی داواکارییە چاوەڕوانەکان بدەرەوە. زانیاری پەیوەندی و پارەدانی کڕیار نهێنی دەمێنێتەوە.",
    ],
  ] as const)(
    "describes mixed request states truthfully in %s",
    (locale, introduction) => {
      render(
        <OwnerBookingRequestNotifications
          locale={locale}
          notifications={[
            pendingNotification,
            {
              ...ownerDisplayFixtures["capture-processing"],
              bookingRequestReference: "RC-REQ-BBBBBBBBBBBBBBBB",
            },
            {
              ...ownerDisplayFixtures["paid-confirmed"],
              bookingRequestReference: "RC-REQ-CCCCCCCCCCCCCCCC",
            },
          ]}
        />,
      );
      expect(screen.getByText(introduction)).toBeInTheDocument();
      const [pending, processing, confirmed] = screen.getAllByRole("article");
      expect(within(pending).getAllByRole("button")).toHaveLength(2);
      expect(within(processing).queryByRole("button")).not.toBeInTheDocument();
      expect(within(confirmed).queryByRole("button")).not.toBeInTheDocument();
    },
  );

  it.each([
    [
      "en",
      "Payment capture processing",
      "Booking confirmed",
      "The Cottage Owner accepted the request. Payment is being collected. The booking is not confirmed yet.",
      "Payment succeeded. The booking is confirmed.",
      "Respond by",
      "Booking Requests",
    ],
    [
      "ar",
      "جارٍ تحصيل الدفع",
      "تم تأكيد الحجز",
      "وافق مالك البيت على الطلب. جارٍ تحصيل الدفع. الحجز غير مؤكد بعد.",
      "نجحت عملية الدفع. تم تأكيد الحجز.",
      "الرد قبل",
      "طلبات الحجز",
    ],
    [
      "ckb",
      "پارەدان لە پرۆسەدایە",
      "حجز پشتڕاست کراوەتەوە",
      "خاوەنی کۆتێج داواکارییەکەی قبوڵ کرد. پارەدان وەردەگیرێت. حجزەکە هێشتا پشتڕاست نەکراوەتەوە.",
      "پارەدان سەرکەوتوو بوو. حجزەکە پشتڕاست کراوەتەوە.",
      "وەڵام بدەرەوە پێش",
      "داواکارییەکانی حجز",
    ],
  ] as const)(
    "renders distinct, restricted-data-safe payment states in %s",
    (
      locale,
      captureProcessing,
      paidConfirmed,
      captureDescription,
      paidDescription,
      responseDeadline,
      paymentTitle,
    ) => {
      const initial = render(
        <OwnerBookingRequestNotifications
          locale={locale}
          notifications={[ownerDisplayFixtures["capture-processing"]]}
        />,
      );

      expect(screen.getByRole("status")).toHaveTextContent(captureProcessing);
      expect(screen.getByRole("status")).toHaveTextContent(captureDescription);
      expect(
        screen.getByRole("heading", { name: paymentTitle }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      expect(screen.queryByText(responseDeadline)).not.toBeInTheDocument();
      for (const value of Object.values(restrictedBookingRequestSentinels)) {
        expect(initial.container.innerHTML).not.toContain(value);
      }

      initial.unmount();
      const confirmed = render(
        <OwnerBookingRequestNotifications
          locale={locale}
          notifications={[ownerDisplayFixtures["paid-confirmed"]]}
        />,
      );
      expect(screen.getByRole("status")).toHaveTextContent(paidConfirmed);
      expect(screen.getByRole("status")).toHaveTextContent(paidDescription);
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      expect(screen.queryByText(responseDeadline)).not.toBeInTheDocument();
      for (const value of Object.values(restrictedBookingRequestSentinels)) {
        expect(confirmed.container.innerHTML).not.toContain(value);
      }
    },
  );
});
