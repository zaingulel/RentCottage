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

it.each(["en", "ar", "ckb"] as const)(
  "%s keeps six delivery states distinct with one retry and no receipt field",
  (locale) => {
    const states = [
      "pending",
      "processing",
      "retryable",
      "uncertain",
      "delivered",
      "suppressed",
    ] as const;
    const { container } = render(
      <RequestNotificationDetails
        locale={locale}
        reference="RC-REQ-0000000000000482"
        delivery={{
          status: "available",
          notices: states.map((state, index) => ({
            receiptId: null,
            eventId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
            kind: "request_accepted",
            createdAt: "2101-01-01T08:00:00Z",
            state,
            retryAllowed: state === "retryable",
            lastOutcome:
              state === "retryable"
                ? "failed"
                : state === "uncertain"
                  ? "unknown"
                  : state === "delivered"
                    ? "delivered"
                    : state === "suppressed"
                      ? "suppressed"
                      : null,
            supplierDeliveryReference:
              state === "delivered" ? "fictional" : null,
            deliveredAt: state === "delivered" ? "2101-01-01T08:00:01Z" : null,
            suppressedAt:
              state === "suppressed" ? "2101-01-01T08:00:01Z" : null,
            historical: false,
          })),
        }}
      />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(container.querySelector('input[name="receiptId"]')).toBeNull();
    if (locale === "en")
      for (const label of [
        "Queued",
        "Delivery processing",
        "Delivery failed",
        "Delivery outcome uncertain; checking",
        "Delivered",
        "Delivery withheld because this notice is no longer eligible",
      ])
        expect(screen.getByText(label, { exact: true })).toBeVisible();
  },
);

it.each(["en", "ar", "ckb"] as const)(
  "%s reports an unavailable delivery status without listing notices",
  (locale) => {
    render(
      <RequestNotificationDetails
        locale={locale}
        reference="RC-REQ-0000000000000482"
        delivery={{ status: "unavailable" }}
      />,
    );
    expect(screen.getByRole("status")).toBeVisible();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  },
);

it.each([
  ["en", "Request notification delivery"],
  ["ar", "تسليم إشعارات الطلب"],
  ["ckb", "گەیاندنی ئاگادارکردنەوەی داواکاری"],
] as const)(
  "%s shows no delivery heading when an available delivery has no notices",
  (locale, title) => {
    render(
      <RequestNotificationDetails
        locale={locale}
        reference="RC-REQ-0000000000000553"
        delivery={{ status: "available", notices: [] }}
      />,
    );
    expect(
      screen.queryByRole("region", { name: title }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  },
);
