import { expect, test } from "@playwright/test";

const ownerSignIn = {
  en: {
    label: "Owner sign-in",
    href: "/en/owner/access",
    heading: "Cottage Owner access",
    dir: "ltr",
  },
  ar: {
    label: "دخول مالك البيت",
    href: "/ar/owner/access",
    heading: "دخول مالك البيت",
    dir: "rtl",
  },
  ckb: {
    label: "چوونەژوورەوەی خاوەنی ماڵ",
    href: "/ckb/owner/access",
    heading: "چوونەژوورەوەی خاوەنی ماڵ",
    dir: "rtl",
  },
} as const;

test("preserves the selected Retreat shell around live discovery", async ({
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
  await expect(
    page.getByRole("navigation", { name: "Language" }),
  ).toBeVisible();
  await expect(page.getByText("Exploratory preview")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Selected homes" }),
  ).toHaveCount(0);
});

test("keeps the Retreat shell within the Arabic viewport", async ({ page }) => {
  await page.goto("/ar");
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("navigation", { name: "اللغة" })).toBeVisible();
});

test("Owner sign-in stays visible, localized, and keyboard-operable", async ({
  page,
}, testInfo) => {
  for (const [locale, copy] of Object.entries(ownerSignIn)) {
    await page.goto(`/${locale}`);
    const ownerLink = page.getByRole("link", { name: copy.label, exact: true });

    await expect(ownerLink).toHaveAttribute("href", copy.href);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.locator("html")).toHaveAttribute("dir", copy.dir);
    await expect(page.locator("html")).toHaveJSProperty(
      "scrollWidth",
      await page.locator("html").evaluate((element) => element.clientWidth),
    );

    await page.screenshot({
      path: `test-results/owner-sign-in-${testInfo.project.name}-${locale}.png`,
      fullPage: true,
    });
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: /RentCottage|ڕێنت کۆتاج|ريف كوتج/ }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(ownerLink).toBeFocused();
    await expect(ownerLink).toHaveCSS("outline-style", "solid");
    await page.screenshot({
      path: `test-results/owner-sign-in-${testInfo.project.name}-${locale}-focused.png`,
      fullPage: true,
    });
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`${copy.href}$`));
    await expect(
      page.getByRole("heading", { name: copy.heading }),
    ).toBeVisible();
  }

  if (testInfo.project.name === "mobile") {
    await page.setViewportSize({ width: 320, height: 800 });
    for (const [locale, copy] of Object.entries(ownerSignIn)) {
      await page.goto(`/${locale}`);
      const dimensions = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        document: document.documentElement.scrollWidth,
      }));
      expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
      await page.screenshot({
        path: `test-results/owner-sign-in-mobile-320-${locale}.png`,
        fullPage: true,
      });
      await expect(
        page.getByRole("link", { name: copy.label, exact: true }),
      ).toBeVisible();
    }
  }
});

test("disconnects the fictional booking-request route", async ({ page }) => {
  const response = await page.goto("/en/request/garden-house");
  expect(response?.status()).toBe(404);
});
