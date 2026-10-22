import { unstable_rethrow } from "next/navigation";

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { listPublic, notFound, resolveAccount } = vi.hoisted(() => ({
  listPublic: vi.fn(),
  resolveAccount: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("not-found");
  }),
}));

vi.mock("next/navigation", () => ({ notFound, unstable_rethrow: vi.fn() }));
vi.mock("@/access/request-account-context", () => ({
  resolveRequestAccount: resolveAccount,
}));
vi.mock("@/customer-review/actions", () => ({
  translateCustomerReview: vi.fn(),
  reportCustomerReviewTranslation: vi.fn(),
}));
vi.mock("@/customer-review/request-customer-review", () => ({
  createRequestCustomerReview: vi.fn().mockResolvedValue({ listPublic }),
}));

import { createRequestCustomerReview } from "@/customer-review/request-customer-review";

import PublicCustomerReviewsPage from "./page";

describe("PublicCustomerReviewsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveAccount.mockResolvedValue({ status: "signed_out" });
  });

  it("requests a 20-review page from an anonymous validated cursor", async () => {
    listPublic.mockResolvedValue({
      status: "success",
      items: [],
      nextCursor: null,
    });
    render(
      await PublicCustomerReviewsPage({
        params: Promise.resolve({
          locale: "en",
          slug: "cottage-11111111111111111111111111111111",
        }),
        searchParams: Promise.resolve({
          beforeAt: "2026-09-21T12:00:00.000Z",
          beforeId: "11111111-1111-4111-8111-111111111111",
        }),
      }),
    );
    expect(listPublic).toHaveBeenCalledWith({
      publicSlug: "cottage-11111111111111111111111111111111",
      beforeAt: "2026-09-21T12:00:00.000Z",
      beforeId: "11111111-1111-4111-8111-111111111111",
      limit: 20,
    });
    expect(screen.getByText("No reviews yet.")).toBeVisible();
  });

  it("rejects a partial or extra pagination query", async () => {
    await expect(
      PublicCustomerReviewsPage({
        params: Promise.resolve({
          locale: "en",
          slug: "cottage-11111111111111111111111111111111",
        }),
        searchParams: Promise.resolve({
          beforeAt: "2026-09-21T12:00:00.000Z",
        }),
      }),
    ).rejects.toThrow("not-found");
    expect(listPublic).not.toHaveBeenCalled();
  });

  const slug = "cottage-11111111111111111111111111111111";
  const arabicReview = {
    reviewId: "11111111-1111-4111-8111-111111111111",
    rating: 5,
    originalLanguage: "ar",
    originalBody: "مكان هادئ",
    submittedAt: "2026-09-21T12:00:00.000Z",
    ownerReply: null,
    translations: [],
  };

  async function renderPage(items: readonly unknown[] = [arabicReview]) {
    listPublic.mockResolvedValue({
      status: "success",
      items,
      nextCursor: null,
    });
    render(
      await PublicCustomerReviewsPage({
        params: Promise.resolve({ locale: "en", slug }),
        searchParams: Promise.resolve({}),
      }),
    );
  }

  it("sends a signed-out reader to sign in from the cottage page and draws no translation control", async () => {
    await renderPage();

    expect(
      screen.getByRole("link", {
        name: "Sign in to translate or report a translation",
      }),
    ).toHaveAttribute(
      "href",
      `/en/access?returnTo=${encodeURIComponent(`/en/cottages/${slug}`)}`,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it.each([
    ["a Customer", { userId: "u1", role: "customer" }],
    [
      "a Cottage Owner",
      { userId: "u2", role: "cottage_owner", approvalState: "approved" },
    ],
  ])("offers Translate to %s", async (_name, context) => {
    resolveAccount.mockResolvedValue({ status: "authenticated", context });
    await renderPage();

    expect(screen.getByRole("button", { name: "Translate" })).toBeVisible();
    expect(screen.queryByRole("link", { name: /Sign in/ })).toBeNull();
  });

  it.each([
    [
      "a Platform Administrator",
      {
        status: "authenticated",
        context: { userId: "u3", role: "platform_administrator" },
      },
    ],
    [
      "an authenticated account with no context",
      { status: "authenticated", context: undefined },
    ],
    ["an unavailable account", { status: "unavailable" }],
  ])(
    "offers no translation control and no sign-in link to %s",
    async (_name, account) => {
      resolveAccount.mockResolvedValue(account);
      await renderPage();

      expect(screen.getByText("مكان هادئ")).toBeVisible();
      expect(screen.queryByRole("button")).toBeNull();
      expect(screen.queryByRole("link", { name: /Sign in/ })).toBeNull();
    },
  );
});

it("DEBUG833 correlates route outcomes without exposing request data", async () => {
  const fixtureSlug = "cottage-20000000000040008000000000007701";
  const secret = "DEBUG833_ROUTE_SECRET\nprivate-address-cookie";
  const createReviews = vi.mocked(createRequestCustomerReview);
  const rethrow = vi.mocked(unstable_rethrow);
  const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  const requestIds = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  ] as const;
  const uuid = vi.spyOn(crypto, "randomUUID").mockReturnValue(requestIds[0]);
  const invoke = (locale = "en", slug = fixtureSlug, query = {}) =>
    PublicCustomerReviewsPage({
      params: Promise.resolve({ locale, slug }),
      searchParams: Promise.resolve(query),
    });
  const input = {
    publicSlug: fixtureSlug,
    beforeAt: null,
    beforeId: null,
    limit: 20,
  };
  const event = (
    stage: string,
    category: string,
    code?: string,
    locale = "en",
    requestId: string = requestIds[0],
  ) => [
    "[DEBUG-833]",
    {
      requestId,
      locale,
      fixture: "desktop-owner-reply",
      stage,
      category,
      ...(code === undefined ? {} : { code }),
    },
  ];
  try {
    vi.clearAllMocks();
    vi.stubEnv("APP_ENVIRONMENT", "test");
    resolveAccount.mockResolvedValue({ status: "signed_out" });
    createReviews.mockResolvedValue({ listPublic } as never);
    const success = { status: "success", items: [], nextCursor: null };
    listPublic.mockImplementation(async (_input, diagnostic) => {
      diagnostic?.("success");
      return success;
    });
    uuid.mockReturnValueOnce(requestIds[0]).mockReturnValueOnce(requestIds[1]);
    const [english, arabic] = await Promise.all([invoke(), invoke("ar")]);
    expect(english.props.result).toEqual(success);
    expect(arabic.props.result).toEqual(success);
    expect(listPublic).toHaveBeenCalledTimes(2);
    expect(listPublic).toHaveBeenNthCalledWith(1, input, expect.any(Function));
    expect(listPublic).toHaveBeenNthCalledWith(2, input, expect.any(Function));
    expect(errorLog.mock.calls).toEqual(
      expect.arrayContaining([
        event("list", "success"),
        event("result", "success"),
        event("list", "success", undefined, "ar", requestIds[1]),
        event("result", "success", undefined, "ar", requestIds[1]),
      ]),
    );
    expect(errorLog).toHaveBeenCalledTimes(4);

    for (const [category, code, emittedCode, status] of [
      ["rpc-error", "57014", "57014", "unavailable"],
      ["rpc-error", secret, "unclassified", "unavailable"],
      ["rpc-error", "XX000\n", "unclassified", "invalid"],
      ["reply-translations", undefined, undefined, "unavailable"],
      ["not-found", undefined, undefined, "not-found"],
    ] as const) {
      errorLog.mockClear();
      listPublic.mockClear();
      listPublic.mockImplementation(async (_input, diagnostic) => {
        diagnostic?.(category, code);
        return { status };
      });
      if (status === "not-found")
        await expect(invoke()).rejects.toThrow("not-found");
      else {
        const rendered = await invoke();
        expect(rendered.props.result).toEqual({ status: "unavailable" });
        const view = render(rendered);
        expect(view.getByRole("alert")).toHaveTextContent(
          "Reviews are unavailable. Refresh and try again.",
        );
        view.unmount();
      }
      expect(listPublic).toHaveBeenCalledExactlyOnceWith(
        input,
        expect.any(Function),
      );
      expect(errorLog.mock.calls).toEqual([
        event("list", category, emittedCode),
        event("result", status),
      ]);
    }

    for (const phase of ["setup", "list", "missing"] as const) {
      errorLog.mockClear();
      listPublic.mockClear();
      rethrow.mockClear();
      createReviews.mockResolvedValue({ listPublic } as never);
      if (phase === "setup") createReviews.mockRejectedValue(new Error(secret));
      else if (phase === "missing") createReviews.mockResolvedValue(undefined);
      else listPublic.mockRejectedValue(new Error(secret));
      const rendered = await invoke();
      expect(rendered.props.result).toEqual({ status: "unavailable" });
      expect(listPublic).toHaveBeenCalledTimes(phase === "list" ? 1 : 0);
      if (phase === "missing") {
        expect(errorLog.mock.calls).toEqual([
          event("setup", "reader-missing"),
          event("result", "unavailable"),
        ]);
        expect(rethrow).not.toHaveBeenCalled();
      } else {
        expect(errorLog.mock.calls).toEqual([
          event(phase, `${phase}-exception`),
          ["customer-review-public-list-unavailable"],
          event("result", "unavailable"),
        ]);
        expect(rethrow).toHaveBeenCalledOnce();
        expect(rethrow.mock.invocationCallOrder[0]).toBeLessThan(
          errorLog.mock.invocationCallOrder[0],
        );
      }
      expect(JSON.stringify(errorLog.mock.calls)).not.toContain(
        "DEBUG833_ROUTE_SECRET",
      );
    }

    errorLog.mockClear();
    const frameworkError = new Error("framework-control-flow");
    createReviews.mockRejectedValue(frameworkError);
    rethrow.mockImplementationOnce(() => {
      throw frameworkError;
    });
    await expect(invoke()).rejects.toBe(frameworkError);
    expect(errorLog).not.toHaveBeenCalled();

    for (const [environment, slug] of [
      ["production", fixtureSlug],
      ["test", "cottage-20000000000040008000000000007601"],
      ["test", "cottage-20000000000040008000000000007702"],
    ]) {
      vi.stubEnv("APP_ENVIRONMENT", environment);
      errorLog.mockClear();
      uuid.mockClear();
      listPublic.mockClear();
      createReviews.mockResolvedValue({ listPublic } as never);
      listPublic.mockResolvedValue(success);
      await invoke("en", slug);
      expect(listPublic).toHaveBeenCalledExactlyOnceWith({
        ...input,
        publicSlug: slug,
      });
      expect(errorLog).not.toHaveBeenCalled();
      expect(uuid).not.toHaveBeenCalled();
    }
    vi.stubEnv("APP_ENVIRONMENT", "test");
    errorLog.mockClear();
    listPublic.mockClear();
    await expect(invoke(secret)).rejects.toThrow("not-found");
    await expect(invoke("en", fixtureSlug, { cookie: secret })).rejects.toThrow(
      "not-found",
    );
    expect(listPublic).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
  } finally {
    errorLog.mockRestore();
    uuid.mockRestore();
    vi.unstubAllEnvs();
    createReviews.mockResolvedValue({ listPublic } as never);
    listPublic.mockReset();
    rethrow.mockReset();
  }
});
