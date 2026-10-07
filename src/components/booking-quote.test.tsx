import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/booking-request/actions", () => ({
  submitBookingRequest: vi.fn(),
}));

import { BookingQuoteView } from "./booking-quote";
import { bookingRequestAcceptanceEvidence } from "@/booking-request/booking-request-policy";
import { bookingTermsFixture } from "@/booking-request/booking-terms-fixture";

const result = {
  status: "quoted" as const,
  quote: {
    slug: "cottage-00000000000040008000000000000029",
    cottageName: "Quiet Garden",
    contentVersion: 2,
    houseRules: "No smoking",
    termsVersion: "fictional-local-test-2026-08-22-v1" as const,
    marketplaceTerms: bookingTermsFixture("en"),
    items: [
      {
        serviceDay: "2099-08-21",
        kind: "shift" as const,
        position: 2 as const,
        displayName: "Night",
        startsAt: "2099-08-21T20:00:00+03:00",
        endsAt: "2099-08-22T02:00:00+03:00",
        crossesMidnight: true,
        priceIqd: 100_003,
      },
    ],
    bookingPriceIqd: 100_003,
    serviceFeeIqd: 5_000 as const,
    customerTotalIqd: 105_003,
    quoteFingerprint: "a".repeat(64),
  },
};

const discoveryQuery = {
  from: "2099-08-21",
  to: "2099-08-21",
  selections: [
    { serviceDay: "2099-08-21", kind: "shift" as const, position: 2 as const },
  ],
  guests: 4,
  amenities: [],
};

const bookingRequestProps = {
  discoveryQuery,
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
  customerReady: true,
  bookingRequestUiPolicy: {
    insideCutoff: false,
    requiresInside48HourNoRefundAcceptance: true,
  },
  bookingRequestAcceptanceEvidence: bookingRequestAcceptanceEvidence({
    locale: "en",
    requiresInside48HourNoRefundAcceptance: true,
  }),
};

