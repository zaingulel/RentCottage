import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createClient, loadApplications, resolveContext, unstableRethrow } =
  vi.hoisted(() => ({
    createClient: vi.fn(),
    loadApplications: vi.fn(),
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

vi.mock("@/owner-application/supabase-owner-application", () => ({
  loadSubmittedOwnerApplicationsForReview: loadApplications,
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
  unstable_rethrow: unstableRethrow,
}));

import OwnerApplicationReviewPage from "./page";

describe("Owner Application administrator review page", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("reports an authorization provider outage as unavailable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    resolveContext.mockResolvedValue({
      userId: "10000000-0000-4000-8000-000000000001",
      role: "platform_administrator",
    });
    createClient.mockResolvedValue({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: new Error("provider unavailable"),
      }),
    });

    render(
      await OwnerApplicationReviewPage({
        params: Promise.resolve({ locale: "en" }),
      }),
    );

    expect(
      screen.getByText("The private review queue is temporarily unavailable."),
    ).toBeVisible();
    expect(
      screen.queryByText("Sign in and complete administrator MFA to continue."),
    ).not.toBeInTheDocument();
    expect(loadApplications).not.toHaveBeenCalled();
  });

  it("fails closed on a malformed pagination cursor", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      await OwnerApplicationReviewPage({
        params: Promise.resolve({ locale: "en" }),
        searchParams: Promise.resolve({
          afterSubmittedAt: "Fri, 14 Aug 2026 10:00:00 GMT(foo)",
          afterApplicationId: "20000000-0000-4000-8000-000000000001",
        }),
      }),
    );

    expect(
      screen.getByText("The private review queue is temporarily unavailable."),
    ).toBeVisible();
    expect(createClient).not.toHaveBeenCalled();
    expect(loadApplications).not.toHaveBeenCalled();
  });

  it("preserves a lossless PostgreSQL timestamp cursor", async () => {
    resolveContext.mockResolvedValue({
      userId: "10000000-0000-4000-8000-000000000001",
      role: "platform_administrator",
    });
    const client = {
      rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
    };
    createClient.mockResolvedValue(client);
    loadApplications.mockResolvedValue({
      applications: [],
      nextCursor: null,
    });

    render(
      await OwnerApplicationReviewPage({
        params: Promise.resolve({ locale: "en" }),
        searchParams: Promise.resolve({
          afterSubmittedAt: "2026-08-14T10:00:00.123456Z",
          afterApplicationId: "20000000-0000-4000-8000-000000000001",
        }),
      }),
    );

    expect(loadApplications).toHaveBeenCalledWith(client, {
      submittedAt: "2026-08-14T10:00:00.123456Z",
      applicationId: "20000000-0000-4000-8000-000000000001",
    });
  });
});
