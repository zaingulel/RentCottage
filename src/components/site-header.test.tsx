import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, it, expect, vi } from "vitest";
const { location, hideReview, listAdministrator, requireAccount, router } =
  vi.hoisted(() => ({
    location: { pathname: "/en", query: "" },
    hideReview: vi.fn(),
    listAdministrator: vi.fn(),
    requireAccount: vi.fn(),
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
vi.mock("@/access/request-account-context", () => ({
  requireRequestAccount: requireAccount,
}));
vi.mock("@/customer-review/actions", () => ({
  hideCustomerReview: hideReview,
}));
vi.mock("@/customer-review/request-customer-review", () => ({
  createRequestCustomerReview: vi.fn().mockResolvedValue({ listAdministrator }),
}));
import { SiteHeader } from "./site-header";
import { CustomerReviewModeration } from "./customer-review-moderation";
import AdministratorCustomerReviewsPage from "../app/[locale]/administrator/reviews/page";

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

describe("CustomerReviewModeration", () => {
  it("requires a reason, hides through the action, and retains committed attribution", async () => {
    hideReview.mockResolvedValue({
      status: "hidden",
      reviewId: "11111111-1111-4111-8111-111111111111",
      administratorUserId: "22222222-2222-4222-8222-222222222222",
      reason: "Contains a prohibited contact detail",
      hiddenAt: "2026-09-21T13:00:00.000Z",
    });
    render(
      <CustomerReviewModeration
        locale="en"
        result={{
          status: "success",
          items: [
            {
              reviewId: "11111111-1111-4111-8111-111111111111",
              bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
              profileId: "33333333-3333-4333-8333-333333333333",
              authorUserId: "44444444-4444-4444-8444-444444444444",
              rating: 4,
              originalLanguage: "ar",
              originalBody: "نص التقييم الأصلي",
              submittedAt: "2026-09-21T12:00:00.000Z",
              moderationState: "unhidden",
              hide: null,
            },
          ],
          nextCursor: null,
        }}
      />,
    );
    const review = screen.getByRole("article");
    fireEvent.click(
      within(review).getByRole("button", { name: "Hide review" }),
    );
    expect(within(review).getByRole("alert")).toHaveTextContent(
      "Enter a reason before hiding this review.",
    );
    fireEvent.change(within(review).getByLabelText("Reason for hiding"), {
      target: { value: "Contains a prohibited contact detail" },
    });
    fireEvent.click(
      within(review).getByRole("button", { name: "Hide review" }),
    );
    await waitFor(() =>
      expect(hideReview).toHaveBeenCalledWith({
        locale: "en",
        reviewId: "11111111-1111-4111-8111-111111111111",
        reason: "Contains a prohibited contact detail",
      }),
    );
    expect(within(review).getByRole("status")).toHaveTextContent(
      "The review was hidden.",
    );
    expect(review).toHaveTextContent("Contains a prohibited contact detail");
    expect(review).toHaveTextContent("22222222-2222-4222-8222-222222222222");
  });
});

describe("AdministratorCustomerReviewsPage", () => {
  it("keeps SQL assurance decisive and links insufficient access to MFA recovery", async () => {
    requireAccount.mockResolvedValue({
      status: "authenticated",
      context: { role: "platform_administrator" },
    });
    listAdministrator.mockResolvedValue({ status: "access-required" });
    render(
      await AdministratorCustomerReviewsPage({
        params: Promise.resolve({ locale: "en" }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(
      screen.getByText(
        "Authenticator-verified administrator access is required.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Complete administrator access" }),
    ).toHaveAttribute("href", "/en/administrator/access");
  });
});
