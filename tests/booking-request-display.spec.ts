import { cottageProfileMessages } from "../src/i18n/cottage-profile-messages";
import { bookingRequestPaymentRecoveryMessages } from "../src/i18n/booking-request-status-messages";
import { ownerBookingRequestMessages } from "../src/i18n/owner-booking-request-messages";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { build } from "esbuild";
import { imageConfigDefault } from "next/dist/shared/lib/image-config.js";
import nextConfig from "../next.config";

import { readApplicationStylesheet } from "./fixtures/application-stylesheet";

declare global {
  interface Window {
    renderCottageEditorDisplay: (input: {
      locale: "en" | "ar" | "ckb";
      actor: "owner" | "administrator";
      state?: "draft" | "submitted" | "review" | "abandoned";
      longContent?: boolean;
      withHeader?: boolean;
    }) => void;
    renderPublicCottageDisplay: (input: {
      screen: "results" | "profile";
      locale: "en" | "ar" | "ckb";
      photoCount: 0 | 1 | 4 | 6;
      longContent?: boolean;
      withHeader?: boolean;
    }) => void;
    renderCottageOverviewDisplay: (input: {
      locale: "en" | "ar" | "ckb";
      actor: "owner" | "administrator";
    }) => void;
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

// What next/image renders for `fill`: an absolutely positioned image over its cover.
const coverPhotoMarkup =
  '<img alt="Cover photo of Cottage" src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" style="position:absolute;inset:0;width:100%;height:100%">';

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
    alias: { "next/image": "next/dist/esm/shared/lib/image-external.js" },
    define: {
      "process.env.NODE_ENV": '"production"',
      "process.env": "{}",
      "process.env.__NEXT_IMAGE_OPTS": JSON.stringify({
        ...imageConfigDefault,
        ...nextConfig.images,
      }),
    },
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
              contents:
                "export const useRouter = () => ({ refresh() {}, replace() {} }); export const usePathname = () => '/fixture'; export const useSearchParams = () => new URLSearchParams();",
              loader: "ts",
            }),
          );
          pluginBuild.onResolve(
            {
              filter:
                /(booking-request\/(lifecycle-actions|payment-recovery-actions)|cottage-profile\/actions|access\/actions)$/,
            },
            () => ({
              path: "booking-request-server-action",
              namespace: "fixture",
            }),
          );
          pluginBuild.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents:
              "export async function actOnBookingRequest() { throw new Error('Fixture actions are unavailable'); } export async function recoverBookingRequestPayment() { throw new Error('Fixture actions are unavailable'); } export async function createCottageProfileDraftAction() { throw new Error('Fixture actions are unavailable'); } export async function saveOwnerCottageProfileAction() { return { status: 'saved' }; } export async function saveAdministratorCottageProfileAction() { return { status: 'saved' }; } export async function uploadCottageProfilePhotoAction() { return { status: 'uploaded' }; } export async function deleteCottageProfilePhotoAction() { return { status: 'deleted' }; } export async function submitCottageProfileAction() { return { status: 'submitted' }; } export async function previewCottageProfilePhotoAction() { return { status: 'denied' }; } export async function signOutAccount() { throw new Error('Fixture actions are unavailable'); }",
            loader: "ts",
          }));
        },
      },
    ],
  });
  await page.goto("/api/health");
  await page.setContent(
    '<meta name="viewport" content="width=device-width, initial-scale=1"><div id="fixture-root"></div>',
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
        const requestButtons =
          role === "customer"
            ? page
                .locator(".customer-booking-request-status")
                .getByRole("button")
            : page.getByRole("button");
        if (status.startsWith("payment-correction-")) {
          await expect(page.getByRole("status")).toContainText(
            locale.unconfirmed,
          );
          if (
            status === "payment-correction-refunding" ||
            status === "payment-correction-quarantined"
          )
            await expect(page.getByRole("status")).toContainText(locale.held);
          await expect(requestButtons).toHaveCount(0);
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
          await expect(requestButtons).toHaveCount(0);
        } else {
          await expect(
            page.getByText(locale.paymentDeadline, { exact: true }),
          ).toHaveCount(0);
        }
        await expect(page.getByRole("status")).toBeVisible();
        await expect(requestButtons).toHaveCount(0);
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
        await expect(
          page.locator(".customer-booking-request-status").getByRole("button"),
        ).toHaveCount(0);
      } else
        await expect(
          page.locator(".customer-booking-request-status").getByRole("button", {
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

  for (const [locale, title] of [
    ["en", "Booking Request status"],
    ["ar", "حالة طلب الحجز"],
    ["ckb", "دۆخی داواکاری حجز"],
  ] as const) {
    await page.evaluate((input) => window.renderBookingRequestDisplay(input), {
      locale,
      role: "customer" as const,
      status: "paid-confirmed" as const,
    });
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // The language attribute changes before the page renders, so the title is
    // what shows this language's content is the one being measured.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    await page.evaluate(() => document.fonts.ready);
    const valueOffsetFromLabel = expect.poll(() =>
      page.evaluate((stacked) => {
        const fact = document.querySelector(
          "main.page .customer-booking-request-status .fact-list > div",
        );
        const label = fact?.querySelector("dt")?.getBoundingClientRect();
        const value = fact?.querySelector("dd")?.getBoundingClientRect();
        if (!label || !value)
          throw new Error("Booking Request fact list is missing");
        return value.top - (stacked ? label.bottom : label.top);
      }, testInfo.project.name === "mobile"),
    );
    if (testInfo.project.name === "mobile") {
      await valueOffsetFromLabel.toBeGreaterThanOrEqual(0);
    } else {
      await valueOffsetFromLabel.toBeCloseTo(0, 0);
    }
    const measured = await page.evaluate(() => {
      const column = document.querySelector("main.page");
      const card = column?.querySelector(".customer-booking-request-status");
      const followUp = column?.querySelector(".customer-request-messages");
      if (!column || !card || !followUp)
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
      };
    });
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
    await expect(
      page.locator(".customer-booking-request-status > .card"),
    ).toHaveCount(2);
    await expect(
      page.getByText("RC-REQ-AAAAAAAAAAAAAAAA", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("img")).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate((phone) => {
          const status = document.querySelector(
            ".customer-booking-request-status",
          );
          const title = status?.querySelector("h1");
          const progress = status?.querySelector(
            ".customer-booking-request-progress",
          );
          const details = status?.querySelector(
            ".customer-booking-request-details",
          );
          const total = details?.querySelector(
            ".customer-booking-request-total",
          );
          const messages = document.querySelector(".customer-request-messages");
          const row = messages?.querySelector(".request-follow-up");
          const heading = row?.querySelector("h2");
          const action = row?.querySelector("button");
          if (
            !status ||
            !title ||
            !progress ||
            !details ||
            !total ||
            !messages ||
            !row ||
            !heading ||
            !action
          )
            throw new Error("Customer status composition is missing");
          const statusBox = status.getBoundingClientRect();
          const progressBox = progress.getBoundingClientRect();
          const detailsBox = details.getBoundingClientRect();
          const messagesBox = messages.getBoundingClientRect();
          const headingBox = heading.getBoundingClientRect();
          const actionBox = action.getBoundingClientRect();
          const markers = [
            ...progress.querySelectorAll(".booking-request-progress-marker"),
          ].map((node) => node.getBoundingClientRect());
          const rowStyle = getComputedStyle(row);
          const totalStyle = getComputedStyle(total);
          const value = total.querySelector("dd")!;
          const band = progress.querySelector(".status-banner")!;
          const bandBox = band.getBoundingClientRect();
          const progressStyle = getComputedStyle(progress);
          return {
            statusBand:
              Math.abs(
                bandBox.top -
                  progressBox.top -
                  parseFloat(progressStyle.borderTopWidth),
              ) < 1 &&
              Math.abs(
                bandBox.left -
                  progressBox.left -
                  parseFloat(progressStyle.borderLeftWidth),
              ) < 1 &&
              Math.abs(
                progressBox.right -
                  bandBox.right -
                  parseFloat(progressStyle.borderRightWidth),
              ) < 1 &&
              getComputedStyle(band).borderRadius === "0px",
            fullWidth: [progressBox, detailsBox, messagesBox].every(
              (box) => Math.abs(box.width - statusBox.width) < 1,
            ),
            titleOutsideCards:
              title.closest(".card") === null &&
              title.getBoundingClientRect().bottom <= progressBox.top,
            separateGroups:
              progressBox.bottom <= detailsBox.top &&
              detailsBox.bottom <= messagesBox.top &&
              [progress, details, messages].every(
                (node) => getComputedStyle(node).boxShadow !== "none",
              ),
            totalBetweenRules:
              parseFloat(totalStyle.borderBlockStartWidth) >= 1 &&
              parseFloat(totalStyle.borderBlockEndWidth) >= 1 &&
              getComputedStyle(value).fontFamily.includes("Changa"),
            horizontalProgress:
              markers.length === 4 &&
              markers.every((box) => Math.abs(box.top - markers[0].top) < 1) &&
              markers.every(
                (box, index) =>
                  index === 0 ||
                  (document.documentElement.dir === "rtl"
                    ? box.right <= markers[index - 1].left
                    : box.left >= markers[index - 1].right),
              ),
            readableProgress: [
              ...progress.querySelectorAll(".booking-request-progress-name"),
            ].every((node) => node.scrollWidth <= node.clientWidth + 1),
            messagesRow: phone
              ? actionBox.top >= headingBox.bottom &&
                Math.abs(
                  actionBox.width -
                    (row.clientWidth -
                      parseFloat(rowStyle.paddingInlineStart) -
                      parseFloat(rowStyle.paddingInlineEnd)),
                ) < 1
              : document.documentElement.dir === "rtl"
                ? actionBox.right <= headingBox.left
                : actionBox.left >= headingBox.right,
            noOverflow:
              document.documentElement.scrollWidth <=
                document.documentElement.clientWidth &&
              [progress, details, messages].every(
                (node) => node.scrollWidth <= node.clientWidth,
              ),
          };
        }, testInfo.project.name === "mobile"),
      )
      .toEqual({
        statusBand: true,
        fullWidth: true,
        titleOutsideCards: true,
        separateGroups: true,
        totalBetweenRules: true,
        horizontalProgress: true,
        readableProgress: true,
        messagesRow: true,
        noOverflow: true,
      });
  }
});

