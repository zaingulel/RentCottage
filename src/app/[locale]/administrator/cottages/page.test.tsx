import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClient, createCottageProfile, resolveContext, unstableRethrow } =
  vi.hoisted(() => ({
    createClient: vi.fn(),
    createCottageProfile: vi.fn(),
    resolveContext: vi.fn(),
    unstableRethrow: vi.fn(),
  }));

vi.mock("server-only", () => ({}));
vi.mock("@/access/supabase-server", () => ({
  createRequestSupabaseClient: createClient,
}));
vi.mock("@/access/supabase-account-access", () => ({
  SupabaseAccountContextStore: class {
    resolve() {
      return resolveContext();
    }
  },
}));
vi.mock("@/cottage-profile/request-cottage-profile", () => ({
  createRequestCottageProfile: createCottageProfile,
}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
  unstable_rethrow: unstableRethrow,
}));

import AdministratorCottagesPage from "./page";

describe("Cottage Profile administrator overview page", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports an administrator authorization RPC error as unavailable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    resolveContext.mockResolvedValue({ role: "platform_administrator" });
    createClient.mockResolvedValue({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: new Error("authorization provider unavailable"),
      }),
    });

    render(
      await AdministratorCottagesPage({
        params: Promise.resolve({ locale: "en" }),
      }),
    );

    expect(
      screen.getByText(
        "Cottage Profiles are temporarily unavailable. Please try again.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByText("Authenticator multi-factor access is required."),
    ).not.toBeInTheDocument();
    expect(createCottageProfile).not.toHaveBeenCalled();
  });

  it("uses a dedicated action label for a genuine authorization denial", async () => {
    resolveContext.mockResolvedValue({ role: "platform_administrator" });
    createClient.mockResolvedValue({
      rpc: vi.fn().mockResolvedValue({ data: false, error: null }),
    });

    render(
      await AdministratorCottagesPage({
        params: Promise.resolve({ locale: "en" }),
      }),
    );

    expect(
      screen.getByRole("link", { name: "Complete administrator access" }),
    ).toHaveAttribute("href", "/en/administrator/access");
  });

  it("renders the next stable administrator Cottage Profile page", async () => {
    const listAdministrator = vi.fn().mockResolvedValue({
      profiles: [],
      nextCursor: {
        updatedAt: "2026-08-17T09:15:00.123456Z",
        profileId: "70000000-0000-4000-8000-000000000002",
      },
    });
    resolveContext.mockResolvedValue({ role: "platform_administrator" });
    createClient.mockResolvedValue({
      rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
    });
    createCottageProfile.mockResolvedValue({ listAdministrator });

    render(
      await AdministratorCottagesPage({
        params: Promise.resolve({ locale: "en" }),
        searchParams: Promise.resolve({
          afterUpdatedAt: "2026-08-17T08:00:00.000000Z",
          afterProfileId: "70000000-0000-4000-8000-000000000003",
        }),
      }),
    );

    expect(listAdministrator).toHaveBeenCalledWith({
      updatedAt: "2026-08-17T08:00:00.000000Z",
      profileId: "70000000-0000-4000-8000-000000000003",
    });
    expect(
      screen.getByRole("link", { name: "Next Cottage Profiles" }),
    ).toHaveAttribute(
      "href",
      "/en/administrator/cottages?afterUpdatedAt=2026-08-17T09%3A15%3A00.123456Z&afterProfileId=70000000-0000-4000-8000-000000000002",
    );
  });
});
