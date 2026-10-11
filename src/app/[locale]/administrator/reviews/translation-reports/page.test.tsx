import { cleanup, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createReview,
  listTranslationReports,
  notFound,
  redirect,
  resolveAccount,
  unstableRethrow,
} = vi.hoisted(() => ({
  createReview: vi.fn(),
  listTranslationReports: vi.fn(),
  notFound: vi.fn(),
  redirect: vi.fn(),
  resolveAccount: vi.fn(),
  unstableRethrow: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound,
  redirect,
  unstable_rethrow: unstableRethrow,
}));
vi.mock("@/access/request-account-context", () => ({
  resolveRequestAccount: resolveAccount,
}));
vi.mock("@/customer-review/request-customer-review", () => ({
  createRequestCustomerReview: createReview,
}));

import AdministratorTranslationReportsPage from "./page";

const administrator = {
  status: "authenticated",
  context: { userId: "administrator-1", role: "platform_administrator" },
};

const cursor = {
  beforeAt: "2026-10-12T10:00:00.000Z",
  beforeId: "11111111-1111-4111-8111-111111111111",
};

const reportItem = {
  reportId: "22222222-2222-4222-8222-222222222222",
  bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
  subject: "review",
  originalLanguage: "ar",
  originalBody: "مكان هادئ",
  targetLanguage: "en",
  translatedBody: "A quiet place",
  provider: "local-test-provider",
  model: "local-test-model",
  promptVersion: "review-translation-v1",
  reportedAt: "2026-10-12T11:00:00.000Z",
};

function open(
  query: Record<string, string | string[] | undefined> = {},
  locale = "en",
) {
  return AdministratorTranslationReportsPage({
    params: Promise.resolve({ locale }),
    searchParams: Promise.resolve(query),
  });
}

describe("AdministratorTranslationReportsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createReview.mockResolvedValue({ listTranslationReports });
  });

  it("the review translation reports page redirects a signed-out visitor to administrator access and shows a non-administrator no report", async () => {
    const signal = new Error("NEXT_REDIRECT");
    resolveAccount.mockResolvedValue({ status: "signed_out" });
    redirect.mockImplementation(() => {
      throw signal;
    });

    await expect(open()).rejects.toBe(signal);

    expect(redirect).toHaveBeenCalledWith(
      "/en/administrator/access?returnTo=%2Fen%2Fadministrator%2Freviews",
    );
    expect(createReview).not.toHaveBeenCalled();

    for (const context of [
      { userId: "customer-1", role: "customer" },
      { userId: "owner-1", role: "cottage_owner", approvalState: "approved" },
    ]) {
      resolveAccount.mockResolvedValue({ status: "authenticated", context });
      const { unmount } = render(await open());

      expect(
        screen.getByText(
          "Authenticator-verified administrator access is required.",
        ),
      ).toBeVisible();
      expect(screen.queryByRole("article")).toBeNull();
      expect(createReview).not.toHaveBeenCalled();
      expect(listTranslationReports).not.toHaveBeenCalled();
      unmount();
    }
  });

  it("renders unavailable when request account resolution is unavailable", async () => {
    resolveAccount.mockResolvedValue({ status: "unavailable" });

    render(await open());

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Reviews are unavailable. Refresh and try again.",
    );
    expect(createReview).not.toHaveBeenCalled();
  });

  it("reads a 20-report page for an administrator and shows each report", async () => {
    resolveAccount.mockResolvedValue(administrator);
    listTranslationReports.mockResolvedValue({
      status: "success",
      items: [reportItem],
      nextCursor: null,
    });

    render(await open());

    expect(listTranslationReports).toHaveBeenCalledWith({
      beforeAt: null,
      beforeId: null,
      limit: 20,
    });
    expect(screen.getByText("A quiet place")).toBeVisible();
    expect(screen.getByText("مكان هادئ")).toBeVisible();
  });

  it("passes an accepted cursor to the reader", async () => {
    resolveAccount.mockResolvedValue(administrator);
    listTranslationReports.mockResolvedValue({
      status: "success",
      items: [],
      nextCursor: null,
    });

    render(await open(cursor));

    expect(listTranslationReports).toHaveBeenCalledWith({
      ...cursor,
      limit: 20,
    });
  });

  it("tells the reports list when the page is a continued one", async () => {
    resolveAccount.mockResolvedValue(administrator);
    listTranslationReports.mockResolvedValue({
      status: "success",
      items: [],
      nextCursor: null,
    });

    render(await open(cursor));
    expect(screen.getByRole("link", { name: /First reports/ })).toHaveAttribute(
      "href",
      "/en/administrator/reviews/translation-reports",
    );
    cleanup();

    render(await open());
    expect(screen.queryByRole("link", { name: /First reports/ })).toBeNull();
  });

  it("keeps SQL assurance decisive when the reader refuses an administrator", async () => {
    resolveAccount.mockResolvedValue(administrator);
    listTranslationReports.mockResolvedValue({ status: "access-required" });

    render(await open());

    expect(
      screen.getByRole("link", { name: "Complete administrator access" }),
    ).toHaveAttribute(
      "href",
      "/en/administrator/access?returnTo=%2Fen%2Fadministrator%2Freviews",
    );
  });

  it("renders unavailable when the report read fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    resolveAccount.mockResolvedValue(administrator);
    listTranslationReports.mockRejectedValue(new Error("database unavailable"));

    render(await open());

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Reviews are unavailable. Refresh and try again.",
    );
  });

  it("renders unavailable when the reader is not configured", async () => {
    resolveAccount.mockResolvedValue(administrator);
    createReview.mockResolvedValue(undefined);

    render(await open());

    expect(screen.getByRole("alert")).toBeVisible();
  });

  it.each([
    [{ foo: "1" }],
    [{ state: "hidden" }],
    [{ beforeAt: [cursor.beforeAt], beforeId: cursor.beforeId }],
    [{ beforeAt: undefined }],
    [{ beforeAt: cursor.beforeAt }],
    [{ beforeId: cursor.beforeId }],
    [{ beforeAt: "invalid", beforeId: "invalid" }],
  ])("fails closed on the unaccepted query %j", async (query) => {
    const signal = new Error("NEXT_NOT_FOUND");
    notFound.mockImplementation(() => {
      throw signal;
    });

    await expect(open(query)).rejects.toBe(signal);

    expect(resolveAccount).not.toHaveBeenCalled();
    expect(listTranslationReports).not.toHaveBeenCalled();
  });

  it("fails closed on an unknown locale", async () => {
    const signal = new Error("NEXT_NOT_FOUND");
    notFound.mockImplementation(() => {
      throw signal;
    });

    await expect(open({}, "fr")).rejects.toBe(signal);

    expect(resolveAccount).not.toHaveBeenCalled();
  });
});
