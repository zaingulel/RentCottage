import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const { requestPhone } = vi.hoisted(() => ({ requestPhone: vi.fn() }));
vi.mock("@/access/actions", () => ({ requestPhoneAccess: requestPhone }));

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
    periodPresentation: "morning-evening-v1" as const,
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
  it("hosted demo passes simulation mode to inline phone access", async () => {
    requestPhone.mockResolvedValue({ status: "demo_code_ready" });
    const view = render(
      <BookingQuoteView
        locale="en"
        slug={result.quote.slug}
        queryString="guests=4"
        result={result}
        {...bookingRequestProps}
        customerReady={false}
        phoneAccessMode="hosted-demo"
      />,
    );
    expect(
      screen.getByRole("heading", {
        name: "Continue with your invited demo identity",
      }),
    ).toBeVisible();
    fireEvent.change(screen.getByLabelText("Invited demo number"), {
      target: { value: "+9647500000000" },
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Use simulated code" }),
    );
    expect(screen.getByLabelText("Simulated invitation code")).toBeVisible();
    expect(requestPhone).toHaveBeenLastCalledWith("+9647500000000");
    view.unmount();
    const standard = render(
      <BookingQuoteView
        locale="en"
        slug={result.quote.slug}
        queryString="guests=4"
        result={result}
        {...bookingRequestProps}
        customerReady={false}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Send verification code" }),
    ).toBeVisible();
    standard.unmount();
    const unavailable = render(
      <BookingQuoteView
        locale="en"
        slug={result.quote.slug}
        queryString="guests=4"
        result={{ status: "unavailable" }}
        {...bookingRequestProps}
        customerReady={false}
        phoneAccessMode="hosted-demo"
      />,
    );
    expect(screen.getByRole("alert")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Use simulated code" }),
    ).not.toBeInTheDocument();
    unavailable.unmount();
  });
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
    const item = screen.getByRole("listitem", { name: "Evening Night" });
    expect(item).toHaveTextContent("Evening Night");
    expect(item).toHaveTextContent("Arrival: Aug 21, 2099, 20:00");
    expect(item).toHaveTextContent("Departure: Aug 22, 2099, 02:00");
    expect(item).toHaveTextContent("All times are Iraq local time (UTC+3).");
    expect(within(item).getByText("Night")).toHaveAttribute("dir", "auto");
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

  it("places the price breakdown before the Send button", () => {
    render(
      <BookingQuoteView
        locale="en"
        queryString="from=2099-08-21&selection=2099-08-21%3Ashift%3A2&guests=4"
        result={result}
        slug={result.quote.slug}
        {...bookingRequestProps}
      />,
    );
    const totals = screen.getByRole("complementary");
    const send = screen.getByRole("button", { name: "Send Booking Request" });
    expect(
      totals.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it.each([
    [
      "en",
      "Total",
      ["Booking Price", "Booking Service Fee", "Customer Total"],
      ["IQD 100,003", "IQD 5,000", "IQD 105,003"],
    ],
    [
      "ar",
      "إجمالي",
      ["سعر الحجز", "رسوم خدمة الحجز", "إجمالي العميل"],
      ["IQD 100,003", "IQD 5,000", "IQD 105,003"],
    ],
    [
      "ckb",
      "کۆی گشتی",
      ["نرخی حجزکردن", "کرێی خزمەتگوزاری حجزکردن", "کۆی گشتی کڕیار"],
      ["IQD ١٠٠٬٠٠٣", "IQD ٥٬٠٠٠", "IQD ١٠٥٬٠٠٣"],
    ],
  ] as const)(
    "labels only the Customer Total as a total in every launch language",
    (locale, totalWord, labels, amounts) => {
      render(
        <BookingQuoteView
          locale={locale}
          queryString="from=2099-08-21&selection=2099-08-21%3Ashift%3A2&guests=4"
          result={result}
          slug={result.quote.slug}
          {...bookingRequestProps}
        />,
      );
      const rows = within(screen.getByRole("complementary"))
        .getAllByRole("term")
        .map((term) => term.parentElement as HTMLElement);
      const labelText = rows.map((row) => row.querySelector("dt")?.textContent);
      expect(labelText).toEqual(labels);
      expect(rows.map((row) => row.querySelector("dd")?.textContent)).toEqual(
        amounts,
      );
      expect(labelText.map((label) => label?.includes(totalWord))).toEqual([
        false,
        false,
        true,
      ]);
    },
  );

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
    const item = screen.getByRole("listitem", {
      name: "الفترة المسائية Night",
    });
    expect(item).toHaveTextContent("الفترة المسائية Night");
    expect(within(item).getByText("Night")).toHaveAttribute("dir", "auto");
  });

  it("shows Sorani semantic labels beside original owner names", () => {
    render(
      <BookingQuoteView
        locale="ckb"
        queryString="from=2099-08-21&selection=2099-08-21%3Ashift%3A2&guests=4"
        result={result}
        slug={result.quote.slug}
        {...bookingRequestProps}
      />,
    );
    const item = screen.getByRole("listitem", { name: "ماوەی ئێوارە Night" });
    expect(item).toHaveTextContent("ماوەی ئێوارە Night");
    expect(within(item).getByText("Night")).toHaveAttribute("dir", "auto");
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
      name: "Full-day",
    });
    expect(bundles).toHaveLength(2);
    expect(bundles[0]).toHaveTextContent("IQD 250,000");
    expect(bundles[1]).toHaveTextContent("IQD 260,000");
    expect(bundles[0]).toHaveTextContent(
      "Includes Morning and Evening with continuous access, including the time between them.",
    );
    const summary = screen.getByRole("heading", {
      name: "Your selected access",
    }).parentElement!;
    expect(summary.querySelectorAll("li")).toHaveLength(1);
    expect(summary).toHaveTextContent("Arrival: Aug 21, 2099, 08:00");
    expect(summary).toHaveTextContent("Departure: Aug 22, 2099, 23:00");
    expect(summary.querySelector(".booking-period-gap")).toBeNull();
    expect(screen.getByText("IQD 510,000")).toBeInTheDocument();
    expect(screen.getByText("IQD 515,000")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Your selected access" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Continuous access includes the overnight time between these Full-day dates.",
      ),
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
