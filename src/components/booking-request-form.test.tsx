import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { submitBookingRequest } = vi.hoisted(() => ({
  submitBookingRequest: vi.fn(),
}));

vi.mock("@/booking-request/actions", () => ({ submitBookingRequest }));

import type { PublicBookingQuote } from "@/booking-quote/booking-quote";
import { bookingQuoteMessages } from "@/i18n/booking-quote-messages";
import { bookingRequestMessages } from "@/i18n/booking-request-messages";
import {
  bookingRequestAcceptanceEvidence,
  type BookingRequestUiPolicy,
} from "@/booking-request/booking-request-policy";
import type { Locale } from "@/i18n/routing";
import { BookingRequestForm } from "./booking-request-form";
import { bookingTermsFixture } from "@/booking-request/booking-terms-fixture";

const quote: PublicBookingQuote = {
  slug: "cottage-00000000000040008000000000000029",
  quoteFingerprint: "a".repeat(64),
  cottageName: "Quiet Garden",
  contentVersion: 2,
  houseRules: "No smoking",
  termsVersion: "fictional-local-test-2026-08-22-v1",
  marketplaceTerms: bookingTermsFixture("en"),
  items: [
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
  bookingPriceIqd: 100_003,
  serviceFeeIqd: 5_000,
  customerTotalIqd: 105_003,
};

const uiPolicy: BookingRequestUiPolicy = {
  insideCutoff: false,
  requiresInside48HourNoRefundAcceptance: true,
};

function policyProps(locale: Locale) {
  return {
    uiPolicy,
    acceptanceEvidence: bookingRequestAcceptanceEvidence({
      locale,
      termsVersion: quote.termsVersion,
      requiresInside48HourNoRefundAcceptance: true,
    }),
  };
}

describe("Booking Request form", () => {
  beforeEach(() => vi.clearAllMocks());

  it("submits the accepted immutable intent and shows the Pending receipt", async () => {
    submitBookingRequest.mockResolvedValue({
      status: "pending",
      bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
      responseDeadline: "2099-08-21T21:00:00.000Z",
    });
    const user = userEvent.setup();
    render(
      <BookingRequestForm
        customerReady
        discoveryQuery={{
          from: "2099-08-21",
          to: "2099-08-21",
          guests: 4,
          amenities: [],
          selections: [
            { serviceDay: "2099-08-21", kind: "shift", position: 2 },
          ],
        }}
        idempotencyKey="11111111-1111-4111-8111-111111111111"
        locale="en"
        quote={quote}
        {...policyProps("en")}
      />,
    );

    await user.type(screen.getByLabelText("Customer name"), "Ava Hassan");
    await user.clear(screen.getByLabelText("Party size"));
    await user.type(screen.getByLabelText("Party size"), "5");
    await user.type(
      screen.getByLabelText(/Booking Note \(optional\)/),
      "Garden seating, please.",
    );
    await user.click(
      screen.getByLabelText(/accept the preserved House Rules/i),
    );
    await user.click(screen.getByLabelText(/accept the cancellation policy/i));
    await user.click(
      screen.getByLabelText(/accept the marketplace booking terms/i),
    );
    await user.click(screen.getByLabelText(/inside-48-hours no-refund rule/i));
    await user.click(
      screen.getByRole("button", { name: "Send Booking Request" }),
    );

    expect(submitBookingRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
        customerName: "Ava Hassan",
        partySize: 5,
        bookingNote: "Garden seating, please.",
        discoveryQuery: expect.objectContaining({ guests: 5 }),
        displayedQuote: expect.objectContaining({
          fingerprint: "a".repeat(64),
          customerTotalIqd: 105_003,
        }),
        acceptanceEvidence: policyProps("en").acceptanceEvidence,
      }),
    );
    expect(
      screen.getByRole("heading", { name: "Booking Request pending" }),
    ).toBeInTheDocument();
    expect(screen.getByText("RC-REQ-AAAAAAAAAAAAAAAA")).toBeInTheDocument();
  });

  it("shows inline phone verification instead of an unauthenticated submit button", () => {
    render(
      <BookingRequestForm
        customerReady={false}
        discoveryQuery={{
          from: "2099-08-21",
          to: "2099-08-21",
          guests: 4,
          amenities: [],
          selections: [
            { serviceDay: "2099-08-21", kind: "shift", position: 2 },
          ],
        }}
        idempotencyKey="11111111-1111-4111-8111-111111111111"
        locale="en"
        quote={quote}
        {...policyProps("en")}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Verify your phone to continue" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Send Booking Request" }),
    ).not.toBeInTheDocument();
  });

  it.each(["en", "ar", "ckb"] satisfies Locale[])(
    "shows the %s non-reservation warning only before Pending",
    async (locale) => {
      submitBookingRequest.mockResolvedValue({
        status: "pending",
        bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
        responseDeadline: "2099-08-21T21:00:00.000Z",
      });
      const { container } = render(
        <BookingRequestForm
          customerReady
          discoveryQuery={{
            from: "2099-08-21",
            to: "2099-08-21",
            guests: 4,
            amenities: [],
            selections: [
              { serviceDay: "2099-08-21", kind: "shift", position: 2 },
            ],
          }}
          idempotencyKey="11111111-1111-4111-8111-111111111111"
          locale={locale}
          quote={quote}
          {...policyProps(locale)}
        />,
      );

      expect(
        screen.getByText(bookingQuoteMessages[locale].notice),
      ).toBeInTheDocument();
      const form = container.querySelector("form");
      expect(form).not.toBeNull();
      fireEvent.submit(form!);
      expect(
        await screen.findByRole("heading", {
          name: bookingRequestMessages[locale].pendingTitle,
        }),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(bookingQuoteMessages[locale].notice),
      ).not.toBeInTheDocument();
    },
  );
});
