import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { MessagingInbox } from "./messaging-inbox";
import { MessagingModeration } from "./messaging-moderation";
import type { MessagingInboxItem } from "@/messaging/supabase-messaging-reader";

const item: MessagingInboxItem = {
  conversationId: "33333333-3333-4333-8333-333333333333",
  cottage: {
    profileId: "22222222-2222-4222-8222-222222222222",
    name: "Garden",
    publicSlug: "cottage-22222222222242228222222222222222",
  },
  actorRole: "customer",
  createdAt: "2099-08-20T12:00:00Z",
  activityAt: "2099-08-20T12:01:00Z",
  canContinueBookingRequest: false,
  messageCount: 1,
  bookingHistory: [],
  booking: {
    bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
    requestStatus: "accepted",
    paymentStatus: "paid-confirmed",
    lifecycleStatus: "confirmed",
    responseDeadline: "2099-08-21T12:00:00Z",
    firstStartsAt: null,
    lastEndsAt: null,
    writingClosesAt: null,
    writingClosed: false,
    contactAllowed: true,
  },
  preview: { originalLanguage: "ar", originalBody: "مرحبا" },
};
afterEach(cleanup);
it("renders authoritative inbox booking lifecycle", () => {
  const { rerender } = render(
    <MessagingInbox locale="en" items={[item]} nextCursor={null} />,
  );
  const states = [
    [
      "confirmed",
      "paid-confirmed",
      "Confirmed booking",
      "حجز مؤكد",
      "حجزی پشتڕاستکراو",
    ],
    [
      "completed",
      "paid-confirmed",
      "Completed booking",
      "حجز مكتمل",
      "حجزی تەواوکراو",
    ],
    ["no_show", "paid-confirmed", "No-show", "عدم الحضور", "ئامادەنەبوون"],
    [
      "cancelled",
      "capture-processing",
      "Cancelled booking",
      "حجز ملغى",
      "حجزی هەڵوەشاوە",
    ],
    [
      "incident_pending",
      "paid-confirmed",
      "Incident pending",
      "واقعة قيد المتابعة",
      "ڕووداو چاوەڕێی بەدواداچوونە",
    ],
    [
      null,
      "payment-required",
      "Payment Required",
      "الدفع مطلوب",
      "پارەدان پێویستە",
    ],
    [null, null, "Pending", "قيد الانتظار", "چاوەڕێ"],
  ] as const;
  for (const [lifecycleStatus, paymentStatus, ...labels] of states) {
    for (const [index, locale] of (["en", "ar", "ckb"] as const).entries()) {
      rerender(
        <MessagingInbox
          locale={locale}
          items={[
            {
              ...item,
              booking: {
                ...item.booking!,
                requestStatus:
                  lifecycleStatus || paymentStatus ? "accepted" : "pending",
                paymentStatus,
                lifecycleStatus,
                firstStartsAt: lifecycleStatus ? "2099-08-21T12:00:00Z" : null,
                lastEndsAt: lifecycleStatus ? "2099-08-21T15:00:00Z" : null,
                writingClosesAt: lifecycleStatus
                  ? "2099-09-20T15:00:00Z"
                  : null,
                contactAllowed: lifecycleStatus !== null,
              },
            },
          ]}
          nextCursor={null}
        />,
      );
      expect(screen.getByText(labels[index], { exact: true })).toHaveClass(
        "status-badge",
      );
    }
  }
});
it("retains the selected stay on a normal inbox card", () => {
  const query = "from=2101-01-01&guests=4&selection=2101-01-01%3Ashift%3A1";
  render(
    <MessagingInbox
      locale="en"
      items={[item]}
      nextCursor={null}
      contextQuery={query}
    />,
  );
  const link = screen.getByRole("link", { name: "Garden" });
  expect(link).toHaveAttribute(
    "href",
    `/en/messages/${item.conversationId}?${query}`,
  );
  expect(link.contains(screen.getByText("RC-REQ-AAAAAAAAAAAAAAAA"))).toBe(
    false,
  );
  expect(link.contains(screen.getByText("مرحبا"))).toBe(false);
});
it("presents confirmed lifecycle in Arabic and marks preview language", () => {
  render(<MessagingInbox locale="ar" items={[item]} nextCursor={null} />);
  expect(screen.getByText("حجز مؤكد")).toBeInTheDocument();
  expect(screen.getByText("مرحبا")).toHaveAttribute("lang", "ar");
  expect(screen.getByText("مرحبا").parentElement).toHaveClass("list-row-meta");
  expect(screen.queryByText(/accepted/)).not.toBeInTheDocument();
});
it("describes an existing empty conversation as having no messages", () => {
  render(
    <MessagingInbox
      locale="en"
      items={[{ ...item, preview: null, messageCount: 0 }]}
      nextCursor={null}
    />,
  );
  expect(screen.getByText("No messages yet.")).toBeInTheDocument();
  expect(screen.queryByText("No conversations yet.")).not.toBeInTheDocument();
});
it("localizes moderation categories and marks each body language", () => {
  render(
    <MessagingModeration
      locale="ar"
      moderation={{
        nextCursor: null,
        items: [
          {
            type: "blocked",
            attemptId: "a",
            conversationId: item.conversationId,
            category: "contact",
            actorRole: "customer",
            conversationBlockedAttemptCount: 2,
            occurredAt: item.createdAt,
          },
          {
            type: "translation-report",
            reportId: "b",
            conversationId: item.conversationId,
            category: "incorrect",
            originalLanguage: "ar",
            originalBody: "مرحبا",
            targetLanguage: "en",
            translatedBody: "Hello",
            provider: "fictional-local-test",
            model: "deterministic-pairs-v1",
            promptVersion: "message-pairs-v1",
            reportedAt: item.createdAt,
          },
        ],
      }}
    />,
  );
  expect(screen.getByText(/تفاصيل الاتصال/)).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "ترجمة غير صحيحة" }),
  ).toBeInTheDocument();
  expect(screen.getByText("مرحبا")).toHaveAttribute("lang", "ar");
  expect(screen.getByText("Hello")).toHaveAttribute("lang", "en");
});