test("owner Booking Request card details sit beside their labels on desktop and under them on a phone in the page column", async ({
  page,
}, testInfo) => {
  if (testInfo.project.name === "mobile") {
    await page.setViewportSize({ width: 390, height: 844 });
  }
  await mountBookingRequestDisplay(page, testInfo);

  for (const locale of ["en", "ar"] as const) {
    await page.evaluate((input) => window.renderBookingRequestDisplay(input), {
      locale,
      role: "owner" as const,
      status: "paid-confirmed" as const,
    });
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    // The language attribute changes before the page renders, so the first
    // label is what shows this language's content is the one being measured.
    await expect(
      page
        .locator("main.page .owner-booking-request-card .fact-list dt")
        .first(),
    ).toHaveText(ownerBookingRequestMessages[locale].cottage);
    await page.evaluate(() => document.fonts.ready);
    const stacked = testInfo.project.name === "mobile";
    const valueOffsetFromLabel = expect.poll(() =>
      page.evaluate((isStacked) => {
        const fact = document.querySelector(
          "main.page .owner-booking-request-card .fact-list > div",
        );
        const label = fact?.querySelector("dt")?.getBoundingClientRect();
        const value = fact?.querySelector("dd")?.getBoundingClientRect();
        if (!label || !value)
          throw new Error("Owner Booking Request fact list is missing");
        return value.top - (isStacked ? label.bottom : label.top);
      }, stacked),
    );
    if (stacked) {
      await valueOffsetFromLabel.toBeGreaterThanOrEqual(0);
    } else {
      await valueOffsetFromLabel.toBeCloseTo(0, 0);
    }
    const measured = await page.evaluate(() => ({
      available: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
    }));
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
    { borderStart: "1px", borderEnd: "1px", radius: "14px" },
    { borderStart: "0px", borderEnd: "0px", radius: "0px" },
  ]);
});

test("cottage list cards start their title and open button at the same height whatever their pills", async ({
  page,
}, testInfo) => {
  await mountBookingRequestDisplay(page, testInfo);
  await page.evaluate((photo) => {
    const card = (
      pills: string[],
      hasPhoto: boolean,
      location: string,
      price: string,
    ) =>
      '<article class="card cottage-profile-card">' +
      `<div class="cottage-profile-card-cover${hasPhoto ? "" : " cottage-profile-card-cover-empty"}">` +
      `<div class="cottage-profile-card-badges">${pills.map((pill) => `<span class="status-badge">${pill}</span>`).join("")}</div>` +
      `${hasPhoto ? photo : '<p class="cottage-profile-card-no-photo">No photos yet</p>'}</div>` +
      '<h2 class="card-title">Cottage</h2>' +
      `<p class="card-detail">${location}</p>` +
      '<div class="cottage-profile-card-supporting"><div class="cottage-profile-card-facts card-small-print"><span>10 guests</span><span>4 bedrooms</span><span>0/12 photos</span></div></div>' +
      '<div class="cottage-profile-card-actions"><a class="action-link action-text" href="/">Edit cottage<span class="cottage-profile-card-arrow" aria-hidden="true">→</span></a>' +
      `${price}</div>` +
      "</article>";
    document.body.insertAdjacentHTML(
      "beforeend",
      // The cap sits on the section: on the grid, auto-fill would count its tracks against the cap and leave a phone with two columns.
      '<main class="results-page page"><section class="cottage-profile-overview" style="max-width: 46rem"><div class="cottage-profile-card-grid">' +
        card(
          [
            "Published; update awaiting approval",
            "Started in Owner Application",
          ],
          true,
          "Erbil",
          '<p class="cottage-profile-card-price">From IQD 180,000</p>',
        ) +
        card(
          ["Draft"],
          false,
          "Erbil · Near Shaqlawa, beside the old road to the mountain village and the spring above the orchard",
          "",
        ) +
        "</div></section></main>",
    );
  }, coverPhotoMarkup);

  for (const locale of ["en", "ar", "ckb"] as const) {
    await page.evaluate((language) => {
      document.documentElement.lang = language;
      document.documentElement.dir = language === "en" ? "ltr" : "rtl";
    }, locale);
    const measured = await page.evaluate(() => {
      const rects = (selector: string) =>
        [...document.querySelectorAll(selector)].map((element) =>
          element.getBoundingClientRect(),
        );
      const covers = rects(".cottage-profile-card-cover");
      const firstPills = rects(".cottage-profile-card-badges > :first-child");
      return {
        titles: rects(".cottage-profile-card h2").map((rect) => rect.top),
        links: rects(".cottage-profile-card a").map((rect) => rect.top),
        actions: [...document.querySelectorAll(".cottage-profile-card a")].map(
          (action) => {
            const style = getComputedStyle(action);
            return {
              decoration: style.textDecorationLine,
              weight: style.fontWeight,
            };
          },
        ),
        link: rects(".cottage-profile-card a")[0].toJSON(),
        price: rects(".cottage-profile-card-price")[0].toJSON(),
        arrows: [
          ...document.querySelectorAll(".cottage-profile-card-arrow"),
        ].map((arrow) => getComputedStyle(arrow).transform),
        coverBottoms: covers.map((rect) => rect.bottom),
        pillsFromLeft: firstPills.map(
          (rect, index) => rect.left - covers[index].left,
        ),
        pillsFromRight: firstPills.map(
          (rect, index) => covers[index].right - rect.right,
        ),
        document: document.documentElement.scrollWidth,
        available: document.documentElement.clientWidth,
      };
    });
    expect(measured.titles).toHaveLength(2);
    expect(measured.links).toHaveLength(2);
    expect(measured.actions).toEqual([
      { decoration: "none", weight: "700" },
      { decoration: "none", weight: "700" },
    ]);
    expect(measured.coverBottoms).toHaveLength(2);
    if (testInfo.project.name === "desktop") {
      expect(measured.titles[0]).toBe(measured.titles[1]);
      expect(measured.links[0]).toBe(measured.links[1]);
      expect(measured.coverBottoms[0]).toBe(measured.coverBottoms[1]);
    }
    expect(
      measured.price.bottom <= measured.link.top ||
        measured.price.top >= measured.link.bottom ||
        measured.price.right <= measured.link.left ||
        measured.price.left >= measured.link.right,
    ).toBe(true);
    expect(measured.price.top).toBeGreaterThanOrEqual(measured.link.top);
    expect(measured.arrows).toEqual([
      locale === "en" ? "none" : "matrix(-1, 0, 0, 1, 0, 0)",
      locale === "en" ? "none" : "matrix(-1, 0, 0, 1, 0, 0)",
    ]);
    const inlineStart =
      locale === "en" ? measured.pillsFromLeft : measured.pillsFromRight;
    for (const offset of inlineStart) expect(offset).toBeCloseTo(12, 1);
    expect(measured.document).toBeLessThanOrEqual(measured.available);
  }

  // A lone card keeps its column width: drop the second card and the fixture's width cap, so the grid is the page column.
  await page.evaluate(() => {
    const grid = document.querySelector<HTMLElement>(
      ".cottage-profile-card-grid",
    );
    const section = document.querySelector<HTMLElement>(
      ".cottage-profile-overview",
    );
    if (!grid || !section) throw new Error("The cottage card grid is missing");
    grid.querySelectorAll(".cottage-profile-card")[1].remove();
    section.removeAttribute("style");
  });
  const lone = await page.evaluate(() => {
    const grid = document.querySelector(".cottage-profile-card-grid");
    if (!grid) throw new Error("The cottage card grid is missing");
    return {
      gridWidth: grid.getBoundingClientRect().width,
      cardWidths: [...grid.querySelectorAll(".cottage-profile-card")].map(
        (card) => card.getBoundingClientRect().width,
      ),
    };
  });
  expect(lone.cardWidths).toHaveLength(1);
  if (testInfo.project.name === "desktop") {
    expect(lone.cardWidths[0]).toBeLessThan(lone.gridWidth / 2);
  } else {
    expect(Math.abs(lone.cardWidths[0] - lone.gridWidth)).toBeLessThanOrEqual(
      1,
    );
  }
});

