import { bookingRequestPaymentRecoveryMessages } from "../src/i18n/booking-request-status-messages";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { build } from "esbuild";

import { readApplicationStylesheet } from "./fixtures/application-stylesheet";

declare global {
  interface Window {
    renderBookingRequestDisplay: (input: {
      locale: "en" | "ar" | "ckb";
      role: "customer" | "owner";
      recovery?: "available" | "processing" | "retryable";
      status:
        | "capture-processing"
        | "payment-required-open"
        | "payment-required-elapsed"
        | "payment-expiry-processing"
        | "payment-expiry-attention-required"
        | "payment-expiry-expired"
        | "payment-correction-refunding"
        | "payment-correction-quarantined"
        | "payment-correction-expired"
        | "payment-correction-released-review"
        | "paid-confirmed";
    }) => void;
  }
}

async function mountBookingRequestDisplay(
  page: Page,
  testInfo: TestInfo,
): Promise<void> {
  const bundlePath = testInfo.outputPath("booking-request-display.js");
  await build({
    entryPoints: ["tests/fixtures/booking-request-display.browser.tsx"],
    outfile: bundlePath,
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
    plugins: [
      {
        name: "replace-booking-request-server-action",
        setup(pluginBuild) {
          pluginBuild.onResolve({ filter: /^next\/navigation$/ }, () => ({
            path: "fixture-router",
            namespace: "router-fixture",
          }));
          pluginBuild.onLoad(
            { filter: /.*/, namespace: "router-fixture" },
            () => ({
              contents: "export const useRouter = () => ({ refresh() {} });",
              loader: "ts",
            }),
          );
          pluginBuild.onResolve(
            {
              filter:
                /booking-request\/(lifecycle-actions|payment-recovery-actions)$/,
            },
            () => ({
              path: "booking-request-server-action",
              namespace: "fixture",
            }),
          );
          pluginBuild.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents:
              "export async function actOnBookingRequest() { throw new Error('Fixture actions are unavailable'); } export async function recoverBookingRequestPayment() { throw new Error('Fixture actions are unavailable'); }",
            loader: "ts",
          }));
        },
      },
    ],
  });
  await page.goto("/api/health");
  await page.setContent(
    '<meta name="viewport" content="width=device-width, initial-scale=1"><main id="fixture-root"></main>',
  );
  await page.addStyleTag({ content: await readApplicationStylesheet() });
  await page.addScriptTag({ path: bundlePath });
}

