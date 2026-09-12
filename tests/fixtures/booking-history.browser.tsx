import { createRoot } from "react-dom/client";
import type { BookingHistoryItem } from "@/booking-request/booking-history";
import { BookingHistoryList } from "@/components/booking-history-list";

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
  }));
  root.render(<BookingHistoryList items={items} locale={locale} />);
};

declare global {
  interface Window {
    renderBookingHistory(input: {
      locale: "en" | "ar" | "ckb";
      role: "customer" | "cottage_owner";
    }): void;
  }
}
