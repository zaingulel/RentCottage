import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { actOnBookingRequest } = vi.hoisted(() => ({
  actOnBookingRequest: vi.fn(),
}));
vi.mock("@/booking-request/lifecycle-actions", () => ({ actOnBookingRequest }));

import { OwnerBookingRequestNotifications } from "./owner-booking-request-notifications";

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
});
