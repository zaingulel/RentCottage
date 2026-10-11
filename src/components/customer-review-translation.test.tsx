import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { translate, report } = vi.hoisted(() => ({
  translate: vi.fn(),
  report: vi.fn(),
}));

vi.mock("@/customer-review/actions", () => ({
  translateCustomerReview: translate,
  reportCustomerReviewTranslation: report,
}));

import { customerReviewMessages } from "@/i18n/customer-review-messages";

import { CustomerReviewTranslation } from "./customer-review-translation";

const publicSlug = "cottage-11111111111111111111111111111111";
const reviewId = "11111111-1111-4111-8111-111111111111";
const translationId = "22222222-2222-4222-8222-222222222222";

function island(
  props: Partial<Parameters<typeof CustomerReviewTranslation>[0]> = {},
) {
  return (
    <CustomerReviewTranslation
      locale="en"
      publicSlug={publicSlug}
      reviewId={reviewId}
      subject="review"
      originalLanguage="ar"
      originalBody="مكان هادئ"
      translation={undefined}
      canAct={false}
      {...props}
    />
  );
}

const stored = {
  translationId,
  targetLanguage: "en",
  translatedBody: "A quiet place",
} as const;

describe("CustomerReviewTranslation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    translate.mockResolvedValue({ status: "unavailable" });
    report.mockResolvedValue({ status: "reported" });
  });

  it.each([
    ["en", "ltr", "ar", "مكان هادئ", "A quiet place"],
    ["ar", "rtl", "en", "A calm place", "مكان هادئ"],
    ["ckb", "rtl", "en", "A calm place", "شوێنێکی ئارام"],
  ] as const)(
    "shows the stored translation in the reader's language and direction, and the untouched original, in %s",
    async (
      locale,
      direction,
      originalLanguage,
      originalBody,
      translatedBody,
    ) => {
      const copy = customerReviewMessages[locale];
      const user = userEvent.setup();
      render(
        island({
          locale,
          originalLanguage,
          originalBody,
          translation: { ...stored, targetLanguage: locale, translatedBody },
        }),
      );

      expect(
        screen.getByText(
          `${copy.automaticTranslation} · ${copy.fictionalTranslation}`,
        ),
      ).toHaveClass("translation-label");
      const generated = screen.getByText(translatedBody);
      expect(generated).toHaveAttribute("lang", locale);
      expect(generated).toHaveAttribute("dir", direction);
      expect(screen.queryByText(originalBody)).toBeNull();

      await user.click(screen.getByRole("button", { name: copy.viewOriginal }));
      const original = screen.getByText(originalBody);
      expect(original).toHaveAttribute("lang", originalLanguage);
      expect(original).toHaveAttribute("dir", "auto");
      expect(screen.queryByText(translatedBody)).toBeNull();
      expect(
        screen.queryByText(
          `${copy.automaticTranslation} · ${copy.fictionalTranslation}`,
        ),
      ).toBeNull();

      await user.click(
        screen.getByRole("button", { name: copy.viewTranslation }),
      );
      expect(screen.getByText(translatedBody)).toHaveAttribute("lang", locale);
    },
  );

  it("offers no control for a reader who may not act and has nothing stored", () => {
    render(island());

    const original = screen.getByText("مكان هادئ");
    expect(original).toHaveAttribute("lang", "ar");
    expect(original).toHaveAttribute("dir", "auto");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText(/Automatic translation/)).toBeNull();
  });

  it("offers Translate and no Report to a reader who may act when nothing is stored", () => {
    render(island({ canAct: true }));

    expect(screen.getByRole("button", { name: "Translate" })).toBeVisible();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("offers View original and no Translate or Report to a reader who may not act", () => {
    render(island({ translation: stored }));

    expect(screen.getByRole("button", { name: "View original" })).toBeVisible();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("offers Report only while the translation is on screen", async () => {
    const user = userEvent.setup();
    render(island({ translation: stored, canAct: true }));

    expect(
      screen.getByRole("button", { name: "Report poor translation" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "View original" }));
    expect(
      screen.queryByRole("button", { name: "Report poor translation" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "View translation" }),
    ).toBeVisible();
  });

  it("translates on request, shows the label, and keeps focus on the first control across every switch", async () => {
    translate.mockResolvedValue({
      status: "translated",
      translationId,
      translatedBody: "A quiet place",
    });
    const user = userEvent.setup();
    render(island({ canAct: true }));

    const first = screen.getByRole("button", { name: "Translate" });
    await user.click(first);

    expect(translate).toHaveBeenCalledWith({
      locale: "en",
      publicSlug,
      reviewId,
      subject: "review",
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "View original" }),
      ).toBeEnabled(),
    );
    expect(screen.getByRole("button", { name: "View original" })).toBe(first);
    expect(first).toHaveFocus();
    expect(screen.getByText("A quiet place")).toHaveAttribute("lang", "en");
    expect(
      screen.getByText(
        "Automatic translation · Fictional local-test translation",
      ),
    ).toBeVisible();

    await user.click(first);
    expect(screen.getByRole("button", { name: "View translation" })).toBe(
      first,
    );
    expect(first).toHaveFocus();

    await user.click(first);
    expect(screen.getByRole("button", { name: "View original" })).toBe(first);
    expect(first).toHaveFocus();
  });

  it("returns focus to the switching button when the reported translation's Report button leaves the page", async () => {
    const user = userEvent.setup();
    render(island({ translation: stored, canAct: true }));

    screen.getByRole("button", { name: "Report poor translation" }).focus();
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Translation reported.",
    );
    expect(screen.getByRole("button", { name: "View original" })).toHaveFocus();
  });

  it("leaves focus where the reader moved it while a translation was pending", async () => {
    let finish: (value: unknown) => void = () => {};
    translate.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const user = userEvent.setup();
    render(
      <>
        {island({ canAct: true })}
        <button type="button">Elsewhere</button>
      </>,
    );

    await user.click(screen.getByRole("button", { name: "Translate" }));
    const elsewhere = screen.getByRole("button", { name: "Elsewhere" });
    elsewhere.focus();
    finish({
      status: "translated",
      translationId,
      translatedBody: "A quiet place",
    });

    expect(
      await screen.findByRole("button", { name: "View original" }),
    ).toBeEnabled();
    expect(elsewhere).toHaveFocus();
  });

  it.each([
    [
      { status: "unavailable" },
      "Translation is unavailable. Showing the original.",
    ],
    [
      { status: "blocked" },
      "Translation is unavailable. Showing the original.",
    ],
    [
      { status: "not-found" },
      "Translation is unavailable. Showing the original.",
    ],
    [
      { status: "access-required" },
      "Translating and reporting need a signed-in account with a verified phone number.",
    ],
  ])(
    "keeps the original and says so when translating answers %j",
    async (result, message) => {
      translate.mockResolvedValue(result);
      const user = userEvent.setup();
      render(island({ canAct: true }));

      await user.click(screen.getByRole("button", { name: "Translate" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(screen.getByText("مكان هادئ")).toHaveAttribute("lang", "ar");
      expect(screen.getByRole("button", { name: "Translate" })).toBeEnabled();
      expect(screen.queryByText(/Automatic translation/)).toBeNull();
    },
  );

  it("keeps the original and says so when the translate action throws", async () => {
    translate.mockRejectedValue(new Error("network"));
    const user = userEvent.setup();
    render(island({ canAct: true }));

    await user.click(screen.getByRole("button", { name: "Translate" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Translation is unavailable. Showing the original.",
    );
    expect(screen.getByText("مكان هادئ")).toBeVisible();
  });

  it("reports the translation on screen and then removes the Report control", async () => {
    const user = userEvent.setup();
    render(island({ translation: stored, canAct: true, subject: "reply" }));

    await user.click(
      screen.getByRole("button", { name: "Report poor translation" }),
    );

    expect(report).toHaveBeenCalledWith({ translationId });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Translation reported.",
    );
    expect(
      screen.queryByRole("button", { name: "Report poor translation" }),
    ).toBeNull();
    expect(screen.getByText("A quiet place")).toBeVisible();
  });

  it.each([
    [
      { status: "unavailable" },
      "The report could not be confirmed. Try again.",
    ],
    [{ status: "not-found" }, "The report could not be confirmed. Try again."],
    [
      { status: "access-required" },
      "Translating and reporting need a signed-in account with a verified phone number.",
    ],
  ])(
    "keeps the translation and the Report control when reporting answers %j",
    async (result, message) => {
      report.mockResolvedValue(result);
      const user = userEvent.setup();
      render(island({ translation: stored, canAct: true }));

      await user.click(
        screen.getByRole("button", { name: "Report poor translation" }),
      );

      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(screen.getByText("A quiet place")).toBeVisible();
      expect(
        screen.getByRole("button", { name: "Report poor translation" }),
      ).toBeEnabled();
    },
  );

  it("keeps the translation and says the report could not be confirmed when the report action throws", async () => {
    report.mockRejectedValue(new Error("network"));
    const user = userEvent.setup();
    render(island({ translation: stored, canAct: true }));

    await user.click(
      screen.getByRole("button", { name: "Report poor translation" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The report could not be confirmed. Try again.",
    );
  });

  it("renders hostile generated translation text as text, never markup", () => {
    const hostile = "<img src=x onerror=alert(1)>";
    const { container } = render(
      island({
        locale: "ar",
        originalLanguage: "en",
        originalBody: "A calm place",
        translation: {
          translationId,
          targetLanguage: "ar",
          translatedBody: hostile,
        },
      }),
    );

    expect(screen.getByText(hostile)).toBeVisible();
    expect(screen.getByText(hostile)).toHaveAttribute("lang", "ar");
    expect(container.querySelector("img")).toBeNull();
  });
});
