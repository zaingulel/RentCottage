import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OwnerBookingRequestNotifications } from "./owner-booking-request-notifications";

describe("Owner Booking Request notifications", () => {
  it("renders only the minimal customer and request details in Arabic", () => {
    render(
      <OwnerBookingRequestNotifications
        locale="ar"
        notifications={[
          {
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
  });
});
