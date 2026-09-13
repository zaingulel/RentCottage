import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { RequestNotificationDetails } from "./request-notification-details";

vi.mock("@/notification/notification-actions", () => ({
  retryPaidConfirmationNotification: vi.fn(),
}));

it.each([
  ["en", "Delivery failed", "Retry notification"],
  ["ar", "فشل التسليم", "إعادة محاولة الإشعار"],
  ["ckb", "گەیاندن سەرکەوتوو نەبوو", "دووبارە هەوڵی ئاگادارکردنەوە"],
] as const)(
  "%s preserves failure without promising an ineligible retry",
  (locale, failed, retry) => {
    const view = (retryAllowed: boolean) => (
      <RequestNotificationDetails
        locale={locale}
        reference="RC-REQ-0000000000000228"
        delivery={{
          status: "available",
          notices: [
            {
              receiptId: null,
              eventId: "00000000-0000-4000-8000-000000000228",
              kind: "request_payment_required",
              createdAt: "2101-01-01T00:00:00Z",
              state: "retryable",
              retryAllowed,
              lastOutcome: "failed",
              supplierDeliveryReference: null,
              deliveredAt: null,
              suppressedAt: null,
              historical: false,
            },
          ],
        }}
      />
    );
    const { rerender } = render(view(true));
    expect(screen.getByText(failed, { exact: true })).toBeVisible();
    expect(screen.getByRole("button", { name: retry })).toBeVisible();
    rerender(view(false));
    expect(screen.getByText(failed, { exact: true })).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  },
);
