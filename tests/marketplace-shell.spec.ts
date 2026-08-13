import { expect, test } from "@playwright/test";

test("renders the selected Retreat visual direction from the client prototype", async ({
  page,
}) => {
  await page.goto("/en");

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "A house in the countryside, all yours",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "A rural house at sunset in Iraq" }),
  ).toHaveAttribute("src", "/uploads/hero-retreat.png");
  await expect(page.getByLabel("Approximate area")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Find your retreat" }),
  ).toBeVisible();
  await expect(page.getByText("Visual direction")).toHaveCount(0);
});

test("language switching keeps the route, query, anchor, and form state", async ({
  page,
}) => {
  await page.goto("/ar?arrival=2026-08-18#search");
  await page.getByLabel("الموقع التقريبي").selectOption("north");
  await page.getByRole("button", { name: "کوردی" }).click();

  await expect(page).toHaveURL(/\/ckb\?arrival=2026-08-18#search$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "ckb");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByLabel("ناوچەی نزیکەوە")).toHaveValue("north");

  await page.getByRole("button", { name: "English" }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByLabel("Approximate area")).toHaveValue("north");
});

test("keeps the Retreat shell within the viewport", async ({ page }) => {
  await page.goto("/ar");

  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  await expect(
    page.getByRole("button", { name: "ابحث عن ملاذك" }),
  ).toBeVisible();
});

test("keeps a request draft when its language changes", async ({ page }) => {
  await page.goto("/ar/request/garden-house?period=full-day");

  const note = page.getByLabel("ملاحظة للمالك");
  await note.fill("نحتاج وصولاً سهلاً لكبار السن");
  await page.getByRole("button", { name: "کوردی" }).click();

  await expect(page).toHaveURL(
    /\/ckb\/request\/garden-house\?period=full-day$/,
  );
  await expect(page.getByLabel("تێبینی بۆ خاوەنەکە")).toHaveValue(
    "نحتاج وصولاً سهلاً لكبار السن",
  );
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
});

test("applies search filters without claiming live availability", async ({
  page,
}) => {
  await page.goto("/en");
  await page.getByLabel("Approximate area").selectOption("highlands");
  await page.getByRole("button", { name: "Find your retreat" }).click();

  await expect(
    page.getByRole("heading", { name: "Sunset House" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Garden House" })).toHaveCount(
    0,
  );
  await expect(page.getByText(/Live availability confirmation/)).toBeVisible();
});

test("uses shift-based booking language without approval claims", async ({
  page,
}) => {
  await page.goto("/en/results?period=full-day&guests=4");

  await expect(
    page.getByText("Full-day bundle", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("4 guests", { exact: true })).toBeVisible();
  await expect(page.getByText("Manually approved owner")).toHaveCount(0);
  await expect(page.getByText("per night")).toHaveCount(0);
});

test("treats an unknown area query as all areas", async ({ page }) => {
  await page.goto("/en/results?area=typo&period=full-day&guests=4");

  await expect(
    page.getByRole("heading", { name: "Garden House" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Sunset House" }),
  ).toBeVisible();
});