test("a cottage list card casts the card shadow and each toned status badge shows its own dot", async ({
  page,
}, testInfo) => {
  await mountBookingRequestDisplay(page, testInfo);
  await page.evaluate((photo) => {
    document.body.insertAdjacentHTML(
      "beforeend",
      '<main class="results-page page"><section class="cottage-profile-overview"><div class="cottage-profile-card-grid">' +
        '<article class="card cottage-profile-card" data-testid="card">' +
        '<div class="cottage-profile-card-cover"><div class="cottage-profile-card-badges">' +
        '<span class="status-badge status-badge-published">Published</span>' +
        '<span class="status-badge status-badge-draft">Private draft</span>' +
        '<span class="status-badge status-badge-review">Submitted for content approval</span></div>' +
        `${photo}</div>` +
        '<h2 class="card-title">Cottage</h2>' +
        '<p class="card-detail">Erbil</p>' +
        '<div class="cottage-profile-card-supporting"><div class="cottage-profile-card-facts card-small-print"><span>10 guests</span><span>4 bedrooms</span><span>0/12 photos</span></div></div>' +
        '<div class="cottage-profile-card-actions"><a class="action-link action-text" href="#">Open Cottage Profile<span class="cottage-profile-card-arrow" aria-hidden="true">→</span></a></div>' +
        "</article></div></section></main>",
    );
  }, coverPhotoMarkup);

  const card = page.getByTestId("card");
  const measureEdge = () =>
    card.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        width: style.borderTopWidth,
        color: style.borderTopColor,
      };
    });
  const measured = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="card"]');
    if (!card) throw new Error("The cottage list card is missing");
    const style = getComputedStyle(card);
    return {
      boxShadow: style.boxShadow,
      radius: style.borderStartStartRadius,
      dots: [...card.querySelectorAll(".status-badge")].map((badge) => {
        const dot = getComputedStyle(badge, "::before");
        return {
          color: dot.backgroundColor,
          content: dot.content,
          width: dot.width,
          height: dot.height,
        };
      }),
    };
  });
  expect(measured.boxShadow).toContain("0px 8px 24px -12px");
  expect(measured.boxShadow).toContain("rgba(38, 36, 31, 0.06)");
  expect(measured.boxShadow).toContain("rgba(38, 36, 31, 0.18)");
  expect(measured.radius).toBe("14px");
  expect(measured.dots).toEqual(
    ["rgb(47, 125, 79)", "rgb(178, 124, 62)", "rgb(59, 110, 165)"].map(
      (color) => ({ color, content: '""', width: "8px", height: "8px" }),
    ),
  );

  const normalEdge = await measureEdge();
  expect(normalEdge.color).toBe("rgba(0, 0, 0, 0)");
  await page.emulateMedia({ forcedColors: "active" });
  const forcedEdge = await measureEdge();
  expect(Number.parseFloat(forcedEdge.width)).toBeGreaterThan(0);
  expect(forcedEdge.color).not.toBe("rgba(0, 0, 0, 0)");
  await page.screenshot({
    path: testInfo.outputPath("cottage-card-forced-colours.png"),
  });
  await page.emulateMedia({ forcedColors: "none" });

  const link = card.getByRole("link", { name: "Open Cottage Profile" });
  for (let presses = 0; presses < 20; presses += 1) {
    if (await link.evaluate((element) => element === document.activeElement)) {
      break;
    }
    await page.keyboard.press("Tab");
  }
  await expect(link).toBeFocused();
  expect(
    await link.evaluate((element) => element.matches(":focus-visible")),
  ).toBe(true);
  const focus = await link.evaluate((element) => {
    const style = getComputedStyle(element);
    return { boxShadow: style.boxShadow, outlineStyle: style.outlineStyle };
  });
  expect(focus.boxShadow).not.toBe("none");
  expect(focus.outlineStyle).toBe("solid");
  await page.screenshot({
    path: testInfo.outputPath("cottage-card-focus.png"),
  });
});

