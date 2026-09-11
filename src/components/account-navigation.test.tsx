import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
vi.mock("next/navigation", () => ({ usePathname: () => "/en" }));
vi.mock("@/access/actions", () => ({ signOutAccount: vi.fn() }));
import { AccountNavigation } from "./account-navigation";
describe("shared account navigation", () => {
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
