import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

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

import AdministratorCottageProfilePage from "./page";

it("does not present an administrator authorization RPC error as a denial", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  resolveContext.mockResolvedValue({ role: "platform_administrator" });
  createClient.mockResolvedValue({
    rpc: vi.fn().mockResolvedValue({
      data: null,
      error: new Error("authorization provider unavailable"),
    }),
  });

  render(
    await AdministratorCottageProfilePage({
      params: Promise.resolve({
        locale: "en",
        profileId: "70000000-0000-4000-8000-000000000001",
      }),
    }),
  );

  expect(
    screen.getByText(
      "Cottage Profiles are temporarily unavailable. Please try again.",
    ),
  ).toBeVisible();
  expect(
    screen.queryByRole("link", { name: "Complete administrator access" }),
  ).not.toBeInTheDocument();
  expect(createCottageProfile).not.toHaveBeenCalled();
});
