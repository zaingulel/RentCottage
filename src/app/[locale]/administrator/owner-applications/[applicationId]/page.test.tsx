import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClient, loadDetail, resolveContext, unstableRethrow } =
  vi.hoisted(() => ({
    createClient: vi.fn(),
    loadDetail: vi.fn(),
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
vi.mock("@/owner-application/supabase-owner-application-review", () => ({
  loadOwnerApplicationReviewDetail: loadDetail,
}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
  unstable_rethrow: unstableRethrow,
}));

import OwnerApplicationReviewDetailPage from "./page";

describe("Owner Application administrator detail page", () => {
  beforeEach(() => vi.clearAllMocks());

  it("logs a structured privacy-safe load failure", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    resolveContext.mockResolvedValue({
      userId: "10000000-0000-4000-8000-000000000001",
      role: "platform_administrator",
    });
    createClient.mockResolvedValue({
      rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
    });
    loadDetail.mockRejectedValue(
      new Error("provider failed for private@example.test"),
    );

    render(
      await OwnerApplicationReviewDetailPage({
        params: Promise.resolve({
          locale: "en",
          applicationId: "20000000-0000-4000-8000-000000000001",
        }),
      }),
    );

    expect(
      screen.getByText("The review action is temporarily unavailable."),
    ).toBeVisible();
    expect(consoleError).toHaveBeenCalledWith(
      "Owner Application review detail load failed",
      {
        phase: "owner_application_review_detail_load",
        result: "unavailable",
      },
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
      "20000000-0000-4000-8000-000000000001",
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
      "private@example.test",
    );
  });
});
