import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, it, expect, vi } from "vitest";
const location = vi.hoisted(() => ({ pathname: "/en", query: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => location.pathname,
  useSearchParams: () => new URLSearchParams(location.query),
}));
vi.mock("@/access/actions", () => ({ signOutAccount: vi.fn() }));
import { AccountNavigation } from "./account-navigation";
describe("shared account navigation", () => {
  beforeEach(() => {
    location.pathname = "/en";
    location.query = "";
  });
  it.each(["en", "ar", "ckb"] as const)(
    "keeps permitted search and booking context in %s sign-in",
    (locale) => {
      location.pathname = `/${locale}/quote/river-house`;
      location.query =
        "from=2101-01-01&to=2101-01-01&guests=4&selection=2101-01-01%3Ashift%3A1";
      render(
        <AccountNavigation locale="en" account={{ status: "signed_out" }} />,
      );
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
    render(
      <AccountNavigation locale="en" account={{ status: "signed_out" }} />,
    );
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/en/access?returnTo=%2Fen%2Fbookings",
    );
  });
  it("offers shared authentication separately from owner enrollment", () => {
    render(
      <AccountNavigation locale="en" account={{ status: "signed_out" }} />,
    );
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
  it.each(["prospective", "approved", "expired", "suspended"] as const)(
    "keeps customer booking access for %s owners",
    (approvalState) => {
      render(
        <AccountNavigation
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
      <AccountNavigation
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
      <AccountNavigation
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
      screen.queryByRole("link", { name: "My bookings" }),
    ).not.toBeInTheDocument();
  });
});
