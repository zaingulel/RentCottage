import { render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import type { BookingHistoryItem } from "@/booking-request/booking-history";
import { BookingHistoryList } from "./booking-history-list";

const item: BookingHistoryItem = {
  bookingRequestId: "60000000-0000-4000-8000-000000003501",
  bookingRequestReference: "RC-REQ-0000000000003501",
  bookingReference: null,
  cottageName: "Preserved Cottage",
  createdAt: "2100-12-30T13:00:00Z",
  firstStartsAt: "2101-01-01T05:00:00Z",
  lastEndsAt: "2101-01-01T09:00:00Z",
  actorRole: "cottage_owner",
  status: "pending",
  ownerEarnings: { status: "not-captured" },
};

it("adds the shared earnings presentation only to owner booking cards", () => {
  const { rerender } = render(
    <BookingHistoryList locale="en" items={[item]} />,
  );
  expect(
    screen.getByRole("region", { name: "Earnings and payout" }),
  ).toHaveTextContent(
    "Payment has not been collected for this request, so it has no earnings yet.",
  );
  expect(
    screen.getByRole("link", { name: /Preserved Cottage/ }),
  ).toHaveAttribute(
    "href",
    "/en/owner/booking-requests/RC-REQ-0000000000003501",
  );

  rerender(
    <BookingHistoryList
      locale="en"
      items={[{ ...item, actorRole: "customer", ownerEarnings: undefined }]}
    />,
  );
  expect(
    screen.queryByRole("region", { name: "Earnings and payout" }),
  ).toBeNull();
});

it("names a row's one link by the cottage alone and keeps the reference, status and date outside it", () => {
  render(
    <BookingHistoryList
      locale="en"
      items={[{ ...item, actorRole: "customer", ownerEarnings: undefined }]}
    />,
  );
  const row = screen.getByRole("listitem");
  expect(within(row).getAllByRole("link")).toHaveLength(1);
  const link = within(row).getByRole("link", { name: "Preserved Cottage" });
  expect(link).not.toHaveTextContent("RC-REQ-0000000000003501");
  expect(row).toHaveTextContent("RC-REQ-0000000000003501");
  expect(within(row).getByText("Pending")).toHaveClass("status-badge");
  expect(row.querySelector("time")).toHaveAttribute(
    "datetime",
    "2101-01-01T05:00:00Z",
  );
});
