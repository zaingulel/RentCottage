import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, it, expect, vi } from "vitest";
const { location, router } = vi.hoisted(() => ({
  location: { pathname: "/en", query: "" },
  router: { refresh: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  usePathname: () => location.pathname,
  useSearchParams: () => new URLSearchParams(location.query),
  useRouter: () => router,
  notFound: vi.fn(),
  unstable_rethrow: vi.fn(),
}));
vi.mock("@/access/actions", () => ({ signOutAccount: vi.fn() }));
import { SiteHeader } from "./site-header";

function scrollTo(y: number) {
  Object.defineProperty(window, "scrollY", { configurable: true, value: y });
  act(() => {
    fireEvent.scroll(window);
  });
}

describe("shared site header", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    location.pathname = "/en";
    location.query = "";
    scrollTo(0);
  });
  it.each(["en", "ar", "ckb"] as const)(
    "keeps permitted search and booking context in %s sign-in",
    (locale) => {
      location.pathname = `/${locale}/quote/river-house`;
      location.query =
        "from=2101-01-01&to=2101-01-01&guests=4&selection=2101-01-01%3Ashift%3A1";
      render(<SiteHeader locale="en" account={{ status: "signed_out" }} />);
      const signIn = screen.getByRole("link", {
        name: { en: "Sign in", ar: "تسجيل الدخول", ckb: "چوونەژوورەوە" }[
          locale
        ],
      });
      expect(signIn).toHaveAttribute(
        "href",
        `/${locale}/access?returnTo=${encodeURIComponent(`${location.pathname}?${location.query}`)}`,
      );
    },
  );
  it("rejects private or unrecognized fields from navigation return context", () => {
    location.pathname = "/en/results";
    location.query =
      "from=2101-01-01&to=2101-01-01&guests=4&selection=2101-01-01%3Ashift%3A1&token=private";
    render(<SiteHeader locale="en" account={{ status: "signed_out" }} />);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/en/access?returnTo=%2Fen%2Fbookings",
    );
  });
  it("offers shared authentication separately from owner enrollment", () => {
    render(<SiteHeader locale="en" account={{ status: "signed_out" }} />);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/en/access?returnTo=%2Fen%2Fbookings",
    );
    expect(
      screen.getByRole("link", { name: "List your cottage" }),
    ).toHaveAttribute(
      "href",
      "/en/access?returnTo=%2Fen%2Fowner%2Fapplication",
    );
  });
  it("switches language through links that keep the current page and query", () => {
    location.pathname = "/ar/results";
    location.query = "from=2101-01-01&to=2101-01-01&guests=4";
    render(<SiteHeader locale="ar" account={{ status: "signed_out" }} />);
    expect(screen.getByRole("navigation", { name: "اللغة" })).toBeVisible();
    const current = screen.getByRole("link", { name: "العربية" });
    expect(current).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "کوردی" })).toHaveAttribute(
      "href",
      "/ckb/results?from=2101-01-01&to=2101-01-01&guests=4",
    );
    expect(screen.getByRole("link", { name: "English" })).not.toHaveAttribute(
      "aria-current",
    );
    expect(screen.getByRole("link", { name: /ريف كوتج/ })).toHaveAttribute(
      "href",
      "/ar",
    );
  });
  it("renders the landing header transparent and condenses it after scrolling", () => {
    render(<SiteHeader locale="en" account={{ status: "signed_out" }} />);
    const header = screen.getByRole("banner");
    expect(header).toHaveClass("site-header-landing");
    expect(header).not.toHaveClass("site-header-solid");
    scrollTo(141);
    expect(header).toHaveClass("site-header-solid");
    scrollTo(140);
    expect(header).not.toHaveClass("site-header-solid");
  });
  it("renders a restored mid-page landing visit condensed on mount", () => {
    scrollTo(500);
    render(<SiteHeader locale="en" account={{ status: "signed_out" }} />);
    expect(screen.getByRole("banner")).toHaveClass("site-header-solid");
  });
  it("renders every other page with the static solid header", () => {
    location.pathname = "/en/results";
    render(<SiteHeader locale="en" account={{ status: "signed_out" }} />);
    const header = screen.getByRole("banner");
    expect(header).toHaveClass("site-header-solid");
    expect(header).not.toHaveClass("site-header-landing");
    scrollTo(500);
    expect(header).toHaveClass("site-header-solid");
  });
  it("reports an unavailable session in the account slot", () => {
    render(<SiteHeader locale="en" account={{ status: "unavailable" }} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Account access is unavailable. Please try again.",
    );
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
    expect(screen.getByRole("link", { name: "Support" })).toHaveAttribute(
      "href",
      "/en/support",
    );
  });
  it("support link discards private source context", () => {
    location.pathname = "/en/booking-requests/RC-REQ-0123456789ABCDEF";
    location.query = "token=private-support-sentinel";
    render(<SiteHeader locale="en" account={{ status: "signed_out" }} />);
    expect(screen.getByRole("link", { name: "Support" })).toHaveAttribute(
      "href",
      "/en/support",
    );
  });
  it.each(["en", "ar", "ckb"] as const)(
    "shows localized support when signed out in %s",
    (locale) => {
      location.pathname = `/${locale}`;
      render(<SiteHeader locale={locale} account={{ status: "signed_out" }} />);
      expect(
        screen.getByRole("link", {
          name: { en: "Support", ar: "الدعم", ckb: "پشتیوانی" }[locale],
        }),
      ).toHaveAttribute("href", `/${locale}/support`);
    },
  );
  it("shows support to a customer outside the account disclosure", () => {
    render(
      <SiteHeader
        locale="en"
        account={{ status: "authenticated", context: { role: "customer" } }}
      />,
    );
    const support = screen.getByRole("link", { name: "Support" });
    expect(support).toHaveAttribute("href", "/en/support");
    expect(support.closest("details")).toBeNull();
  });
  it.each(["prospective", "approved", "expired", "suspended"] as const)(
    "keeps customer booking access for %s owners",
    (approvalState) => {
      render(
        <SiteHeader
          locale="en"
          account={{
            status: "authenticated",
            context: { role: "cottage_owner", approvalState },
          }}
        />,
      );
      screen.getByText("Account", { exact: true }).click();
      expect(screen.getByRole("link", { name: "My bookings" })).toHaveAttribute(
        "href",
        "/en/bookings",
      );
      expect(screen.getByRole("link", { name: "Messages" })).toHaveAttribute(
        "href",
        "/en/messages",
      );
      expect(
        screen.getByRole("link", {
          name:
            approvalState === "prospective"
              ? "Continue to Owner Application"
              : "Manage my cottages",
        }),
      ).toHaveAttribute(
        "href",
        approvalState === "prospective"
          ? "/en/owner/application"
          : "/en/owner/cottages",
      );
      expect(screen.getByRole("button", { name: "Sign out" })).toBeVisible();
      expect(screen.getByRole("link", { name: "Support" })).toHaveAttribute(
        "href",
        "/en/support",
      );
    },
  );
  it("closes the disclosure when choosing a destination", () => {
    render(
      <SiteHeader
        locale="en"
        account={{ status: "authenticated", context: { role: "customer" } }}
      />,
    );
    const summary = screen.getByText("Account", { exact: true });
    summary.click();
    expect(summary.parentElement).toHaveAttribute("open");
    fireEvent.click(screen.getByRole("link", { name: "List your cottage" }));
    expect(summary.parentElement).not.toHaveAttribute("open");
  });
  it("keeps administrator access separate", () => {
    render(
      <SiteHeader
        locale="en"
        account={{
          status: "authenticated",
          context: { role: "platform_administrator" },
        }}
      />,
    );
    screen.getByText("Account", { exact: true }).click();
    expect(
      screen.getByRole("link", { name: "Platform Administrator access" }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Review moderation" }),
    ).toHaveAttribute("href", "/en/administrator/reviews");
    expect(
      screen.queryByRole("link", { name: "My bookings" }),
    ).not.toBeInTheDocument();
  });
});
