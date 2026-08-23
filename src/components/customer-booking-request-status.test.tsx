import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { actOnBookingRequest } = vi.hoisted(() => ({
  actOnBookingRequest: vi.fn(),
}));
vi.mock("@/booking-request/lifecycle-actions", () => ({ actOnBookingRequest }));

import { CustomerBookingRequestStatus } from "./customer-booking-request-status";

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
};

describe("Customer Booking Request status", () => {
  beforeEach(() => actOnBookingRequest.mockReset());
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
});