describe("Booking Quote view", () => {
  it("renders the complete terms body before acceptance", () => {
    render(
      <BookingQuoteView
        locale="en"
        queryString="from=2099-08-21&selection=2099-08-21%3Ashift%3A2&guests=4"
        result={result}
        slug={result.quote.slug}
        {...bookingRequestProps}
      />,
    );

    const fixture = bookingTermsFixture("en");
    const body = screen.getByLabelText("Complete fictional terms content");
    const acceptance = screen.getByLabelText(
      /accept the marketplace booking terms/i,
    );
    expect(body.textContent).toBe(fixture.body);
    expect(
      body.compareDocumentPosition(acceptance) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it.each([
    ["English", "en", "I accept the marketplace booking terms."],
    ["Arabic", "ar", "أوافق على شروط الحجز في المنصة."],
    ["Sorani", "ckb", "مەرجەکانی حجزکردنی پلاتفۆرم قبوڵ دەکەم."],
  ] as const)(
    "shows no internal record identifier to a %s Customer",
    (_language, locale, acceptanceSentence) => {
      const fixture = bookingTermsFixture(locale);
      const { container } = render(
        <BookingQuoteView
          locale={locale}
          queryString="from=2099-08-21&selection=2099-08-21%3Ashift%3A2&guests=4"
          result={{
            ...result,
            quote: {
              ...result.quote,
              contentVersion: 987654,
              marketplaceTerms: fixture,
            },
          }}
          slug={result.quote.slug}
          {...bookingRequestProps}
          bookingRequestAcceptanceEvidence={bookingRequestAcceptanceEvidence({
            locale,
            requiresInside48HourNoRefundAcceptance: true,
          })}
        />,
      );

      expect(container).not.toHaveTextContent(fixture.version);
      expect(container).not.toHaveTextContent(fixture.sha256);
      expect(container).not.toHaveTextContent("987654");
      const termsCard = screen
        .getByText(fixture.body.split("\n")[0], { exact: false })
        .closest("section");
      expect(termsCard).not.toBeNull();
      expect(
        within(termsCard as HTMLElement).queryByRole("term"),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("checkbox", { name: acceptanceSentence }),
      ).toBeInTheDocument();
    },
  );

  it("shows every priced unit, next-day timing, exact breakdown and non-reservation notice", () => {
    render(
      <BookingQuoteView
        locale="en"
        queryString="from=2099-08-21&selection=2099-08-21%3Ashift%3A2&guests=4"
        result={result}
        slug={result.quote.slug}
        {...bookingRequestProps}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Your exact Booking Quote" }),
    ).toBeInTheDocument();
    const item = screen.getByRole("listitem", { name: /Shift 2/ });
    expect(item).toHaveTextContent("Shift 2");
    expect(item).not.toHaveTextContent("Night");
    expect(item).toHaveTextContent("IQD 100,003");
    expect(item).toHaveTextContent("next day");
    expect(screen.getByText("IQD 105,003")).toBeInTheDocument();
    expect(screen.queryByText(/commission/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "House Rules" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/does not reserve/)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Send your Booking Request" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Send Booking Request" }),
    ).toBeInTheDocument();
  });

  it("renders localized right-to-left quote content", () => {
    const { container } = render(
      <BookingQuoteView
        locale="ar"
        queryString="from=2099-08-21&selection=2099-08-21%3Ashift%3A2&guests=4"
        result={result}
        slug={result.quote.slug}
        {...bookingRequestProps}
      />,
    );
    expect(container.querySelector("main")).toHaveAttribute("dir", "rtl");
    expect(
      screen.getByRole("heading", { name: "عرض سعر الحجز الدقيق" }),
    ).toBeInTheDocument();
    const item = screen.getByRole("listitem", { name: /الوردية 2/ });
    expect(item).toHaveTextContent("الوردية 2");
    expect(item).not.toHaveTextContent("Night");
  });

  it("uses localized Sorani shift positions without exposing owner names", () => {
    render(
      <BookingQuoteView
        locale="ckb"
        queryString="from=2099-08-21&selection=2099-08-21%3Ashift%3A2&guests=4"
        result={result}
        slug={result.quote.slug}
        {...bookingRequestProps}
      />,
    );
    const item = screen.getByRole("listitem", { name: /شەفتی 2/ });
    expect(item).toHaveTextContent("شەفتی 2");
    expect(item).not.toHaveTextContent("Night");
  });

  it("itemizes consecutive separately priced Full-Day Bundles and merged access", () => {
    const fullDayResult = {
      ...result,
      quote: {
        ...result.quote,
        items: [
          {
            serviceDay: "2099-08-21",
            kind: "full-day" as const,
            displayName: "Owner full-day name",
            startsAt: "2099-08-21T08:00:00+03:00",
            endsAt: "2099-08-21T23:00:00+03:00",
            crossesMidnight: false,
            priceIqd: 250_000,
          },
          {
            serviceDay: "2099-08-22",
            kind: "full-day" as const,
            displayName: "Owner full-day name",
            startsAt: "2099-08-22T08:00:00+03:00",
            endsAt: "2099-08-22T23:00:00+03:00",
            crossesMidnight: false,
            priceIqd: 260_000,
          },
        ],
        bookingPriceIqd: 510_000,
        customerTotalIqd: 515_000,
      },
    };
    render(
      <BookingQuoteView
        locale="en"
        queryString="from=2099-08-21&to=2099-08-22"
        result={fullDayResult}
        slug={result.quote.slug}
        discoveryQuery={{
          ...discoveryQuery,
          to: "2099-08-22",
          selections: [
            { serviceDay: "2099-08-21", kind: "full-day" },
            { serviceDay: "2099-08-22", kind: "full-day" },
          ],
        }}
        idempotencyKey={bookingRequestProps.idempotencyKey}
        customerReady
        bookingRequestUiPolicy={bookingRequestProps.bookingRequestUiPolicy}
        bookingRequestAcceptanceEvidence={
          bookingRequestProps.bookingRequestAcceptanceEvidence
        }
      />,
    );

    const bundles = screen.getAllByRole("listitem", {
      name: /Full-Day Bundle/,
    });
    expect(bundles).toHaveLength(2);
    expect(bundles[0]).toHaveTextContent("IQD 250,000");
    expect(bundles[1]).toHaveTextContent("IQD 260,000");
    expect(screen.getByText("IQD 510,000")).toBeInTheDocument();
    expect(screen.getByText("IQD 515,000")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Continuous full-day access" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Aug 21, 2099, 8:00 AM.*Aug 22, 2099, 11:00 PM/),
    ).toBeInTheDocument();
  });

  it("does not expose partial pricing for an unavailable selection", () => {
    render(
      <BookingQuoteView
        locale="ckb"
        queryString="from=2026-08-21"
        result={{ status: "selection-unavailable" }}
        slug={result.quote.slug}
        {...bookingRequestProps}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("بەردەست نییە");
    expect(screen.queryByText(/IQD/)).not.toBeInTheDocument();
  });
});
