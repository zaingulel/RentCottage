import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { searchPublicCottages } = vi.hoisted(() => ({
  searchPublicCottages: vi.fn(),
}));
vi.mock("next/navigation", () => ({ notFound: vi.fn() }));
vi.mock("@/cottage-discovery/request-cottage-discovery", () => ({
  searchPublicCottages,
}));
vi.mock("@/components/site-footer", () => ({
  SiteFooter: ({
    path,
    queryString,
  }: {
    path: string;
    queryString: string;
  }) => (
    <footer data-testid="footer" data-path={path} data-query={queryString} />
  ),
}));
import ResultsPage from "./page";

const after = "cottage-0123456789abcdef0123456789abcdef";
const search = { from: "2026-09-22", to: "2026-09-23", guests: "4" };
const searchQuery = "from=2026-09-22&to=2026-09-23&guests=4";

async function renderPage(searchParams: Record<string, string>) {
  return render(
    await ResultsPage({
      params: Promise.resolve({ locale: "en" }),
      searchParams: Promise.resolve(searchParams),
    }),
  );
}

beforeEach(() => {
  searchPublicCottages.mockReset();
  searchPublicCottages.mockResolvedValue({
    status: "loaded",
    cottages: [],
    nextAfter: null,
  });
});

describe("Results page", () => {
  it("passes the continuation to the search and keeps it in the sign-in return", async () => {
    const continued = await renderPage({ ...search, after });
    expect(searchPublicCottages).toHaveBeenCalledWith(
      "en",
      expect.objectContaining({ from: "2026-09-22", guests: 4 }),
      after,
    );
    expect(screen.getByTestId("footer")).toHaveAttribute(
      "data-path",
      "/results",
    );
    expect(screen.getByTestId("footer")).toHaveAttribute(
      "data-query",
      `${searchQuery}&after=${after}`,
    );
    expect(
      screen.getByText("There are no more cottages for this search."),
    ).toBeVisible();
    continued.unmount();

    searchPublicCottages.mockClear();
    await renderPage(search);
    expect(searchPublicCottages).toHaveBeenCalledWith(
      "en",
      expect.objectContaining({ from: "2026-09-22", guests: 4 }),
      null,
    );
    expect(screen.getByTestId("footer")).toHaveAttribute(
      "data-query",
      searchQuery,
    );
    expect(
      screen.getByText(
        "No cottage matches every requested Service Day and selected filter.",
      ),
    ).toBeVisible();
  });

  it("shows the invalid search page for a malformed continuation", async () => {
    await renderPage({ ...search, after: "not-a-cottage" });
    expect(
      screen.getByRole("heading", { name: "This search cannot be used" }),
    ).toBeVisible();
    expect(searchPublicCottages).not.toHaveBeenCalled();
    expect(screen.getByTestId("footer")).toHaveAttribute(
      "data-query",
      `${searchQuery}&after=not-a-cottage`,
    );
  });
});
