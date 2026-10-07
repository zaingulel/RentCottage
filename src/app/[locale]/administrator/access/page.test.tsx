import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ notFound: vi.fn() }));
vi.mock("@/components/administrator-access-form", () => ({
  AdministratorAccessForm: ({
    returnTo,
    recordsHref,
  }: {
    returnTo?: string;
    recordsHref?: string;
  }) => (
    <output data-testid="administrator-access-form">
      {returnTo ?? "no-return"} {recordsHref}
    </output>
  ),
}));

import AdministratorAccessPage from "./page";

describe("AdministratorAccessPage", () => {
  it("offers Records after administrator access", async () => {
    render(
      await AdministratorAccessPage({
        params: Promise.resolve({ locale: "en" }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(screen.getByTestId("administrator-access-form")).toHaveTextContent(
      "/en/administrator/records",
    );
    expect(
      screen.queryByRole("link", { name: "RentCottage" }),
    ).not.toBeInTheDocument();
  });
  it.each(["en", "ar", "ckb"] as const)(
    "passes the safe same-locale %s moderation destination to the form",
    async (locale) => {
      const destination = `/${locale}/administrator/reviews`;
      render(
        await AdministratorAccessPage({
          params: Promise.resolve({ locale }),
          searchParams: Promise.resolve({ returnTo: destination }),
        }),
      );

      expect(screen.getByTestId("administrator-access-form")).toHaveTextContent(
        destination,
      );
    },
  );

  it.each([
    undefined,
    ["/en/administrator/reviews"],
    "/ar/administrator/reviews",
    "/en/administrator/reviews?beforeAt=private",
  ])("omits an unsafe return destination %#", async (returnTo) => {
    render(
      await AdministratorAccessPage({
        params: Promise.resolve({ locale: "en" }),
        searchParams: Promise.resolve({ returnTo }),
      }),
    );

    expect(screen.getByTestId("administrator-access-form")).toHaveTextContent(
      "no-return",
    );
  });
});
