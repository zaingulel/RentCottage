import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

declare global {
  interface Window {
    renderBookingRequestDisplay: (input: {
      locale: "en" | "ar" | "ckb";
      role: "customer" | "owner";
      status: "capture-processing" | "paid-confirmed";
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
            { filter: /booking-request\/lifecycle-actions$/ },
            () => ({
              path: "booking-request-server-action",
              namespace: "fixture",
            }),
          );
          pluginBuild.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents:
              "export async function actOnBookingRequest() { throw new Error('Fixture actions are unavailable'); }",
            loader: "ts",
          }));
        },
      },
    ],
  });
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
    },
    {
      name: "ar",
      processing: "بانتظار تأكيد الدفع",
      confirmed: "تم تأكيد الحجز",
    },
    {
      name: "ckb",
      processing: "چاوەڕێی پشتڕاستکردنەوەی پارەدان",
      confirmed: "حجز پشتڕاست کراوەتەوە",
    },
  ] as const) {
    for (const role of ["customer", "owner"] as const) {
      for (const status of ["capture-processing", "paid-confirmed"] as const) {
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
            : locale.confirmed,
        );
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
  }
});
