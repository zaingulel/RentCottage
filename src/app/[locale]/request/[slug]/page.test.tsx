import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { loadQuote, notFound, resolveAccountContext } = vi.hoisted(() => ({
  loadQuote: vi.fn(),
  notFound: vi.fn(),
  resolveAccountContext: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@/booking-quote/request-booking-quote", () => ({
  loadPublicBookingQuote: loadQuote,
}));
vi.mock("@/access/supabase-server", () => ({
  createRequestSupabaseClient: vi.fn(),
}));
vi.mock("@/access/supabase-account-access", () => ({
  SupabaseAccountContextStore: class {
    resolve = resolveAccountContext;
  },
}));

import RequestPage from "./page";
import { bookingTermsFixture } from "@/booking-request/booking-terms-fixture";

describe("public Booking Quote page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("APP_ENVIRONMENT", "test");
    vi.stubEnv("SUPABASE_PROJECT_REF", "local-test");
    vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:54331");
    resolveAccountContext.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("shows only the future Booking Request notice outside the isolated test runtime", async () => {
    vi.stubEnv("APP_ENVIRONMENT", "production");
    vi.stubEnv("SUPABASE_PROJECT_REF", "local-test");
    vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:54331");

    render(
      await RequestPage({
        params: Promise.resolve({
          locale: "en",
          slug: "cottage-00000000000040008000000000000029",
        }),
        searchParams: Promise.resolve({
          from: "2099-08-21",
          selection: "2099-08-21:shift:2",
          guests: "4",
        }),
      }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Online Booking Requests are not available yet",
    );
    expect(screen.getByRole("main")).toHaveTextContent(
      "You can keep browsing cottages",
    );
    expect(screen.getByRole("main").children).toHaveLength(1);
    expect(loadQuote).not.toHaveBeenCalled();
    expect(resolveAccountContext).not.toHaveBeenCalled();
  });

  it("shows an unavailable error when Customer identity cannot be checked", async () => {
    loadQuote.mockResolvedValue({
      status: "quoted",
      quote: {
        slug: "cottage-00000000000040008000000000000029",
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
            priceIqd: 100_000,
          },
        ],
        bookingPriceIqd: 100_000,
        serviceFeeIqd: 5_000,
        customerTotalIqd: 105_000,
        quoteFingerprint: "a".repeat(64),
      },
    });
    resolveAccountContext.mockRejectedValue(new Error("identity unavailable"));

    render(
      await RequestPage({
        params: Promise.resolve({
          locale: "en",
          slug: "cottage-00000000000040008000000000000029",
        }),
        searchParams: Promise.resolve({
          from: "2099-08-21",
          to: "2099-08-21",
          selection: "2099-08-21:shift:2",
          guests: "4",
        }),
      }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "could not be completed safely",
    );
    expect(
      screen.queryByRole("heading", { name: "Verify your phone to continue" }),
    ).not.toBeInTheDocument();
  });

  it("awaits the route values and loads the canonical discovery selection", async () => {
    loadQuote.mockResolvedValue({ status: "selection-unavailable" });
    render(
      await RequestPage({
        params: Promise.resolve({
          locale: "en",
          slug: "cottage-00000000000040008000000000000029",
        }),
        searchParams: Promise.resolve({
          to: "2026-08-22",
          from: "2026-08-21",
          selection: ["2026-08-22:shift:1", "2026-08-21:shift:2"],
          guests: "4",
        }),
      }),
    );
    expect(loadQuote).toHaveBeenCalledWith(
      "en",
      "cottage-00000000000040008000000000000029",
      {
        from: "2026-08-21",
        to: "2026-08-22",
        selections: [
          { serviceDay: "2026-08-21", kind: "shift", position: 2 },
          { serviceDay: "2026-08-22", kind: "shift", position: 1 },
        ],
        guests: 4,
        amenities: [],
      },
    );
    expect(screen.getByRole("alert")).toHaveTextContent("no longer available");
  });

  it.each([
    "garden-house",
    "cottage-000000000000400080000000000000290",
    "cottage-ABCDEF00000000000000000000000000",
  ])(
    "returns not found for an invalid slug without provider work",
    async (slug) => {
      await RequestPage({
        params: Promise.resolve({ locale: "en", slug }),
        searchParams: Promise.resolve({
          from: "2026-08-21",
          selection: "2026-08-21:shift:1",
          guests: "4",
        }),
      });
      expect(notFound).toHaveBeenCalled();
      expect(loadQuote).not.toHaveBeenCalled();
    },
  );

  it("keeps a fictional request route disconnected when no selection is supplied", async () => {
    await RequestPage({
      params: Promise.resolve({ locale: "en", slug: "garden-house" }),
      searchParams: Promise.resolve({}),
    });
    expect(notFound).toHaveBeenCalled();
    expect(loadQuote).not.toHaveBeenCalled();
  });
});
