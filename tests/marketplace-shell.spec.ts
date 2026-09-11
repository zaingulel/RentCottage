import { expect, test } from "@playwright/test";

const ownerSignIn = {
  en: {
    label: "List your cottage",
    history: "Sign in",
    href: "/en/access?returnTo=%2Fen%2Fowner%2Fapplication",
    heading: "Sign in or create an account",
    dir: "ltr",
  },
  ar: {
    label: "أدرج كوخك",
    history: "تسجيل الدخول",
    href: "/ar/access?returnTo=%2Far%2Fowner%2Fapplication",
    heading: "سجّل الدخول أو أنشئ حسابًا",
    dir: "rtl",
  },
  ckb: {
    label: "کۆتێجەکەت تۆمار بکە",
    history: "چوونەژوورەوە",
    href: "/ckb/access?returnTo=%2Fckb%2Fowner%2Fapplication",
    heading: "بچۆ ژوورەوە یان هەژمارێک دروست بکە",
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

test("shared sign-in and owner enrollment stay localized and keyboard-operable", async ({
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
      page
        .getByRole("navigation", {
          name:
            locale === "en" ? "Account" : locale === "ar" ? "الحساب" : "هەژمار",
        })
        .getByRole("link", { name: "RentCottage", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    const historyLink = page.getByRole("link", {
      name: copy.history,
      exact: true,
    });
    await expect(historyLink).toBeFocused();
    await expect(historyLink).toHaveAttribute(
      "href",
      `/${locale}/access?returnTo=%2F${locale}%2Fbookings`,
    );
    await expect(historyLink).toHaveCSS("outline-style", "solid");
    await page.keyboard.press("Tab");
    await expect(ownerLink).toBeFocused();
    await expect(ownerLink).toHaveCSS("outline-style", "solid");
    await page.screenshot({
      path: `test-results/owner-sign-in-${testInfo.project.name}-${locale}-focused.png`,
      fullPage: true,
    });
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(copy.href);
    await expect(
      page.getByRole("heading", { name: copy.heading }),
    ).toBeVisible();
    await page.screenshot({
      path: `test-results/shared-access-${testInfo.project.name}-${locale}.png`,
      fullPage: true,
    });
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

test("sign-in preserves the permitted search selection in every language", async ({
  page,
}) => {
  const query =
    "from=2101-01-01&to=2101-01-01&guests=4&selection=2101-01-01%3Ashift%3A1";
  for (const [locale, name] of Object.entries({
    en: "Sign in",
    ar: "تسجيل الدخول",
    ckb: "چوونەژوورەوە",
  })) {
    const destination = `/${locale}/results?${query}`;
    await page.goto(destination);
    const signIn = page.getByRole("link", { name, exact: true });
    const href = `/${locale}/access?returnTo=${encodeURIComponent(destination)}`;
    await expect(signIn).toHaveAttribute("href", href);
    await signIn.click();
    await expect(page).toHaveURL(new URL(href, page.url()).href);
    await expect(page.locator('input[autocomplete="tel"]')).toBeVisible();
  }
});