test("real Customer and Cottage Owner payment states stay semantic and within the viewport", async ({
  page,
}, testInfo) => {
  await mountBookingRequestDisplay(page, testInfo);

  for (const locale of [
    {
      name: "en",
      refunding: "Payment is being returned",
      quarantined: "Payment needs review",
      refunded: "Expired — payment returned",
      attention: "could not yet be verified",
      expired: "Expired unpaid",
      released: "authorisations have been released",
      processing: "Payment confirmation pending",
      confirmed: "Booking confirmed",
      paymentRequired: "Payment Required",
      paymentDeadline: "Payment deadline",
      open: [
        "Automatic payment failed",
        "The Customer’s automatic payment failed",
      ],
      elapsed: [
        "The payment deadline has passed",
        "The Customer payment deadline has passed",
      ],
      held: "remain held",
      unconfirmed: "not confirmed",
    },
    {
      name: "ar",
      refunding: "جارٍ إرجاع المبلغ",
      quarantined: "الدفع يحتاج إلى مراجعة",
      refunded: "انتهى الطلب — تم إرجاع الدفع",
      attention: "لم نتمكن بعد من التحقق",
      expired: "انتهى الطلب دون دفع",
      released: "تم تحرير تفويضات الدفع",
      processing: "بانتظار تأكيد الدفع",
      confirmed: "تم تأكيد الحجز",
      paymentRequired: "الدفع مطلوب",
      paymentDeadline: "موعد الدفع",
      open: ["فشل الدفع التلقائي", "فشل الدفع التلقائي للعميل"],
      elapsed: ["انتهى موعد الدفع", "انتهى موعد دفع العميل"],
      held: "محجوزة",
      unconfirmed: "غير مؤكد",
    },
    {
      name: "ckb",
      refunding: "پارەکە دەگەڕێندرێتەوە",
      quarantined: "پارەدان پێویستی بە پێداچوونەوە هەیە",
      refunded: "بەسەرچوو — پارەکە گەڕێندرایەوە",
      attention: "هێشتا نەمانتوانیوە",
      expired: "داواکارییەکە بەبێ پارەدان بەسەرچوو",
      released: "مۆڵەتەکانی پارەدان ئازاد کراون",
      processing: "چاوەڕێی پشتڕاستکردنەوەی پارەدان",
      confirmed: "حجز پشتڕاست کراوەتەوە",
      paymentRequired: "پارەدان پێویستە",
      paymentDeadline: "کاتی کۆتایی پارەدان",
      open: [
        "پارەدانی خۆکار سەرکەوتوو نەبوو",
        "پارەدانی خۆکاری کڕیار سەرکەوتوو نەبوو",
      ],
      elapsed: [
        "کاتی کۆتایی پارەدان تێپەڕی",
        "کاتی کۆتایی پارەدانی کڕیار تێپەڕی",
      ],
      held: "گیراو دەمێننەوە",
      unconfirmed: "پشتڕاست نەکراوەتەوە",
    },
  ] as const) {
    for (const role of ["customer", "owner"] as const) {
      for (const status of [
        "capture-processing",
        "payment-required-open",
        "payment-required-elapsed",
        "payment-expiry-processing",
        "payment-expiry-attention-required",
        "payment-expiry-expired",
        "payment-correction-refunding",
        "payment-correction-quarantined",
        "payment-correction-expired",
        "payment-correction-released-review",
        "paid-confirmed",
      ] as const) {
        await page.evaluate(
          (input) => window.renderBookingRequestDisplay(input),
          { locale: locale.name, role, status },
        );
        await expect(page.locator("html")).toHaveAttribute("lang", locale.name);
        await expect(page.locator("html")).toHaveAttribute(
          "dir",
          locale.name === "en" ? "ltr" : "rtl",
        );
        await expect(page.getByRole("status")).toContainText(
          status === "payment-correction-refunding"
            ? locale.refunding
            : status === "payment-correction-quarantined" ||
                status === "payment-correction-released-review"
              ? locale.quarantined
              : status === "payment-correction-expired"
                ? locale.refunded
                : status === "capture-processing"
                  ? locale.processing
                  : status === "payment-expiry-expired"
                    ? locale.expired
                    : status.startsWith("payment-")
                      ? locale.paymentRequired
                      : locale.confirmed,
        );
        if (status.startsWith("payment-correction-")) {
          await expect(page.getByRole("status")).toContainText(
            locale.unconfirmed,
          );
          if (
            status === "payment-correction-refunding" ||
            status === "payment-correction-quarantined"
          )
            await expect(page.getByRole("status")).toContainText(locale.held);
          await expect(page.getByRole("button")).toHaveCount(0);
          if (status !== "payment-correction-expired")
            await expect(page.getByRole("status")).not.toContainText(
              locale.refunded,
            );
        } else if (status.startsWith("payment-")) {
          await expect(
            page.getByText(locale.paymentDeadline, { exact: true }),
          ).toBeVisible();
          await expect(page.getByRole("status")).toContainText(
            status === "payment-expiry-expired"
              ? locale.released
              : status === "payment-expiry-attention-required"
                ? locale.attention
                : locale[
                    status === "payment-required-open" ? "open" : "elapsed"
                  ][role === "customer" ? 0 : 1],
          );
          if (status !== "payment-expiry-expired")
            await expect(page.getByRole("status")).toContainText(locale.held);
          else
            expect(
              await page
                .locator("dd")
                .filter({ hasText: locale.expired })
                .count(),
            ).toBe(1);
          await expect(page.getByRole("status")).toContainText(
            locale.unconfirmed,
          );
          const deadline = await page
            .getByText(locale.paymentDeadline, { exact: true })
            .locator("..")
            .innerText();
          const westernDigits = deadline.replace(/[٠-٩۰-۹]/g, (digit) =>
            String(digit.charCodeAt(0) - (digit <= "٩" ? 0x660 : 0x6f0)),
          );
          expect(westernDigits).toContain("12:20");
          await expect(page.getByRole("button")).toHaveCount(0);
        } else {
          await expect(
            page.getByText(locale.paymentDeadline, { exact: true }),
          ).toHaveCount(0);
        }
        await expect(page.getByRole("status")).toBeVisible();
        await expect(page.getByRole("button")).toHaveCount(0);
        await page.evaluate(() => document.fonts.ready);
        const dimensions = await page.evaluate(() => {
          const card = document.querySelector("article, section");
          if (!card) throw new Error("Booking Request card is missing");
          return {
            viewport: document.documentElement.clientWidth,
            document: document.documentElement.scrollWidth,
            cardWidth: card.clientWidth,
            cardContent: card.scrollWidth,
          };
        });
        expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
        expect(dimensions.cardContent).toBeLessThanOrEqual(
          dimensions.cardWidth,
        );
      }
    }
    for (const recovery of ["available", "processing", "retryable"] as const) {
      await page.evaluate(
        (input) => window.renderBookingRequestDisplay(input),
        {
          locale: locale.name,
          role: "customer" as const,
          status: "payment-required-open" as const,
          recovery,
        },
      );
      const copy = bookingRequestPaymentRecoveryMessages[locale.name];
      if (recovery === "processing") {
        await expect(
          page.getByText(copy.processing, { exact: true }),
        ).toBeVisible();
        await expect(page.getByRole("button")).toHaveCount(0);
      } else
        await expect(
          page.getByRole("button", {
            name: recovery === "available" ? copy.action : copy.retry,
          }),
        ).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      ).toBe(true);
    }
  }
});