test("a waiting request row sits on one line on desktop and stacks with its two actions side by side on a phone in both directions", async ({
  page,
}, testInfo) => {
  const phone = testInfo.project.name === "mobile";
  if (phone) {
    await page.setViewportSize({ width: 390, height: 844 });
  }
  await mountBookingRequestDisplay(page, testInfo);

  for (const fixture of [
    {
      dir: "ltr",
      lang: "en",
      title: `${"A".repeat(120)} · 4 guests`,
      detail: "Garden House · Fri, Oct 23: Evening · IQD 250,000",
      timeLeft: "Answer within 3 hours",
      link: "View request",
      decline: "Decline",
      accept: "Accept",
    },
    {
      dir: "rtl",
      lang: "ar",
      title: `${"ب".repeat(120)} · 4 ضيوف`,
      detail: "بيت الحديقة · الجمعة، 23 أكتوبر: مساءً · 250,000 د.ع.",
      timeLeft: "أجب خلال 3 ساعات",
      link: "عرض الطلب",
      decline: "رفض",
      accept: "قبول",
    },
  ] as const) {
    await page.evaluate((input) => {
      document.querySelector('[data-testid="request-row-page"]')?.remove();
      document.documentElement.dir = input.dir;
      document.documentElement.lang = input.lang;
      document.body.insertAdjacentHTML(
        "beforeend",
        '<main class="results-page page" data-testid="request-row-page"><section class="owner-booking-requests">' +
          '<div><h2 class="section-title">Pending Booking Requests</h2></div>' +
          '<div class="request-rows"><article class="card request-row">' +
          '<div class="request-row-photo"></div>' +
          '<div class="request-row-facts">' +
          `<h3 class="card-title">${input.title}</h3>` +
          `<p class="card-detail">${input.detail}</p>` +
          `<span class="status-badge status-badge-attention">${input.timeLeft}</span>` +
          `<a class="action-link action-text" href="#">${input.link}</a>` +
          '<span role="status" aria-live="polite"></span>' +
          "</div>" +
          '<div class="request-row-actions">' +
          `<button class="action action-secondary action-regular action-content" type="button" aria-expanded="false">${input.decline}</button>` +
          `<button class="action action-primary action-regular action-content" type="button">${input.accept}</button>` +
          "</div></article></div></section></main>",
      );
    }, fixture);
    await expect(page.locator("html")).toHaveAttribute("dir", fixture.dir);
    await expect(
      page.getByRole("heading", { level: 3, name: fixture.title }),
    ).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    await expect(async () => {
      const measured = await page.evaluate(() => {
        const box = (selector: string) => {
          const element = document.querySelector(
            `[data-testid="request-row-page"] ${selector}`,
          );
          if (!element) throw new Error(`${selector} is missing`);
          const { left, right, top, bottom, width, height } =
            element.getBoundingClientRect();
          return { left, right, top, bottom, width, height };
        };
        return {
          available: document.documentElement.clientWidth,
          document: document.documentElement.scrollWidth,
          row: box(".request-row"),
          heading: box(".request-row-facts > h3"),
          photo: box(".request-row-photo"),
          facts: box(".request-row-facts"),
          actions: box(".request-row-actions"),
          decline: box(".request-row-actions > button:first-child"),
          accept: box(".request-row-actions > button:last-child"),
        };
      });

      expect(measured.photo.width).toBeCloseTo(80, 0);
      expect(measured.photo.height).toBeCloseTo(80, 0);
      for (const element of [measured.row, measured.heading]) {
        expect(element.left).toBeGreaterThanOrEqual(0);
        expect(element.right).toBeLessThanOrEqual(measured.available);
      }
      expect(measured.document).toBeLessThanOrEqual(measured.available);

      if (phone) {
        expect(measured.actions.top).toBeGreaterThanOrEqual(
          measured.facts.bottom,
        );
        expect(measured.decline.top).toBeCloseTo(measured.accept.top, 0);
        expect(measured.decline.height).toBeGreaterThanOrEqual(44);
        expect(measured.accept.height).toBeGreaterThanOrEqual(44);
        for (const [inner, outer] of [
          [measured.decline, measured.actions],
          [measured.accept, measured.actions],
          [measured.actions, measured.row],
        ]) {
          expect(inner.left).toBeGreaterThanOrEqual(outer.left - 1);
          expect(inner.right).toBeLessThanOrEqual(outer.right + 1);
        }
      } else {
        if (fixture.dir === "ltr") {
          expect(measured.photo.right).toBeLessThanOrEqual(measured.facts.left);
          expect(measured.facts.right).toBeLessThanOrEqual(
            measured.actions.left,
          );
        } else {
          expect(measured.photo.left).toBeGreaterThanOrEqual(
            measured.facts.right,
          );
          expect(measured.facts.left).toBeGreaterThanOrEqual(
            measured.actions.right,
          );
        }
        const actionsMiddle =
          (measured.actions.top + measured.actions.bottom) / 2;
        expect(actionsMiddle).toBeGreaterThan(measured.facts.top);
        expect(actionsMiddle).toBeLessThan(measured.facts.bottom);
      }
    }).toPass();
  }
});

test("lifted public results retain readable options and responsive hierarchy in every language", async ({
  page,
}, testInfo) => {
  const phone = testInfo.project.name === "mobile";
  if (phone) await page.setViewportSize({ width: 390, height: 844 });
  await mountBookingRequestDisplay(page, testInfo);

  for (const input of [
    {
      locale: "en",
      title: "Available cottages",
      noPrice: "Price unavailable",
      unavailable: "Unavailable",
      selected: "Selected filter",
      view: "View cottage",
      photoCount: 1,
      longContent: false,
    },
    {
      locale: "ar",
      title: "البيوت المتاحة",
      noPrice: "السعر غير متاح",
      unavailable: "غير متاح",
      selected: "مرشح محدد",
      view: "اعرض البيت",
      photoCount: 1,
      longContent: false,
    },
    {
      locale: "ckb",
      title: "کۆتێجە بەردەستەکان",
      noPrice: "نرخ بەردەست نییە",
      unavailable: "بەردەست نییە",
      selected: "پاڵاوتەی دیاریکراو",
      view: "کۆتێجەکە ببینە",
      photoCount: 1,
      longContent: false,
    },
    {
      locale: "ckb",
      title: "کۆتێجە بەردەستەکان",
      noPrice: "نرخ بەردەست نییە",
      unavailable: "بەردەست نییە",
      selected: "پاڵاوتەی دیاریکراو",
      view: "کۆتێجەکە ببینە",
      photoCount: 0,
      longContent: true,
    },
  ] as const) {
    await page.evaluate((state) => window.renderPublicCottageDisplay(state), {
      screen: "results" as const,
      locale: input.locale,
      photoCount: input.photoCount,
      longContent: input.longContent,
    });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      input.title,
    );
    await expect(page.locator("html")).toHaveAttribute(
      "dir",
      input.locale === "en" ? "ltr" : "rtl",
    );
    const card = page.getByRole("article");
    await expect(card.getByRole("heading", { level: 2 })).toHaveText(
      input.longContent
        ? "کۆتێجی باخچەی خەیاڵی بۆ کۆبوونەوەی خێزان لە ناوچەی شەقڵاوە لە نێوان دارەکان و چیاکان لەگەڵ شوێنی پشوودان و دانیشتنی دەرەوە"
        : "Fictional Garden Cottage",
    );
    await expect(card.getByRole("img")).toHaveCount(input.photoCount);
    await page.evaluate(() => document.fonts.ready);
    await expect
      .poll(() =>
        card
          .getByRole("img")
          .evaluateAll((images) =>
            images.every(
              (image) =>
                image instanceof HTMLImageElement &&
                image.complete &&
                image.naturalWidth > 0,
            ),
          ),
      )
      .toBe(true);
    await expect(card.getByText(input.noPrice, { exact: true })).toBeVisible();
    for (const unavailable of await card
      .getByText(input.unavailable, { exact: true })
      .all())
      await expect(unavailable).toBeVisible();
    await expect(card.getByText(input.selected, { exact: true })).toHaveCount(
      2,
    );
    for (const selected of await card
      .getByText(input.selected, { exact: true })
      .all())
      await expect(selected).toBeVisible();
    await expect(
      card.getByRole("link", { name: input.view, exact: true }),
    ).toBeVisible();
    await expect(card.locator(".result-service-day")).toHaveCount(2);
    await expect(
      card.locator(".result-service-day").first().getByRole("listitem"),
    ).toHaveCount(3);
    await expect(
      card.locator(".result-service-day").last().getByRole("listitem"),
    ).toHaveCount(4);

    await expect
      .poll(() =>
        card.evaluate(
          (article, state) => {
            const content = article.querySelector(".result-content");
            const overview = article.querySelector(".result-overview");
            const price = article.querySelector(".result-price");
            const days = article.querySelector(".result-days");
            const footer = article.querySelector(".result-footer");
            const title = article.querySelector("h2");
            const image = article.querySelector(".result-image");
            const action = footer?.querySelector("a");
            if (
              !content ||
              !overview ||
              !price ||
              !days ||
              !footer ||
              !title ||
              !action
            )
              throw new Error("Public Search composition is missing");
            const [
              contentBox,
              overviewBox,
              priceBox,
              daysBox,
              footerBox,
              titleBox,
              actionBox,
            ] = [content, overview, price, days, footer, title, action].map(
              (node) => node.getBoundingClientRect(),
            );
            const imageBox = image?.getBoundingClientRect();
            const dayBoxes = [
              ...days.querySelectorAll(".result-service-day"),
            ].map((node) => node.getBoundingClientRect());
            const optionBoxes = [
              ...days.querySelectorAll(".result-service-day:first-child li"),
            ].map((node) => node.getBoundingClientRect());
            const historicalBoxes = [
              ...days.querySelectorAll(".result-service-day:last-child li"),
            ].map((node) => node.getBoundingClientRect());
            const atStart = (box: DOMRect, parent: DOMRect) =>
              Math.abs(
                state.rtl ? box.right - parent.right : box.left - parent.left,
              ) < 1;
            return {
              photoPlacement: state.hasPhoto
                ? !!imageBox &&
                  (state.phone
                    ? imageBox.bottom <= contentBox.top &&
                      Math.abs(imageBox.width / imageBox.height - 1.6) < 0.01
                    : Math.abs(imageBox.height - contentBox.height) < 1 &&
                      Math.abs(imageBox.top - contentBox.top) < 1 &&
                      (state.rtl
                        ? imageBox.left >= contentBox.right
                        : imageBox.right <= contentBox.left))
                : !imageBox &&
                  Math.abs(contentBox.width - article.clientWidth) < 1,
              priceHierarchy: state.phone
                ? priceBox.top >= overviewBox.bottom &&
                  daysBox.top >= priceBox.bottom &&
                  atStart(priceBox, overviewBox) &&
                  atStart(
                    price.querySelector("p")!.getBoundingClientRect(),
                    overviewBox,
                  )
                : Math.abs(priceBox.top - titleBox.top) < 1 &&
                  (state.rtl
                    ? priceBox.right <= overviewBox.left
                    : priceBox.left >= overviewBox.right),
              dayColumns: state.phone
                ? optionBoxes.every(
                    (box, index) =>
                      index === 0 || box.top >= optionBoxes[index - 1].bottom,
                  )
                : optionBoxes.every(
                    (box) => Math.abs(box.top - optionBoxes[0].top) < 1,
                  ) &&
                  optionBoxes.every(
                    (box, index) =>
                      index === 0 ||
                      (state.rtl
                        ? box.right <= optionBoxes[index - 1].left
                        : box.left >= optionBoxes[index - 1].right),
                  ),
              historicalRow: state.phone
                ? historicalBoxes.every(
                    (box, index) =>
                      index === 0 ||
                      box.top >= historicalBoxes[index - 1].bottom,
                  )
                : historicalBoxes[3].top >=
                  Math.max(
                    ...historicalBoxes.slice(0, 3).map((box) => box.bottom),
                  ),
              footerAfterDays: dayBoxes.every(
                (box) => footerBox.top >= box.bottom,
              ),
              phoneAction:
                !state.phone || Math.abs(actionBox.width - footerBox.width) < 1,
              lifted: getComputedStyle(article).boxShadow !== "none",
              inkTitle:
                getComputedStyle(title).color ===
                getComputedStyle(document.body).color,
              fontsLoaded: document.fonts.check(
                "700 20px Changa",
                title.textContent ?? "",
              ),
              noOverflow:
                document.documentElement.scrollWidth <=
                  document.documentElement.clientWidth &&
                article.scrollWidth <= article.clientWidth &&
                [
                  ...article.querySelectorAll("p, h2, li, dd"),
                  ...document.querySelectorAll(
                    ".search-summary dt, .search-summary dd",
                  ),
                ].every((node) => node.scrollWidth <= node.clientWidth + 1),
            };
          },
          { phone, rtl: input.locale !== "en", hasPhoto: input.photoCount > 0 },
        ),
      )
      .toEqual({
        photoPlacement: true,
        priceHierarchy: true,
        dayColumns: true,
        historicalRow: true,
        footerAfterDays: true,
        phoneAction: true,
        lifted: true,
        inkTitle: true,
        fontsLoaded: true,
        noOverflow: true,
      });
  }
});

