import { bookingRequestPaymentRecoveryMessages } from "../src/i18n/booking-request-status-messages";
import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

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
        | "paid-confirmed";
    }) => void;
  }
}

test("real Customer and Cottage Owner payment states stay semantic and within the viewport", async ({
  page,
}, testInfo) => {
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
  await page.addStyleTag({
    content: await readFile(join(process.cwd(), "src/app/globals.css"), "utf8"),
  });
  await page.addScriptTag({ path: bundlePath });

  for (const locale of [
    {
      name: "en",
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
          status === "capture-processing"
            ? locale.processing
            : status.startsWith("payment-required")
              ? locale.paymentRequired
              : locale.confirmed,
        );
        if (status.startsWith("payment-required")) {
          await expect(
            page.getByText(locale.paymentDeadline, { exact: true }),
          ).toBeVisible();
          await expect(page.getByRole("status")).toContainText(
            locale[status === "payment-required-open" ? "open" : "elapsed"][
              role === "customer" ? 0 : 1
            ],
          );
          await expect(page.getByRole("status")).toContainText(locale.held);
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
        await page.screenshot({
          path: testInfo.outputPath(`${role}-${locale.name}-${status}.png`),
          fullPage: true,
        });
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
      await page.screenshot({
        path: testInfo.outputPath(
          `customer-${locale.name}-recovery-${recovery}.png`,
        ),
        fullPage: true,
      });
    }
  }
});