test("Customer Booking Request status sits in the record page column under the header gap in every language", async ({
  page,
}, testInfo) => {
  if (testInfo.project.name === "mobile") {
    await page.setViewportSize({ width: 390, height: 844 });
  }
  await mountBookingRequestDisplay(page, testInfo);

  for (const locale of ["en", "ar", "ckb"] as const) {
    await page.evaluate((input) => window.renderBookingRequestDisplay(input), {
      locale,
      role: "customer" as const,
      status: "paid-confirmed" as const,
    });
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const measured = await page.evaluate(() => {
      const column = document.querySelector("main.page");
      const card = column?.querySelector(".customer-booking-request-status");
      const followUp = column?.querySelector(".request-follow-up");
      const fact = card?.querySelector(".fact-list > div");
      const label = fact?.querySelector("dt")?.getBoundingClientRect();
      const value = fact?.querySelector("dd")?.getBoundingClientRect();
      if (!column || !card || !followUp || !label || !value)
        throw new Error("Booking Request record page column is missing");
      const columnBox = column.getBoundingClientRect();
      column.classList.remove("page-record");
      const defaultWidth = column.getBoundingClientRect().width;
      column.classList.add("page-record");
      return {
        available: document.documentElement.clientWidth,
        document: document.documentElement.scrollWidth,
        columnStart: columnBox.left,
        columnTop: columnBox.top,
        columnWidth: columnBox.width,
        defaultWidth,
        cardTop: card.getBoundingClientRect().top,
        cardWidth: card.getBoundingClientRect().width,
        followUpWidth: followUp.getBoundingClientRect().width,
        labelTop: label.top,
        labelBottom: label.bottom,
        valueTop: value.top,
      };
    });
    if (testInfo.project.name === "mobile") {
      expect(measured.valueTop).toBeGreaterThanOrEqual(measured.labelBottom);
    } else {
      expect(measured.valueTop).toBeCloseTo(measured.labelTop, 0);
    }
    const columnWidth = Math.min(measured.available - 36, 760);
    expect(measured.columnWidth).toBeCloseTo(columnWidth, 0);
    expect(measured.defaultWidth).toBeCloseTo(
      Math.min(measured.available - 36, 1120),
      0,
    );
    expect(measured.columnStart).toBeCloseTo(
      (measured.available - columnWidth) / 2,
      0,
    );
    expect(measured.cardWidth).toBeCloseTo(columnWidth, 0);
    expect(measured.followUpWidth).toBeCloseTo(columnWidth, 0);
    expect(measured.cardTop - measured.columnTop).toBeCloseTo(32, 0);
    expect(measured.document).toBeLessThanOrEqual(measured.available);
  }
});