test("lifted public cottage keeps its hero separate and every booking option readable in every language", async ({
  page,
}, testInfo) => {
  const projectPhone = testInfo.project.name === "mobile";
  if (projectPhone) await page.setViewportSize({ width: 390, height: 844 });
  await mountBookingRequestDisplay(page, testInfo);
  const media = [
    "/uploads/cottage-garden.png",
    "/uploads/interior-living.png",
    "/uploads/interior-bedroom.png",
    "/uploads/detail-tea.png",
    "/uploads/cottage-river.png",
    "/uploads/cottage-hills.png",
  ];
  for (const input of [
    {
      locale: "en",
      heading: "Choose your Booking Period",
      photoCount: 4,
      narrow: projectPhone,
      longContent: false,
    },
    {
      locale: "ar",
      heading: "اختر فترة الحجز",
      photoCount: 4,
      narrow: projectPhone,
      longContent: false,
    },
    {
      locale: "ckb",
      heading: "ماوەی حجزەکەت هەڵبژێرە",
      photoCount: 4,
      narrow: projectPhone,
      longContent: false,
    },
    {
      locale: "ckb",
      heading: "ماوەی حجزەکەت هەڵبژێرە",
      photoCount: 0,
      narrow: projectPhone,
      longContent: false,
    },
    {
      locale: "ckb",
      heading: "ماوەی حجزەکەت هەڵبژێرە",
      photoCount: 1,
      narrow: projectPhone,
      longContent: false,
    },
    {
      locale: "ckb",
      heading: "ماوەی حجزەکەت هەڵبژێرە",
      photoCount: 6,
      narrow: true,
      longContent: true,
    },
  ] as const) {
    if (input.narrow) await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate((state) => window.renderPublicCottageDisplay(state), {
      screen: "profile" as const,
      locale: input.locale,
      photoCount: input.photoCount,
      longContent: input.longContent,
    });
    const name = input.longContent
      ? "کۆتێجی باخچەی خەیاڵی بۆ کۆبوونەوەی خێزان لە ناوچەی شەقڵاوە لە نێوان دارەکان و چیاکان لەگەڵ شوێنی پشوودان و دانیشتنی دەرەوە"
      : "Fictional Garden Cottage";
    const title = page.getByRole("heading", { level: 1 });
    await expect(title).toHaveText(name);
    await expect(
      page.getByRole("heading", { name: input.heading, exact: true }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", input.locale);
    await expect(page.locator("html")).toHaveAttribute(
      "dir",
      input.locale === "en" ? "ltr" : "rtl",
    );
    const images = page.getByRole("img");
    await expect(images).toHaveCount(input.photoCount);
    await page.evaluate(() => document.fonts.ready);
    await expect
      .poll(() =>
        images.evaluateAll((nodes) =>
          nodes.every(
            (image) =>
              image instanceof HTMLImageElement &&
              image.complete &&
              image.naturalWidth > 0,
          ),
        ),
      )
      .toBe(true);
    expect(
      await images.evaluateAll((nodes) =>
        nodes.map(
          (image) =>
            new URL(image.getAttribute("src")!, location.href).pathname,
        ),
      ),
    ).toEqual(media.slice(0, input.photoCount));
    for (let index = 0; index < input.photoCount; index++)
      await expect(images.nth(index)).toHaveAttribute(
        "alt",
        `${name} ${index + 1}`,
      );
    await expect(page.locator(".profile-gallery")).toHaveCount(
      input.photoCount > 1 ? 1 : 0,
    );
    const booking = page.getByRole("complementary");
    await expect(booking.getByRole("group")).toHaveCount(2);
    await expect(booking.getByRole("button", { pressed: true })).toHaveCount(2);
    await expect(booking.locator(".booking-period-list > li")).toHaveCount(7);

    await expect
      .poll(() =>
        page.evaluate(
          (state) => {
            const main = document.querySelector("main.profile-page");
            const heading = main?.querySelector(".page-heading");
            const layout = main?.querySelector(".profile-layout");
            const hero = main?.querySelector(".profile-main-image");
            const gallery = main?.querySelector(".profile-gallery");
            const facts = main?.querySelector(".profile-facts");
            const booking = main?.querySelector(".booking-summary");
            const copy = main?.querySelector(".profile-copy");
            if (!main || !heading || !layout || !facts || !booking || !copy)
              throw new Error("Public cottage composition is missing");
            const mainBox = main.getBoundingClientRect();
            const layoutBox = layout.getBoundingClientRect();
            const heroBox = hero?.getBoundingClientRect();
            const galleryBox = gallery?.getBoundingClientRect();
            const factsBox = facts.getBoundingClientRect();
            const bookingBox = booking.getBoundingClientRect();
            const copyBox = copy.getBoundingClientRect();
            const thumbnails = [
              ...(gallery?.querySelectorAll("img") ?? []),
            ].map((node) => node.getBoundingClientRect());
            const controls = [
              ...booking.querySelectorAll(
                ".booking-period-list .action-toggle",
              ),
            ];
            return {
              heroSize:
                state.photos === 0
                  ? !hero
                  : !!heroBox &&
                    Math.abs(heroBox.width - mainBox.width) < 1 &&
                    (state.phone
                      ? Math.abs(heroBox.width / heroBox.height - 1.6) < 0.01
                      : Math.abs(heroBox.height - 464) < 1),
              heroClearance:
                !heroBox ||
                (state.phone
                  ? layoutBox.top >= heroBox.bottom + 23
                  : Math.abs(bookingBox.top - heroBox.bottom - 24) < 1),
              noReservedGallery:
                state.photos > 1 ||
                (!galleryBox &&
                  Math.abs(factsBox.top - layoutBox.top) < 1 &&
                  (heroBox
                    ? Math.abs(layoutBox.top - heroBox.bottom - 24) < 1
                    : Math.abs(
                        layoutBox.top -
                          heading.getBoundingClientRect().bottom -
                          24,
                      ) < 1)),
              leftColumnRhythm: state.phone
                ? Math.abs(copyBox.top - bookingBox.bottom - 48) < 1
                : (!galleryBox ||
                    Math.abs(factsBox.top - galleryBox.bottom - 24) < 1) &&
                  Math.abs(copyBox.top - factsBox.bottom - 48) < 1,
              bookingRowPadding:
                controls[0].getBoundingClientRect().height >= 78 &&
                controls[0]
                  .querySelector(".booking-period-label > span")!
                  .getBoundingClientRect().top -
                  controls[0].getBoundingClientRect().top >=
                  12,
              headingGap: [
                ...booking.querySelectorAll(".booking-period-options"),
              ].every((fieldset) => {
                const legend = fieldset.querySelector(":scope > legend")!;
                const firstOption = fieldset.querySelector(
                  ".booking-period-list .action-toggle",
                )!;
                return (
                  Math.abs(
                    firstOption.getBoundingClientRect().top -
                      legend.getBoundingClientRect().bottom -
                      12,
                  ) < 1
                );
              }),
              unboxedDays: [...booking.querySelectorAll("fieldset")].every(
                (fieldset) => {
                  const style = getComputedStyle(fieldset);
                  return [
                    style.borderTopWidth,
                    style.borderBottomWidth,
                    style.borderLeftWidth,
                    style.borderRightWidth,
                    style.paddingTop,
                    style.paddingBottom,
                    style.paddingLeft,
                    style.paddingRight,
                  ].every((value) => parseFloat(value) === 0);
                },
              ),
              bookingAlignment: state.phone
                ? (!galleryBox || galleryBox.bottom <= factsBox.top) &&
                  factsBox.bottom <= bookingBox.top &&
                  bookingBox.bottom <= copyBox.top
                : Math.abs(bookingBox.top - (galleryBox ?? factsBox).top) < 1,
              thumbnails:
                thumbnails.every(
                  (box) => Math.abs(box.width / box.height - 1.6) < 0.01,
                ) &&
                thumbnails
                  .slice(0, 3)
                  .every((box) => Math.abs(box.top - thumbnails[0].top) < 1) &&
                (thumbnails.length <= 3 ||
                  thumbnails[3].top >= thumbnails[0].bottom),
              wholeRows: controls.every((control) => {
                const row = control.closest("li")!;
                const box = control.getBoundingClientRect();
                return (
                  Math.abs(box.width - row.getBoundingClientRect().width) < 1 &&
                  [...control.querySelectorAll("span, b, bdi")].every(
                    (node) => {
                      const child = node.getBoundingClientRect();
                      return (
                        child.left >= box.left &&
                        child.right <= box.right &&
                        child.top >= box.top &&
                        child.bottom <= box.bottom
                      );
                    },
                  )
                );
              }),
              staticBooking: getComputedStyle(booking).position === "static",
              noOverflow:
                document.documentElement.scrollWidth <=
                  document.documentElement.clientWidth &&
                [...main.querySelectorAll("p, h1, h2, li, dd, button")].every(
                  (node) => node.scrollWidth <= node.clientWidth + 1,
                ),
            };
          },
          { phone: input.narrow, photos: input.photoCount },
        ),
      )
      .toEqual({
        heroSize: true,
        heroClearance: true,
        noReservedGallery: true,
        leftColumnRhythm: true,
        bookingRowPadding: true,
        headingGap: true,
        unboxedDays: true,
        bookingAlignment: true,
        thumbnails: true,
        wholeRows: true,
        staticBooking: true,
        noOverflow: true,
      });

    await title.focus();
    await page.keyboard.press("Tab");
    const selected = booking.getByRole("button", { pressed: true }).first();
    await expect(selected).toBeFocused();
    await expect
      .poll(() =>
        selected.evaluate((button) => {
          const style = getComputedStyle(button);
          const box = button.getBoundingClientRect();
          const card = button.closest("aside")!.getBoundingClientRect();
          const outer =
            parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
          return (
            button.matches(":focus-visible") &&
            style.outlineStyle !== "none" &&
            parseFloat(style.outlineWidth) >= 2 &&
            (style.boxShadow.match(/rgba?\(/g)?.length ?? 0) >= 3 &&
            style.boxShadow.includes("inset") &&
            box.left - outer >= card.left &&
            box.right + outer <= card.right
          );
        }),
      )
      .toBe(true);

    const bookingTop = await booking.evaluate(
      (node) => node.getBoundingClientRect().top + window.scrollY,
    );
    for (const fraction of [0, 0.5, 1]) {
      await page.evaluate(
        (part) =>
          window.scrollTo(
            0,
            (document.documentElement.scrollHeight - innerHeight) * part,
          ),
        fraction,
      );
      await expect
        .poll(() =>
          booking.evaluate(
            (node) => node.getBoundingClientRect().top + window.scrollY,
          ),
        )
        .toBeCloseTo(bookingTop, 0);
      await expect
        .poll(() =>
          page.evaluate(() => {
            const hero = document
              .querySelector(".profile-main-image")
              ?.getBoundingClientRect();
            const card = document
              .querySelector(".booking-summary")!
              .getBoundingClientRect();
            return !hero || card.top >= hero.bottom + 23;
          }),
        )
        .toBe(true);
    }
  }
});

test("pages reflow beside a classic scrollbar at 320 pixels in every language", async ({
  playwright,
  baseURL,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop");
  // Headless scrollbar hiding would invalidate the real available-width observer.
  const browser = await playwright.chromium.launch({
    ignoreDefaultArgs: ["--hide-scrollbars"],
  });
  try {
    const context = await browser.newContext({
      baseURL,
      viewport: { width: 320, height: 844 },
    });
    const page = await context.newPage();
    await mountBookingRequestDisplay(page, testInfo);
    await page.addStyleTag({
      content:
        "html { overflow-y: scroll; } ::-webkit-scrollbar { width: 15px; }",
    });

    for (const input of [
      {
        locale: "en",
        owner: "Your cottages",
        administrator: "Private Cottage Profiles",
        results: "Available cottages",
        language: "Language English",
      },
      {
        locale: "ar",
        owner: "أكواخك",
        administrator: "ملفات الأكواخ الخاصة",
        results: "البيوت المتاحة",
        language: "اللغة العربية",
      },
      {
        locale: "ckb",
        owner: "کۆتێجەکانت",
        administrator: "پرۆفایلە تایبەتەکانی کۆتێج",
        results: "کۆتێجە بەردەستەکان",
        language: "زمان کوردی",
      },
    ] as const) {
      for (const screen of ["owner", "administrator", "results"] as const) {
        await test.step(`${input.locale} ${screen}`, async () => {
          if (screen === "results") {
            await page.evaluate(
              (locale) =>
                window.renderPublicCottageDisplay({
                  screen: "results",
                  locale,
                  photoCount: 1,
                  withHeader: true,
                }),
              input.locale,
            );
          } else {
            await page.evaluate(
              (state) => window.renderCottageOverviewDisplay(state),
              {
                locale: input.locale,
                actor: screen,
              },
            );
          }
          await expect(page.getByRole("heading", { level: 1 })).toHaveText(
            input[screen],
          );
          await expect(
            page.getByRole("heading", {
              level: 2,
              name: "Fictional Garden Cottage",
              exact: true,
            }),
          ).toBeVisible();
          await expect(page.locator("html")).toHaveAttribute(
            "dir",
            input.locale === "en" ? "ltr" : "rtl",
          );
          await page.evaluate(() => document.fonts.ready);
          await expect
            .poll(() =>
              page
                .getByRole("heading", { level: 1 })
                .evaluate((heading) =>
                  document.fonts.check(
                    "700 20px Changa",
                    heading.textContent ?? "",
                  ),
                ),
            )
            .toBe(true);
          await expect
            .poll(() =>
              page.evaluate(() => ({
                viewport: window.innerWidth,
                available: document.documentElement.clientWidth,
              })),
            )
            .toEqual({ viewport: 320, available: 305 });
          const expectFits = () =>
            expect
              .poll(() =>
                page.evaluate(
                  () =>
                    document.documentElement.scrollWidth -
                    document.documentElement.clientWidth,
                ),
              )
              .toBeLessThanOrEqual(0);
          await expectFits();
          const language = page.getByRole("button", {
            name: input.language,
            exact: true,
          });
          await language.click();
          await expect(language).toHaveAttribute("aria-expanded", "true");
          await expect(
            page.getByRole("link", { name: "English", exact: true }),
          ).toBeVisible();
          await expectFits();
          await language.click();
          await expect(language).toHaveAttribute("aria-expanded", "false");
          await expectFits();
        });
      }
    }
  } finally {
    await browser.close();
  }
});

test("Cottage editor keeps the approved raised groups and usable controls across locales and widths", async ({
  page,
}, testInfo) => {
  const phone = testInfo.project.name === "mobile";
  await page.setViewportSize({ width: phone ? 390 : 1440, height: 900 });
  await mountBookingRequestDisplay(page, testInfo);
  for (const locale of ["en", "ar", "ckb"] as const) {
    const copy = cottageProfileMessages[locale];
    await page.evaluate(
      (locale) => window.renderCottageEditorDisplay({ locale, actor: "owner" }),
      locale,
    );
    const editor = page.locator(".cottage-profile-editor");
    await expect(editor.getByRole("heading", { level: 1 })).toHaveText(
      copy.editorTitle,
    );
    await expect(
      editor.getByLabel(copy.cottageName, { exact: true }),
    ).toHaveValue("Fictional Garden Cottage");
    await expect(editor.locator(".status-badge")).toHaveText(copy.draft);
    await expect(page.locator("html")).toHaveAttribute(
      "dir",
      locale === "en" ? "ltr" : "rtl",
    );
    await expect(page.locator("main > .backoffice-navigation")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect
      .poll(() =>
        editor.evaluate((node, phone) => {
          const fieldsets = [
            ...node.querySelectorAll(".cottage-profile-form > fieldset"),
          ];
          const header = node.querySelector(".cottage-profile-editor-heading")!;
          const title = header.querySelector("h1")!.getBoundingClientRect();
          const subtitle = header.querySelector("p")!;
          const badge = header.querySelector(".status-badge")!;
          const status = badge.getBoundingClientRect();
          const headerBox = header.getBoundingClientRect();
          const subtitleBox = subtitle.getBoundingClientRect();
          const navigation = document
            .querySelector("main > .backoffice-navigation")!
            .getBoundingClientRect();
          const rtl = document.documentElement.dir === "rtl";
          const near = (value: number, expected: number) =>
            Math.abs(value - expected) < 1;
          const size = (element: Element) =>
            parseFloat(getComputedStyle(element).fontSize);
          const cards = fieldsets.map(
            (section) => section.querySelector(".cottage-profile-field-card")!,
          );
          const boxes = fieldsets.map((section) =>
            section.getBoundingClientRect(),
          );
          const label = cards[0].querySelector(":scope > label")!;
          const control = label.querySelector(".form-control")!;
          const labelBox = label.getBoundingClientRect();
          const controlBox = control.getBoundingClientRect();
          const location = node.querySelector(
            ".cottage-profile-location-field",
          )!;
          const locationLabel = location.querySelector("label")!;
          const hint = location.querySelector("p")!;
          const save = node.querySelector(".cottage-profile-form > .action")!;
          const photos = node.querySelector(".cottage-profile-photos")!;
          const rows = [...photos.querySelectorAll(".cottage-photo-row")];
          const photoGuidance = photos.querySelector(
            ".cottage-profile-section-heading p",
          )!;
          const photoCard = photos.querySelector(
            ".cottage-profile-field-card",
          )!;
          const firstRowStyle = getComputedStyle(rows[0]);
          const nextRowStyle = getComputedStyle(rows[1]);
          const badgeStyle = getComputedStyle(badge);
          return {
            headerLayout:
              getComputedStyle(header).display === "flex" &&
              (phone
                ? status.top >= subtitleBox.bottom &&
                  near(
                    rtl
                      ? status.right - headerBox.right
                      : status.left - headerBox.left,
                    0,
                  )
                : near(subtitleBox.bottom - status.bottom, 0) &&
                  (rtl
                    ? status.right <= title.left &&
                      near(status.left - headerBox.left, 0)
                    : status.left >= title.right &&
                      near(status.right - headerBox.right, 0))),
            subtitleStyle:
              getComputedStyle(subtitle).color === "rgba(38, 36, 31, 0.68)" &&
              near(subtitleBox.top - title.bottom, 5.6),
            referenceRhythm: {
              navigationToTitle: near(
                title.top - navigation.bottom,
                phone ? 24 : 40,
              ),
              headerToFields: near(
                boxes[0].top - Math.max(subtitleBox.bottom, status.bottom),
                phone ? 56 : 64,
              ),
              sectionGaps: boxes
                .slice(1)
                .every((box, index) => near(box.top - boxes[index].bottom, 40)),
              saveGap: near(
                save.getBoundingClientRect().top - boxes[2].bottom,
                16,
              ),
              followingSections:
                near(
                  photos.getBoundingClientRect().top -
                    node
                      .querySelector(".cottage-profile-form")!
                      .getBoundingClientRect().bottom,
                  40,
                ) &&
                near(
                  node
                    .querySelector(".cottage-profile-submit-form")!
                    .getBoundingClientRect().top -
                    photos.getBoundingClientRect().bottom,
                  40,
                ),
              cardPadding: [...cards, photoCard].every((card) =>
                [
                  "paddingTop",
                  "paddingBottom",
                  "paddingInlineStart",
                  "paddingInlineEnd",
                ].every((property) =>
                  near(
                    parseFloat(
                      getComputedStyle(card).getPropertyValue(
                        property.replace(
                          /[A-Z]/g,
                          (letter) => `-${letter.toLowerCase()}`,
                        ),
                      ),
                    ),
                    20,
                  ),
                ),
              ),
              fieldGaps:
                near(controlBox.top - labelBox.top - 21.6, 5.6) &&
                near(
                  hint.getBoundingClientRect().top -
                    locationLabel.getBoundingClientRect().bottom,
                  5.6,
                ),
              typography:
                near(size(header.querySelector("h1")!), phone ? 26 : 34) &&
                near(
                  parseFloat(
                    getComputedStyle(header.querySelector("h1")!).lineHeight,
                  ),
                  document.documentElement.lang === "ckb"
                    ? phone
                      ? 36.4
                      : 47.6
                    : phone
                      ? 29.9
                      : 39.1,
                ) &&
                near(size(subtitle), 16) &&
                near(size(control), 16) &&
                getComputedStyle(control).fontWeight === "400" &&
                near(parseFloat(getComputedStyle(control).lineHeight), 24) &&
                near(size(label), 14.4) &&
                near(size(hint), 13.6) &&
                near(size(badge), 12.48) &&
                fieldsets.every((section) =>
                  near(size(section.querySelector("h2")!), 22),
                ),
              photoRhythm:
                near(parseFloat(firstRowStyle.paddingTop), 0) &&
                near(parseFloat(firstRowStyle.paddingBottom), 14.4) &&
                near(parseFloat(nextRowStyle.paddingTop), 14.4) &&
                near(parseFloat(firstRowStyle.columnGap), 20) &&
                near(parseFloat(firstRowStyle.rowGap), 16) &&
                near(
                  parseFloat(
                    getComputedStyle(photos.querySelector("ul")!).rowGap,
                  ),
                  0,
                ) &&
                near(
                  parseFloat(
                    getComputedStyle(
                      photos.querySelector(".cottage-photo-upload-form")!,
                    ).paddingTop,
                  ),
                  14.4,
                ),
              photoType:
                near(size(rows[0].querySelector("span")!), 13.6) &&
                near(size(photoGuidance), 14.72) &&
                near(size(rows[0].querySelector("button")!), 14.72) &&
                near(size(save), 15.2) &&
                near(
                  parseFloat(
                    getComputedStyle(
                      photos.querySelector('input[type="file"]')!,
                      "::file-selector-button",
                    ).fontSize,
                  ),
                  14.72,
                ),
              badgeSurface:
                badgeStyle.backgroundColor === "rgb(255, 252, 245)" &&
                near(parseFloat(badgeStyle.borderTopWidth), 1) &&
                near(parseFloat(badgeStyle.paddingTop), 4.8) &&
                near(parseFloat(badgeStyle.paddingInlineStart), 10.4) &&
                near(parseFloat(badgeStyle.columnGap), 6.4),
            },
            badgeInk: getComputedStyle(badge).color === "rgb(38, 36, 31)",
            lifted: fieldsets.every(
              (section) =>
                getComputedStyle(
                  section.querySelector(".cottage-profile-field-card")!,
                ).boxShadow !== "none",
            ),
            composition: fieldsets.every((section) => {
              const heading = section
                .querySelector(".cottage-profile-section-heading")!
                .getBoundingClientRect();
              const card = section
                .querySelector(".cottage-profile-field-card")!
                .getBoundingClientRect();
              return phone
                ? card.top >= heading.bottom
                : Math.abs(card.top - heading.top) < 1 &&
                    (document.documentElement.dir === "rtl"
                      ? card.right <= heading.left
                      : card.left >= heading.right);
            }),
            fits:
              document.documentElement.scrollWidth <=
                document.documentElement.clientWidth &&
              node.scrollWidth <= node.clientWidth,
            statusReadable: (() => {
              const badge = node.querySelector(".status-badge")!;
              const box = badge.getBoundingClientRect();
              return box.width > 0 && badge.scrollWidth <= badge.clientWidth;
            })(),
          };
        }, phone),
      )
      .toEqual({
        headerLayout: true,
        subtitleStyle: true,
        referenceRhythm: {
          navigationToTitle: true,
          headerToFields: true,
          sectionGaps: true,
          saveGap: true,
          followingSections: true,
          cardPadding: true,
          fieldGaps: true,
          typography: true,
          photoRhythm: true,
          photoType: true,
          badgeSurface: true,
        },
        badgeInk: true,
        lifted: true,
        composition: true,
        fits: true,
        statusReadable: true,
      });
    const ready = editor.locator(".cottage-photo-row").first();
    await expect(ready.locator("strong")).toHaveText(
      "fictional-garden-<script>-photograph-with-a-long-filename-for-wrapping-and-private-photo-display-checks.jpg",
    );
    await expect(editor.locator("script")).toHaveCount(0);
    for (const state of [copy.ready, copy.pending, copy.deletionPending])
      await expect(
        editor
          .locator(".cottage-photo-row span", { hasText: state })
          .filter({ hasText: new RegExp(`^${state}$`) }),
      ).toHaveCount(1);
    await expect
      .poll(() =>
        ready.locator("strong").evaluate((node) => {
          const row = node.closest("li")!.getBoundingClientRect();
          const text = node.getBoundingClientRect();
          return (
            text.left >= row.left &&
            text.right <= row.right &&
            node.scrollWidth <= node.clientWidth
          );
        }),
      )
      .toBe(true);
    await editor
      .getByLabel(copy.cottageName, { exact: true })
      .fill("Edited fictional cottage");
    await editor.getByRole("button", { name: copy.save, exact: true }).click();
    await expect(
      editor.getByRole("status").filter({ hasText: copy.saved }),
    ).toBeVisible();
    const latitude = editor.getByLabel(copy.latitude, { exact: true });
    await latitude.fill("invalid");
    await expect(latitude).toHaveAttribute("aria-invalid", "true");
    await expect(latitude).toHaveAttribute(
      "aria-describedby",
      "cottage-profile-exact-point-check",
    );
    await expect(
      editor.getByRole("status", { name: copy.pointCheck, exact: true }),
    ).toHaveText(copy.pointDecimal);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(latitude).toBeFocused();
    await expect
      .poll(() =>
        latitude.evaluate((node) => {
          const style = getComputedStyle(node);
          return (
            node.matches(":focus-visible") &&
            style.outlineStyle !== "none" &&
            parseFloat(style.outlineWidth) >= 2 &&
            style.boxShadow !== "none"
          );
        }),
      )
      .toBe(true);
    await ready
      .getByRole("button", { name: copy.preview, exact: true })
      .click();
    await expect(ready.getByRole("alert")).toHaveText(copy.previewDenied);
    await expect(ready.getByRole("link")).toHaveCount(0);
  }
  await page.setViewportSize({ width: 320, height: 844 });
  for (const locale of ["en", "ar", "ckb"] as const) {
    await page.evaluate(
      (locale) =>
        window.renderCottageEditorDisplay({
          locale,
          actor: "owner",
          longContent: true,
          withHeader: true,
        }),
      locale,
    );
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      cottageProfileMessages[locale].editorTitle,
    );
    await expect(
      page.getByLabel(cottageProfileMessages[locale].cottageName, {
        exact: true,
      }),
    ).toHaveValue(
      "کۆتێجی باخچەی خەیاڵی بۆ کۆبوونەوەی خێزان لە ناوچەی شەقڵاوە لە نێوان دارەکان و چیاکان",
    );
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
              document.documentElement.clientWidth &&
            [
              ...document.querySelectorAll(
                ".cottage-profile-editor p, .cottage-profile-editor strong, .cottage-profile-editor button",
              ),
            ].every((node) => node.scrollWidth <= node.clientWidth + 1),
        ),
      )
      .toBe(true);
  }
  for (const input of [
    { actor: "owner", state: "submitted" },
    { actor: "administrator", state: "review" },
    { actor: "owner", state: "abandoned" },
  ] as const) {
    const copy = cottageProfileMessages.en;
    await page.evaluate(
      (input) => window.renderCottageEditorDisplay({ ...input, locale: "en" }),
      input,
    );
    const editor = page.locator(".cottage-profile-editor");
    await expect(editor.getByRole("heading", { level: 1 })).toHaveText(
      copy.editorTitle,
    );
    await expect(
      editor.getByLabel(copy.cottageName, { exact: true }),
    ).toHaveValue("Fictional Garden Cottage");
    if (input.actor === "administrator") {
      await expect(
        editor.getByLabel(copy.cottageName, { exact: true }),
      ).toBeEnabled();
      await expect(
        editor.getByRole("button", { name: copy.save, exact: true }),
      ).toBeVisible();
    } else {
      await expect(
        editor.getByLabel(copy.cottageName, { exact: true }),
      ).toBeDisabled();
      await expect(
        editor.getByRole("button", { name: copy.save, exact: true }),
      ).toHaveCount(0);
    }
    await expect(
      editor.getByRole("textbox", { name: copy.description, exact: true }),
    ).toBeDisabled();
    await expect(
      editor.getByRole("button", { name: copy.deletePhoto, exact: true }),
    ).toHaveCount(0);
    await expect(
      editor.getByRole("button", { name: copy.uploadPhoto, exact: true }),
    ).toHaveCount(0);
    await expect(
      editor.getByRole("button", { name: copy.submit, exact: true }),
    ).toHaveCount(0);
    if (input.state !== "abandoned") {
      const revision = editor.locator(".cottage-profile-source-revision");
      await expect(revision).toContainText(
        "Preserved synthetic source description.",
      );
      await expect(revision).toContainText("Preserved synthetic House Rules.");
    } else
      await expect(
        editor.getByRole("status").filter({ hasText: copy.abandonedReadOnly }),
      ).toBeVisible();
  }
});
