import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { actOnBookingRequest, recoverBookingRequestPayment, refresh } =
  vi.hoisted(() => ({
    actOnBookingRequest: vi.fn(),
    recoverBookingRequestPayment: vi.fn(),
    refresh: vi.fn(),
  }));
vi.mock("@/booking-request/lifecycle-actions", () => ({ actOnBookingRequest }));
vi.mock("@/booking-request/payment-recovery-actions", () => ({
  recoverBookingRequestPayment,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { CustomerBookingRequestStatus } from "./customer-booking-request-status";
import {
  customerDisplayFixtures,
  restrictedBookingRequestSentinels,
} from "../../tests/fixtures/booking-request-display.fixtures";

const request = {
  id: "00000000-0000-4000-8000-000000000033",
  bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
  status: "pending" as const,
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
  partySize: 4,
  bookingPriceIqd: 100_003,
  serviceFeeIqd: 5_000,
  customerTotalIqd: 105_003,
  responseDeadline: "2099-08-21T21:00:00.000Z",
  declineReason: null,
  declineNote: null,
  statusNotifications: [],
  paymentRequiredWindow: null,
  paymentRequiredExpiry: null,
};

describe("Customer Booking Request status", () => {
  beforeEach(() => {
    actOnBookingRequest.mockReset();
    refresh.mockClear();
  });
  afterEach(() => vi.useRealTimers());
  it("shows the open and elapsed Payment Required state with the fixed Iraq deadline", () => {
    vi.useFakeTimers();
    const view = render(
      <CustomerBookingRequestStatus
        locale="en"
        request={customerDisplayFixtures["payment-required-open"]}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Automatic payment failed",
    );
    expect(screen.getByRole("status")).toHaveTextContent("not confirmed");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Your selected Cottage Shifts remain held.",
    );
    expect(screen.getByText("Payment deadline").nextSibling).toHaveTextContent(
      "12:20",
    );
    expect(vi.getTimerCount()).toBe(1);
    view.rerender(
      <CustomerBookingRequestStatus
        locale="en"
        request={customerDisplayFixtures["payment-required-elapsed"]}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "payment deadline has passed",
    );
    expect(screen.getByRole("status")).toHaveTextContent("remain held");
    expect(vi.getTimerCount()).toBe(1);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("replaces mounted pending and processing state with authoritative confirmation", () => {
    const view = render(
      <CustomerBookingRequestStatus locale="en" request={request} />,
    );
    view.rerender(
      <CustomerBookingRequestStatus
        locale="en"
        request={{ ...request, status: "capture-processing" }}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Payment confirmation pending",
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    view.rerender(
      <CustomerBookingRequestStatus
        locale="en"
        request={{ ...request, status: "paid-confirmed" }}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Booking confirmed");
  });
  it("keeps pending customers current and stops refresh on confirmation and unmount", () => {
    vi.useFakeTimers();
    const view = render(
      <CustomerBookingRequestStatus locale="en" request={request} />,
    );
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersToNextTimer();
    expect(refresh).toHaveBeenCalledOnce();
    view.rerender(
      <CustomerBookingRequestStatus
        locale="en"
        request={{ ...request, status: "paid-confirmed" }}
      />,
    );
    expect(vi.getTimerCount()).toBe(0);
    view.rerender(
      <CustomerBookingRequestStatus
        locale="en"
        request={{ ...request, status: "capture-processing" }}
      />,
    );
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("shows a contact-safe processing state while authoritative withdrawal settles", async () => {
    let finish!: (value: {
      status: "withdrawn";
      bookingRequestReference: string;
    }) => void;
    actOnBookingRequest.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<CustomerBookingRequestStatus locale="en" request={request} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Withdraw pending request" }),
    );
    expect(screen.getByText("Processing", { exact: true })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Processing");
    expect(screen.getByText(/being released/)).toBeInTheDocument();
    finish({
      status: "withdrawn",
      bookingRequestReference: request.bookingRequestReference,
    });
    await waitFor(() =>
      expect(
        screen.getByText("Withdrawn", { exact: true }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Withdrawn");
    expect(
      screen.queryByText("pending", { exact: true }),
    ).not.toBeInTheDocument();
  });

  it("restores pending state and permits withdrawal retry after transport rejection", async () => {
    actOnBookingRequest
      .mockRejectedValueOnce(new Error("transport unavailable"))
      .mockResolvedValueOnce({
        status: "withdrawn",
        bookingRequestReference: request.bookingRequestReference,
      });
    render(<CustomerBookingRequestStatus locale="en" request={request} />);

    const withdraw = screen.getByRole("button", {
      name: "Withdraw pending request",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Withdraw pending request" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "could not be updated safely",
      ),
    );
    expect(screen.getByText("Pending", { exact: true })).toBeInTheDocument();
    expect(withdraw).toBeEnabled();

    fireEvent.click(
      screen.getByRole("button", { name: "Withdraw pending request" }),
    );
    await waitFor(() =>
      expect(
        screen.getByText("Withdrawn", { exact: true }),
      ).toBeInTheDocument(),
    );
    expect(actOnBookingRequest).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      "en",
      "Payment confirmation pending",
      "Booking confirmed",
      "The Cottage Owner accepted the request. Payment confirmation is pending. The booking is not confirmed yet.",
      "Payment succeeded. The booking is confirmed.",
      "Owner response deadline",
    ],
    [
      "ar",
      "بانتظار تأكيد الدفع",
      "تم تأكيد الحجز",
      "وافق مالك البيت على الطلب. بانتظار تأكيد الدفع. الحجز غير مؤكد بعد.",
      "نجحت عملية الدفع. تم تأكيد الحجز.",
      "موعد رد المالك",
    ],
    [
      "ckb",
      "چاوەڕێی پشتڕاستکردنەوەی پارەدان",
      "حجز پشتڕاست کراوەتەوە",
      "خاوەنی کۆتێج داواکارییەکەی قبوڵ کرد. چاوەڕێی پشتڕاستکردنەوەی پارەدانین. حجزەکە هێشتا پشتڕاست نەکراوەتەوە.",
      "پارەدان سەرکەوتوو بوو. حجزەکە پشتڕاست کراوەتەوە.",
      "کاتی کۆتایی وەڵامی خاوەن",
    ],
  ] as const)(
    "renders distinct, contact-safe payment states in %s",
    (
      locale,
      captureProcessing,
      paidConfirmed,
      captureDescription,
      paidDescription,
      responseDeadline,
    ) => {
      const initial = render(
        <CustomerBookingRequestStatus
          locale={locale}
          request={customerDisplayFixtures["capture-processing"]}
        />,
      );

      expect(screen.getByRole("status")).toHaveTextContent(captureProcessing);
      expect(screen.getByRole("status")).toHaveTextContent(captureDescription);
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      expect(screen.queryByText(responseDeadline)).not.toBeInTheDocument();
      for (const value of Object.values(restrictedBookingRequestSentinels)) {
        expect(initial.container.innerHTML).not.toContain(value);
      }

      initial.unmount();
      const confirmed = render(
        <CustomerBookingRequestStatus
          locale={locale}
          request={customerDisplayFixtures["paid-confirmed"]}
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

it("offers recovery only for a database-admitted open window", () => {
  render(
    <CustomerBookingRequestStatus
      locale="en"
      request={{
        ...customerDisplayFixtures["payment-required-elapsed"],
        paymentRecovery: { status: "retryable" },
      }}
    />,
  );
  expect(
    screen.queryByRole("button", {
      name: "Retry simulated replacement payment",
    }),
  ).not.toBeInTheDocument();
});
it("refreshes unresolved recovery into its persisted blocked state without inventing confirmation", async () => {
  recoverBookingRequestPayment.mockResolvedValue({ status: "blocked" });
  render(
    <CustomerBookingRequestStatus
      locale="en"
      request={{
        ...customerDisplayFixtures["payment-required-open"],
        paymentRecovery: { status: "available" },
      }}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Use simulated replacement payment" }),
  );
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(screen.queryByText("Booking confirmed")).not.toBeInTheDocument();
});

describe("Customer payment recovery command identity", () => {
  beforeEach(() => {
    recoverBookingRequestPayment.mockReset();
    refresh.mockClear();
  });
  const retryableRequest = {
    ...customerDisplayFixtures["payment-required-open"],
    paymentRecovery: { status: "retryable" as const },
  };

  it("starts a fresh command after each definitive retryable outcome even when the persisted display stays retryable", async () => {
    recoverBookingRequestPayment
      .mockResolvedValueOnce({ status: "retryable" })
      .mockResolvedValueOnce({ status: "retryable" })
      .mockResolvedValueOnce({ status: "succeeded" });
    const view = render(
      <CustomerBookingRequestStatus locale="en" request={retryableRequest} />,
    );
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const button = screen.getByRole("button", {
        name: "Retry simulated replacement payment",
      });
      fireEvent.click(button);
      await waitFor(() => expect(button).toBeEnabled());
      expect(refresh).toHaveBeenCalledTimes(attempt);
      view.rerender(
        <CustomerBookingRequestStatus locale="en" request={retryableRequest} />,
      );
    }
    const keys = recoverBookingRequestPayment.mock.calls.map(
      ([input]) => input.commandKey,
    );
    expect(new Set(keys).size).toBe(3);
    view.rerender(
      <CustomerBookingRequestStatus
        locale="en"
        request={customerDisplayFixtures["paid-confirmed"]}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Booking confirmed");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it.each(["transport", "blocked", "processing", "unavailable"] as const)(
    "keeps the same command after an uncertain %s outcome",
    async (outcome) => {
      if (outcome === "transport")
        recoverBookingRequestPayment.mockRejectedValueOnce(
          new Error("response lost"),
        );
      else
        recoverBookingRequestPayment.mockResolvedValueOnce({ status: outcome });
      recoverBookingRequestPayment.mockResolvedValueOnce({ status: "blocked" });
      render(
        <CustomerBookingRequestStatus locale="en" request={retryableRequest} />,
      );
      const button = screen.getByRole("button", {
        name: "Retry simulated replacement payment",
      });
      fireEvent.click(button);
      await waitFor(() => expect(button).toBeEnabled());
      fireEvent.click(button);
      await waitFor(() => expect(button).toBeEnabled());
      expect(recoverBookingRequestPayment).toHaveBeenCalledTimes(2);
      expect(recoverBookingRequestPayment.mock.calls[1][0].commandKey).toBe(
        recoverBookingRequestPayment.mock.calls[0][0].commandKey,
      );
      expect(screen.queryByText("Booking confirmed")).not.toBeInTheDocument();
    },
  );
});

it("keeps elapsed and attention states held and refreshing until one unpaid-expiry notice arrives", () => {
  vi.useFakeTimers();
  try {
    let fixture: (typeof customerDisplayFixtures)[
      | "payment-expiry-processing"
      | "payment-expiry-attention-required"] =
      customerDisplayFixtures["payment-expiry-processing"];
    const view = render(
      <CustomerBookingRequestStatus locale="en" request={fixture} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("remain held");
    vi.advanceTimersToNextTimer();
    expect(refresh).toHaveBeenCalled();
    fixture = customerDisplayFixtures["payment-expiry-attention-required"];
    view.rerender(
      <CustomerBookingRequestStatus locale="en" request={fixture} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "could not yet be verified",
    );
    expect(screen.getByRole("status")).toHaveTextContent("not confirmed");
    expect(screen.getByRole("status")).toHaveTextContent("remain held");
    expect(screen.getByRole("status")).not.toHaveTextContent("released");
    refresh.mockClear();
    vi.advanceTimersToNextTimer();
    expect(refresh).toHaveBeenCalledOnce();
    const completed = customerDisplayFixtures["payment-expiry-expired"];
    view.rerender(
      <CustomerBookingRequestStatus locale="en" request={completed} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Expired unpaid");
    expect(screen.getByRole("status")).toHaveTextContent(
      "authorisations have been released",
    );
    expect(screen.getByRole("status")).toHaveTextContent("not confirmed");
    expect(screen.getByText("Payment deadline").nextSibling).toHaveTextContent(
      "12:20",
    );
    expect(
      screen.queryByText("Owner response deadline"),
    ).not.toBeInTheDocument();
    expect(
      Array.from(view.container.querySelectorAll("dd")).filter((item) =>
        item.textContent?.includes("Expired unpaid"),
      ),
    ).toHaveLength(1);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
    view.unmount();
  } finally {
    vi.useRealTimers();
  }
});

it.each([
  ["payment-correction-refunding", "Payment is being returned", "remain held"],
  [
    "payment-correction-quarantined",
    "Payment needs review",
    "Please do not pay again",
  ],
  [
    "payment-correction-expired",
    "Expired — payment returned",
    "full payment has been returned",
  ],
  [
    "payment-correction-released-review",
    "Payment needs review",
    "were already released",
  ],
] as const)(
  "shows honest correction state %s and no payment retry",
  (fixture, label, description) => {
    render(
      <CustomerBookingRequestStatus
        locale="en"
        request={customerDisplayFixtures[fixture]}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(label);
    expect(screen.getByRole("status")).toHaveTextContent(description);
    expect(screen.getByRole("status")).toHaveTextContent("not confirmed");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  },
);

it("keeps a quarantined open payment window free of retry controls", () => {
  render(
    <CustomerBookingRequestStatus
      locale="en"
      request={{
        ...customerDisplayFixtures["payment-correction-quarantined"],
        paymentRequiredWindow: {
          recordedAt: "2099-08-21T09:00:00.000Z",
          deadline: "2099-08-21T09:20:00.000Z",
          phase: "open",
        },
        paymentRecovery: { status: "available" },
      }}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent("Payment needs review");
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
