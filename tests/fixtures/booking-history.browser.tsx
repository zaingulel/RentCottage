import { createRoot } from "react-dom/client";
import type { BookingHistoryItem } from "@/booking-request/booking-history";
import {
  ownerBookingEarnings,
  ownerBookingEarningsTotals,
  type OwnerBookingEarningsFacts,
} from "@/booking-request/owner-booking-earnings";
import { BookingHistoryList } from "@/components/booking-history-list";
import { OwnerBookingEarningsSummary } from "@/components/owner-booking-earnings";

const rootElement = document.getElementById("fixture-root");
if (!rootElement) throw new Error("Booking History fixture root is missing");
const root = createRoot(rootElement);
const statuses = [
  "pending",
  "confirmed",
  "declined",
  "expired",
  "withdrawn",
  "cancelled",
  "completed",
] as const;
const zero = { bookingPriceFils: 0, bookingServiceFeeFils: 0 };
const capturedOwnerEarnings: OwnerBookingEarningsFacts = {
  status: "captured",
  captured: {
    bookingPriceFils: 100_000_000,
    bookingServiceFeeFils: 5_000_000,
  },
  refunded: { bookingPriceFils: 20_000_000, bookingServiceFeeFils: 1_000_000 },
  reserved: zero,
  obligation: zero,
  marketplaceCommissionRateBasisPoints: 1_000,
  marketplaceCommissionAmountFils: 10_000_000,
  refunds: [
    {
      state: "succeeded",
      allocation: {
        bookingPriceFils: 20_000_000,
        bookingServiceFeeFils: 1_000_000,
      },
    },
  ],
  maturity: {
    status: "completed",
    effectivePeriodEnd: "2101-01-01T12:00:00Z",
    assessedAt: "2101-01-01T12:00:01Z",
    reviewExpiresAt: "2101-01-15T12:00:00Z",
    reviewAvailable: true,
    payoutPrerequisiteAt: "2101-01-01T12:00:00Z",
    payoutPrerequisiteAvailable: true,
  },
  administratorHoldActive: false,
  disputes: [],
  settlement: null,
  recovery: { status: "unsettled" },
};
const refundedOwnerEarnings: OwnerBookingEarningsFacts = {
  ...capturedOwnerEarnings,
  refunded: capturedOwnerEarnings.captured,
  obligation: capturedOwnerEarnings.captured,
  refunds: [
    {
      state: "succeeded",
      allocation: capturedOwnerEarnings.captured,
    },
  ],
};

window.renderBookingHistory = ({ locale, role }) => {
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === "en" ? "ltr" : "rtl";
  const items: BookingHistoryItem[] = statuses.map((status, index) => ({
    bookingRequestId: `60000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    bookingRequestReference: `RC-REQ-${String(index + 1).padStart(16, "0")}`,
    bookingReference:
      status === "pending" ||
      status === "declined" ||
      status === "expired" ||
      status === "withdrawn"
        ? null
        : `BOOKING-${index + 1}`,
    ...(status === "pending" ||
    status === "declined" ||
    status === "expired" ||
    status === "withdrawn"
      ? {}
      : {
          receiptId: `82000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          confirmedAt: "2100-12-31T13:00:00Z",
        }),
    cottageName: `Preserved Cottage ${index + 1}`,
    createdAt: "2100-12-30T13:00:00Z",
    firstStartsAt: `2101-01-0${index + 1}T05:00:00Z`,
    lastEndsAt: `2101-01-0${index + 1}T09:00:00Z`,
    status,
    actorRole: role,
    ...(role === "cottage_owner"
      ? {
          ownerEarnings:
            status === "confirmed" || status === "completed"
              ? capturedOwnerEarnings
              : status === "cancelled"
                ? refundedOwnerEarnings
                : ({ status: "not-captured" } as const),
        }
      : {}),
  }));
  const totals = ownerBookingEarningsTotals(
    items
      .filter((item) => item.actorRole === "cottage_owner")
      .map((item) =>
        ownerBookingEarnings(item.ownerEarnings ?? { status: "unavailable" }),
      ),
  );
  root.render(
    <>
      {role === "cottage_owner" ? (
        <OwnerBookingEarningsSummary locale={locale} totals={totals} />
      ) : null}
      <BookingHistoryList items={items} locale={locale} />
    </>,
  );
};

declare global {
  interface Window {
    renderBookingHistory(input: {
      locale: "en" | "ar" | "ckb";
      role: "customer" | "cottage_owner";
    }): void;
  }
}
