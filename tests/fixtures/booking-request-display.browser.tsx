import { createRoot } from "react-dom/client";

import { CustomerBookingRequestStatus } from "@/components/customer-booking-request-status";
import { OwnerBookingRequestNotifications } from "@/components/owner-booking-request-notifications";

import {
  customerDisplayFixtures,
  customerRecoveryDisplayFixtures,
  ownerDisplayFixtures,
} from "./booking-request-display.fixtures";

const rootElement = document.getElementById("fixture-root");
if (!rootElement)
  throw new Error("Booking Request display fixture root is missing");

const root = createRoot(rootElement);

function renderBookingRequestDisplay({
  locale,
  role,
  status,
  recovery,
}: {
  locale: "en" | "ar" | "ckb";
  role: "customer" | "owner";
  recovery?: "available" | "processing" | "retryable";
  status:
    | "capture-processing"
    | "payment-required-open"
    | "payment-required-elapsed"
    | "payment-expiry-processing"
    | "payment-expiry-attention-required"
    | "payment-expiry-expired"
    | "paid-confirmed";
}) {
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === "en" ? "ltr" : "rtl";
  root.render(
    <main className="booking-request-page">
      {role === "customer" ? (
        <CustomerBookingRequestStatus
          key={`${status}:${recovery ?? "none"}`}
          locale={locale}
          request={
            recovery
              ? customerRecoveryDisplayFixtures[recovery]
              : customerDisplayFixtures[status]
          }
        />
      ) : (
        <OwnerBookingRequestNotifications
          key={`${status}:${recovery ?? "none"}`}
          locale={locale}
          notifications={[ownerDisplayFixtures[status]]}
        />
      )}
    </main>,
  );
}

window.renderBookingRequestDisplay = renderBookingRequestDisplay;
