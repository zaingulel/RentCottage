import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClient, createCottageProfile, resolveContext } = vi.hoisted(
  () => ({
    createClient: vi.fn(),
    createCottageProfile: vi.fn(),
    resolveContext: vi.fn(),
  }),
);

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
  unstable_rethrow: vi.fn(),
}));

import OwnerCottageProfilePage from "./page";

describe("Cottage Profile owner detail page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClient.mockResolvedValue({});
  });

  it("directs a prospective owner back to their Owner Application", async () => {
    resolveContext.mockResolvedValue({
      role: "cottage_owner",
      approvalState: "prospective",
    });

    render(
      await OwnerCottageProfilePage({
        params: Promise.resolve({ locale: "en", profileId: "not-owned" }),
      }),
    );

    expect(
      screen.getByText(
        /Continue your first Cottage Profile in Owner Application/,
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Open Owner Application" }),
    ).toHaveAttribute("href", "/en/owner/application");
  });

  it("directs a non-owner to the dedicated owner access action", async () => {
    resolveContext.mockResolvedValue({ role: "customer" });

    render(
      await OwnerCottageProfilePage({
        params: Promise.resolve({ locale: "en", profileId: "not-owned" }),
      }),
    );

    expect(
      screen.getByRole("link", { name: "Verify Cottage Owner access" }),
    ).toHaveAttribute("href", "/en/owner/access");
    expect(
      screen.queryByRole("link", { name: "Open Owner Application" }),
    ).not.toBeInTheDocument();
  });
});