test("a long page title wraps on evenly spaced lines in every language", async ({
  page,
}, testInfo) => {
  if (testInfo.project.name === "mobile") {
    await page.setViewportSize({ width: 390, height: 844 });
  }
  await mountBookingRequestDisplay(page, testInfo);
  const size = (page.viewportSize()?.width ?? 0) <= 640 ? 26 : 34;
  const title = page.getByRole("heading", { level: 1 });
  let previousTitle = "";

  for (const locale of [
    {
      name: "en",
      ratio: 1.2,
      longTitle:
        "Booking Request status: you can send contact details once this booking has a valid payment",
    },
    {
      name: "ar",
      ratio: 1.2,
      longTitle:
        "حالة طلب الحجز: تعذر تحميل خيارات البحث الآن. هل يمكننا استخدام الحديقة؟",
    },
    {
      name: "ckb",
      ratio: 1.4,
      longTitle:
        "دۆخی داواکاری حجز: ئێستا ناتوانرێت هەڵبژاردەکانی گەڕان باربکرێن. نامە بۆ ئەم کۆتێجە بنێرە",
    },
  ] as const) {
    await page.evaluate((input) => window.renderBookingRequestDisplay(input), {
      locale: locale.name,
      role: "customer" as const,
      status: "paid-confirmed" as const,
    });
    await expect(page.locator("html")).toHaveAttribute("lang", locale.name);
    // The heading element persists across languages; its text changing shows the new render has landed.
    await expect(title).not.toHaveText(previousTitle);
    const originalTitle = await title.innerText();
    await title.evaluate((heading, text) => {
      heading.textContent = text;
    }, locale.longTitle);
    await page.evaluate(() => document.fonts.ready);
    const measured = await title.evaluate((heading, fontSize) => {
      const style = getComputedStyle(heading);
      return {
        fontFamily: style.fontFamily,
        fontWeight: style.fontWeight,
        fontSize: parseFloat(style.fontSize),
        lineHeight: parseFloat(style.lineHeight),
        changaLoaded: document.fonts.check(
          `700 ${fontSize}px Changa`,
          heading.textContent,
        ),
        height: heading.getBoundingClientRect().height,
        titleWidth: heading.clientWidth,
        titleContent: heading.scrollWidth,
        available: document.documentElement.clientWidth,
        document: document.documentElement.scrollWidth,
      };
    }, size);
    expect(measured.fontFamily).toContain("Changa");
    expect(measured.fontWeight).toBe("700");
    expect(measured.fontSize).toBe(size);
    expect(measured.changaLoaded).toBe(true);
    expect(measured.lineHeight / measured.fontSize).toBeCloseTo(
      locale.ratio,
      2,
    );
    const lines = measured.height / measured.lineHeight;
    expect(Math.round(lines)).toBeGreaterThanOrEqual(2);
    expect(Math.abs(lines - Math.round(lines))).toBeLessThan(0.05);
    expect(measured.titleContent).toBeLessThanOrEqual(measured.titleWidth);
    expect(measured.document).toBeLessThanOrEqual(measured.available);
    if (testInfo.project.name === "mobile") {
      await title.screenshot({
        path: testInfo.outputPath(`page-title-${locale.name}.png`),
      });
    }
    await title.evaluate((heading, text) => {
      heading.textContent = text;
    }, originalTitle);
    previousTitle = originalTitle;
  }
});

test("a messaging card keeps its side borders and corners inside the page column at phone width", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mountBookingRequestDisplay(page, testInfo);
  await page.evaluate(() => {
    document.body.insertAdjacentHTML(
      "beforeend",
      '<main class="results-page page page-record"><section class="messaging-shell" data-testid="inside"></section></main>' +
        '<main class="results-page"><section class="messaging-shell" data-testid="outside"></section></main>',
    );
  });

  const measured = await page.evaluate(() =>
    ["inside", "outside"].map((name) => {
      const card = document.querySelector(`[data-testid="${name}"]`);
      if (!card) throw new Error(`Messaging card ${name} is missing`);
      const style = getComputedStyle(card);
      return {
        borderStart: style.borderInlineStartWidth,
        borderEnd: style.borderInlineEndWidth,
        radius: style.borderStartStartRadius,
      };
    }),
  );
  expect(measured).toEqual([
    { borderStart: "1px", borderEnd: "1px", radius: "10px" },
    { borderStart: "0px", borderEnd: "0px", radius: "0px" },
  ]);
});
