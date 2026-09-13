import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import type { RequestNotificationStatus } from "@/notification/notification-status-repository";
test("request delivery states stay distinct, localized, and retain details on failed status read", async ({
  page,
}, testInfo) => {
  const bundle = testInfo.outputPath("request-notice.js");
  await build({
    entryPoints: ["tests/fixtures/request-notification.browser.tsx"],
    outfile: bundle,
    bundle: true,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
    plugins: [
      {
        name: "request-notice-actions",
        setup(b) {
          b.onResolve({ filter: /notification-actions$/ }, () => ({
            path: "notice-action",
            namespace: "fixture",
          }));
          b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents:
              "export async function retryPaidConfirmationNotification(){return {status:'queued'}}",
            loader: "js",
          }));
        },
      },
    ],
  });
  await page.goto("/api/health");
  await page.setContent(
    '<meta name="viewport" content="width=device-width, initial-scale=1"><div id="fixture-root"></div>',
  );
  await page.addScriptTag({ path: bundle });
  const states = [
    "pending",
    "processing",
    "retryable",
    "uncertain",
    "delivered",
    "suppressed",
  ] as const;
  const notices = states.map((state, index) => ({
    receiptId: null,
    eventId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    kind: "request_accepted",
    createdAt: "2101-01-01T08:00:00Z",
    state,
    retryAllowed: state === "retryable",
    lastOutcome:
      state === "retryable"
        ? "failed"
        : state === "uncertain"
          ? "unknown"
          : state === "delivered"
            ? "delivered"
            : state === "suppressed"
              ? "suppressed"
              : null,
    supplierDeliveryReference: state === "delivered" ? "fictional" : null,
    deliveredAt: state === "delivered" ? "2101-01-01T08:00:01Z" : null,
    suppressedAt: state === "suppressed" ? "2101-01-01T08:00:01Z" : null,
    historical: false,
  })) as RequestNotificationStatus[];
  for (const locale of ["en", "ar", "ckb"] as const) {
    await page.evaluate(
      ({ locale, notices }) =>
        window.showRequestNotices(locale, { status: "available", notices }),
      { locale, notices },
    );
    await expect(page.getByRole("listitem")).toHaveCount(6);
    await expect(page.getByRole("button")).toHaveCount(1);
    await expect(page.locator('input[name="receiptId"]')).toHaveCount(0);
    await expect(page.locator("html")).toHaveAttribute(
      "dir",
      locale === "en" ? "ltr" : "rtl",
    );
    if (locale === "en")
      for (const label of [
        "Queued",
        "Delivery processing",
        "Delivery failed",
        "Delivery outcome uncertain; checking",
        "Delivered",
        "Delivery withheld because this notice is no longer eligible",
      ])
        await expect(page.getByText(label, { exact: true })).toBeVisible();
    for (const viewport of [
      { name: "mobile", width: 390, height: 844 },
      { name: "desktop", width: 1440, height: 1000 },
    ]) {
      await page.setViewportSize(viewport);
      await page.screenshot({
        path: testInfo.outputPath(
          `request-notifications-${locale}-${viewport.name}.png`,
        ),
        fullPage: true,
      });
    }
    await page.evaluate(
      (locale) => window.showRequestNotices(locale, { status: "unavailable" }),
      locale,
    );
    await expect(
      page.getByRole("heading", { name: "Retained cottage details" }),
    ).toBeVisible();
    await expect(page.getByRole("status")).toBeVisible();
    await expect(page.getByRole("listitem")).toHaveCount(0);
  }
});
