import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
vi.mock("@/booking-request/booking-management-actions", () => ({
  manageConfirmedBooking: vi.fn(),
}));
import { BookingLifecycleDetails } from "./booking-lifecycle-details";
import { bookingLifecycleMessages as messages } from "@/i18n/booking-lifecycle-messages";
const request = "60000000-0000-4000-8000-000000001001";
const props = {
  reference: "RC-REQ-0000000000001001",
  bookingReference: "BOOKING-39",
  lifecycle: { bookingRequestId: request, status: "completed" as const },
  eligibility: {
    status: "unavailable" as const,
    reviewAvailable: false as const,
    payoutPrerequisiteAvailable: false as const,
  },
};
describe("lifecycle status and restricted controls", () => {
  it.each(["en", "ar", "ckb"] as const)(
    "shows durable completion in %s",
    (locale) => {
      render(
        <BookingLifecycleDetails
          {...props}
          locale={locale}
          actorRole="customer"
        />,
      );
      expect(
        screen.getByRole("heading", { name: messages[locale].completed }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("form")).not.toBeInTheDocument();
    },
  );
  it("hides incident details even if incorrectly supplied to a participant component", () => {
    render(
      <BookingLifecycleDetails
        {...props}
        locale="en"
        actorRole="customer"
        lifecycle={{
          ...props.lifecycle,
          incidents: [
            {
              id: "incident",
              source: "lifecycle",
              category: "safety",
              narrative: "PRIVATE incident",
              actorUserId: "PRIVATE actor",
              actorRole: "platform_administrator",
              recordedAt: "2026-09-12T01:00:00Z",
            },
          ],
        }}
      />,
    );
    expect(screen.queryByText(/PRIVATE/)).not.toBeInTheDocument();
  });
  it("lets the owner report an incident without administrator no-show controls", () => {
    render(
      <BookingLifecycleDetails
        {...props}
        locale="en"
        actorRole="cottage_owner"
      />,
    );
    expect(
      screen.getByRole("form", { name: messages.en.report }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("form", { name: messages.en.markNoShow }),
    ).not.toBeInTheDocument();
  });
  it("shows administrator incident source and attribution separately from the payment timeline", () => {
    render(
      <BookingLifecycleDetails
        {...props}
        locale="en"
        actorRole="platform_administrator"
        lifecycle={{
          ...props.lifecycle,
          incidents: [
            {
              id: "incident",
              source: "cancellation",
              cancellationId: "original",
              category: "safety",
              narrative: "PRIVATE reason",
              actorUserId: "recorded-administrator",
              actorRole: "platform_administrator",
              recordedAt: "2026-09-12T01:00:00Z",
            },
          ],
          noShow: null,
        }}
      />,
    );
    expect(
      screen.getByRole("region", { name: messages.en.incidents }),
    ).toHaveTextContent("PRIVATE reason");
    expect(
      screen.getByText(messages.en.cancellationSource),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("form", { name: messages.en.markNoShow }),
    ).not.toBeInTheDocument();
  });
});
