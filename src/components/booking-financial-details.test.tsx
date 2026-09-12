import { render, screen, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
vi.mock("@/booking-request/booking-management-actions", () => ({
  manageConfirmedBooking: vi.fn(),
}));
vi.mock("@/notification/notification-actions", () => ({
  retryPaidConfirmationNotification: vi.fn(),
}));
import { BookingFinancialDetails } from "./booking-financial-details";
import type { BookingFinancialView } from "@/booking-request/booking-financial-view";
const zero = { bookingPriceFils: 0, bookingServiceFeeFils: 0 };
const financial: BookingFinancialView = {
  bookingRequestId: "60000000-0000-4000-8000-000000001001",
  bookingRequestReference: "RC-REQ-0000000000001001",
  bookingReference: "BOOKING-38",
  actorRole: "cottage_owner",
  cottageName: "Preserved Cottage",
  firstStartsAt: "2101-01-01T05:00:00Z",
  bookingTermsBody: "Original accepted terms",
  captured: { bookingPriceFils: 100000000, bookingServiceFeeFils: 5000000 },
  refunded: zero,
  reserved: { bookingPriceFils: 20000000, bookingServiceFeeFils: 0 },
  lifecycle: {
    bookingRequestId: "60000000-0000-4000-8000-000000001001",
    status: "confirmed",
  },
  eligibility: {
    status: "unavailable",
    reviewAvailable: false,
    payoutPrerequisiteAvailable: false,
  },
  cancellation: null,
  refunds: [
    {
      id: "90000000-0000-4000-8000-000000003853",
      occurredAt: "2100-12-01T12:00:00Z",
      source: "administrator",
      state: "requested",
      allocation: { bookingPriceFils: 20000000, bookingServiceFeeFils: 0 },
    },
  ],
  notifications: [],
};
describe("retained cancellation and refund details", () => {
  it("keeps pending approval distinct from actual returned money and owner share", () => {
    render(<BookingFinancialDetails locale="en" view={financial} />);
    expect(
      within(screen.getByTestId("owner-after-completed")).getByText(
        "IQD 90,000",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("A refund is pending; this amount may change."),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("verified-refund")).getAllByText("IQD 0"),
    ).toHaveLength(3);
    expect(screen.getByText("Refund approved")).toBeInTheDocument();
  });
  it("shows completed allocation and reduced owner share", () => {
    render(
      <BookingFinancialDetails
        locale="en"
        view={{
          ...financial,
          refunded: financial.refunds[0].allocation,
          reserved: zero,
          refunds: [{ ...financial.refunds[0], state: "succeeded" }],
        }}
      />,
    );
    expect(
      within(screen.getByTestId("owner-after-completed")).getByText(
        "IQD 72,000",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("A refund is pending; this amount may change."),
    ).not.toBeInTheDocument();
  });
  it.each([
    ["en", "Cancelled booking", "Full refund required"],
    ["ar", "حجز ملغى", "استرداد كامل مطلوب"],
    ["ckb", "حجزی هەڵوەشاوە", "گەڕاندنەوەی تەواوی پارە پێویستە"],
  ] as const)(
    "retains a full cancellation and failed refund without implying any returned funds in %s",
    (locale, title, required) => {
      render(
        <BookingFinancialDetails
          locale={locale}
          view={{
            ...financial,
            cancellation: {
              occurredAt: "2100-12-02T12:00:00Z",
              obligation: financial.captured,
            },
            refunds: [{ ...financial.refunds[0], state: "failed" }],
          }}
        />,
      );
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: required }),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("owner-after-completed"),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    },
  );
  it("never renders audit identities or private fields for a customer", () => {
    const view = {
      ...financial,
      actorRole: "customer" as const,
      cancellation: { occurredAt: "2100-12-02T12:00:00Z", obligation: zero },
      exactAddress: "PRIVATE address",
      audit: {
        cancellation: {
          reason: "PRIVATE reason",
          category: "safety",
          actorUserId: "PRIVATE identity",
          actorRole: "platform_administrator" as const,
        },
        refunds: [],
      },
    };
    render(<BookingFinancialDetails locale="en" view={view} />);
    expect(screen.queryByText(/PRIVATE/)).not.toBeInTheDocument();
    expect(
      screen.queryByText("No owner payout for this cancelled booking"),
    ).not.toBeInTheDocument();
  });
  it("shows failed and replacement approvals individually without summing historical requests into debt", () => {
    render(
      <BookingFinancialDetails
        locale="en"
        view={{
          ...financial,
          refunds: [
            { ...financial.refunds[0], state: "failed" },
            {
              ...financial.refunds[0],
              id: "90000000-0000-4000-8000-000000003854",
              allocation: financial.captured,
            },
          ],
          cancellation: {
            occurredAt: "2100-12-02T12:00:00Z",
            obligation: financial.captured,
          },
        }}
      />,
    );
    expect(screen.getAllByText("Refund approved")).toHaveLength(2);
    expect(screen.queryByText("IQD 125,000")).not.toBeInTheDocument();
    expect(
      screen.getByText("No owner payout for this cancelled booking"),
    ).toBeInTheDocument();
  });
  it("replaces cancellation controls with the completed lifecycle while preserving financial history", () => {
    render(
      <BookingFinancialDetails
        locale="en"
        view={{
          ...financial,
          lifecycle: { ...financial.lifecycle, status: "completed" },
        }}
      />,
    );
    expect(
      screen.getByRole("region", { name: "Booking lifecycle" }),
    ).toHaveTextContent("Completed booking");
    expect(
      screen.queryByRole("form", { name: "Cancel booking" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("verified-refund")).toBeInTheDocument();
  });
  it.each([
    [
      "en",
      "Recipient: Customer",
      "Delivery failed",
      "Recipient: Cottage Owner",
      "Delivered",
    ],
    [
      "ar",
      "المستلم: العميل",
      "فشل التسليم",
      "المستلم: مالك الكوخ",
      "تم التسليم",
    ],
    [
      "ckb",
      "وەرگر: کڕیار",
      "گەیاندن سەرکەوتوو نەبوو",
      "وەرگر: خاوەنی کۆخ",
      "گەیەنرا",
    ],
  ] as const)(
    "identifies each reminder recipient and actual state in %s",
    (locale, customerLabel, customerState, ownerLabel, ownerState) => {
      render(
        <BookingFinancialDetails
          locale={locale}
          view={{
            ...financial,
            actorRole: "platform_administrator",
            notifications: [
              {
                eventId: "90000000-0000-4000-8000-000000001001",
                receiptId: "82000000-0000-4000-8000-000000001001",
                kind: "preparation_reminder",
                dueAt: "2100-12-31T05:00:00Z",
                recipientRole: "customer",
                state: "retryable",
                outcome: "failed",
                retryAllowed: false,
              },
              {
                eventId: "90000000-0000-4000-8000-000000001002",
                receiptId: "82000000-0000-4000-8000-000000001002",
                kind: "preparation_reminder",
                dueAt: "2100-12-31T05:00:00Z",
                recipientRole: "cottage_owner",
                state: "delivered",
                outcome: "delivered",
                retryAllowed: false,
              },
            ],
          }}
        />,
      );
      const customerNotice = screen.getByText(customerLabel).closest("li");
      const ownerNotice = screen.getByText(ownerLabel).closest("li");
      expect(customerNotice).toHaveTextContent(customerState);
      expect(ownerNotice).toHaveTextContent(ownerState);
    },
  );
});

describe("administrator payout investigation", () => {
  const hold = "90000000-0000-4000-8000-000000002270",
    dispute = "90000000-0000-4000-8000-000000002271";
  const payout = {
    revision: "a".repeat(32),
    recovery: { status: "unsettled" as const },
    maturity: financial.eligibility,
    intents: [],
    settlement: null,
    bookingRequestId: financial.bookingRequestId,
    captured: financial.captured,
    refunded: zero,
    reserved: zero,
    commands: [
      {
        commandId: hold,
        action: "place_hold" as const,
        subjectId: null,
        outcome: null,
        allocation: null,
        actorUserId: "10000000-0000-4000-8000-000000003801",
        reason: "Independent risk review",
        occurredAt: "2026-09-12T12:00:00Z",
      },
    ],
    activeHoldIds: [hold],
    activeDisputeIds: [dispute],
    disputes: [
      {
        id: dispute,
        resolutionId: null,
        refundIntentId: null,
        state: "open" as const,
      },
    ],
  };
  it("shows verified recovery amounts and the explicit absence of an owner debit to administrators", () => {
    render(
      <BookingFinancialDetails
        locale="en"
        view={{
          ...financial,
          actorRole: "platform_administrator",
          payout: {
            ...payout,
            recovery: {
              status: "paid",
              ownerEntitlementFils: 81000000,
              paidFils: 90000000,
              paidWhileBlocked: true,
              recoveryExposureFils: 90000000,
              recoveryBalanceFils: 9000000,
              automaticOwnerDebitFils: 0,
            },
          },
        }}
      />,
    );
    const recovery = screen.getByTestId("settlement-recovery");
    expect(recovery).toHaveTextContent("Current recovery balance: IQD 9,000");
    expect(recovery).toHaveTextContent(
      "Recorded recovery exposure: IQD 90,000",
    );
    expect(recovery).toHaveTextContent(
      "No automatic owner debit has been made.",
    );
    expect(recovery).toHaveTextContent(
      "Settlement was verified while a payout hold or dispute was active.",
    );
  });
  it("shows missing recovery context as unavailable without a zero amount", () => {
    render(
      <BookingFinancialDetails
        locale="en"
        view={{
          ...financial,
          actorRole: "platform_administrator",
          payout: { ...payout, recovery: { status: "unavailable" } },
        }}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Settlement recovery evidence is incomplete",
    );
    expect(screen.queryByTestId("settlement-recovery")).not.toBeInTheDocument();
  });
  it("exposes independent hold release and dispute resolution on the existing administrator detail", () => {
    render(
      <BookingFinancialDetails
        locale="en"
        view={{ ...financial, actorRole: "platform_administrator", payout }}
      />,
    );
    const section = within(
      screen.getByRole("region", { name: "Payout holds and disputes" }),
    );
    expect(section.getByText("Administrator hold active")).toBeInTheDocument();
    expect(
      section.getByRole("button", { name: "Release administrator hold" }),
    ).toBeInTheDocument();
    expect(
      section.getByRole("button", { name: "Resolve payment dispute" }),
    ).toBeInTheDocument();
    expect(
      section.queryByRole("button", { name: "Place administrator hold" }),
    ).not.toBeInTheDocument();
    expect(
      section.queryByRole("button", { name: "Open payment dispute" }),
    ).not.toBeInTheDocument();
    expect(section.getByText("Independent risk review")).toBeInTheDocument();
  });
  it.each(["customer", "cottage_owner"] as const)(
    "never renders private payout reasons or commands for %s",
    (actorRole) => {
      render(
        <BookingFinancialDetails
          locale="en"
          view={{ ...financial, actorRole, payout }}
        />,
      );
      expect(
        screen.queryByText("Independent risk review"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("region", { name: "Payout holds and disputes" }),
      ).not.toBeInTheDocument();
    },
  );
  it.each([
    ["ar", "تعليق مستحقات المالك ونزاعات الدفع", "رفع التعليق الإداري"],
    [
      "ckb",
      "ڕاگرتنی پارەی خاوەن و ناکۆکیی پارەدان",
      "لابردنی ڕاگرتنی بەڕێوەبەر",
    ],
  ] as const)(
    "localizes administrator controls in %s",
    (locale, title, release) => {
      render(
        <BookingFinancialDetails
          locale={locale}
          view={{ ...financial, actorRole: "platform_administrator", payout }}
        />,
      );
      expect(
        within(screen.getByRole("region", { name: title })).getByRole(
          "button",
          { name: release },
        ),
      ).toBeInTheDocument();
    },
  );
});
