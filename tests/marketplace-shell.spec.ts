import { expect, test } from "@playwright/test";

const ownerSignIn = {
  en: {
    brand: "RentCottage",
    label: "List your cottage",
    history: "Sign in",
    href: "/en/access?returnTo=%2Fen%2Fowner%2Fapplication",
    heading: "Sign in or create an account",
    dir: "ltr",
  },
  ar: {
    brand: "ريف كوتج",
    label: "أدرج كوخك",
    history: "تسجيل الدخول",
    href: "/ar/access?returnTo=%2Far%2Fowner%2Fapplication",
    heading: "سجّل الدخول أو أنشئ حسابًا",
    dir: "rtl",
  },
  ckb: {
    brand: "ڕێنت کۆتاج",
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

test("loads every asset, fonts included, from this origin alone", async ({
  page,
}) => {
  const origins = new Set<string>();
  const faces = new Set<string>();
  page.on("request", (request) => {
    const url = new URL(request.url());
    origins.add(url.origin);
    if (url.pathname.endsWith(".woff2")) faces.add(url.pathname);
  });

  for (const locale of Object.keys(ownerSignIn)) {
    await page.goto(`/${locale}`);
    await page.evaluate(() => document.fonts.ready);
  }

  expect([...origins]).toEqual([new URL(page.url()).origin]);
  // Arabic and Kurdish render in Almarai and Changa, so a run that served no
  // Arabic face proves nothing about where the fonts came from.
  expect(
    [...faces].filter((path) => path.includes("-arabic")),
    `served font files: ${[...faces].join(", ") || "none"}`,
  ).not.toHaveLength(0);
});

test("shared sign-in and owner enrollment stay localized and keyboard-operable", async ({
  page,
}, testInfo) => {
  for (const [locale, copy] of Object.entries(ownerSignIn)) {
    await page.goto(`/${locale}`);
    const header = page.getByRole("banner");
    const ownerLink = header.getByRole("link", {
      name: copy.label,
      exact: true,
    });

    await expect(ownerLink).toHaveAttribute("href", copy.href);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.locator("html")).toHaveAttribute("dir", copy.dir);
    if (locale === "ar") {
      await expect(
        page.getByRole("navigation", { name: "اللغة" }),
      ).toBeVisible();
    }
    await expect(page.locator("html")).toHaveJSProperty(
      "scrollWidth",
      await page.locator("html").evaluate((element) => element.clientWidth),
    );

    await page.screenshot({
      path: `test-results/owner-sign-in-${testInfo.project.name}-${locale}.png`,
      fullPage: true,
    });
    await page.keyboard.press("Tab");
    await expect(header.getByRole("link", { name: copy.brand })).toBeFocused();
    for (const language of ["العربية", "کوردی", "English"]) {
      await page.keyboard.press("Tab");
      await expect(
        header
          .getByRole("navigation", {
            name:
              locale === "en" ? "Language" : locale === "ar" ? "اللغة" : "زمان",
          })
          .getByRole("link", { name: language, exact: true }),
      ).toBeFocused();
    }
    await page.keyboard.press("Tab");
    const historyLink = header.getByRole("link", {
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
        page
          .getByRole("banner")
          .getByRole("link", { name: copy.label, exact: true }),
      ).toBeVisible();
    }
  }
});

test("pre-live support stays honest, private and keyboard-accessible in every language", async ({
  page,
}, testInfo) => {
  const copy = {
    en: {
      support: "Support",
      preLive: "Pre-live: support is not operating.",
      cannotSend:
        "You cannot send a complaint, contact a support team or open a case here.",
      noMessage: "No message is sent and no response time is promised.",
      signIn: "Sign in or create an account",
      customer: "My customer bookings",
      owner: "Bookings for my cottages",
      language: "Language",
      dir: "ltr",
    },
    ar: {
      support: "الدعم",
      preLive: "قبل الإطلاق: خدمة الدعم غير متاحة.",
      cannotSend: "لا يمكنك إرسال شكوى أو التواصل مع فريق دعم أو فتح قضية هنا.",
      noMessage: "لن تُرسل أي رسالة ولا يوجد وعد بوقت للرد.",
      signIn: "سجّل الدخول أو أنشئ حسابًا",
      customer: "حجوزاتي كعميل",
      owner: "حجوزات أكواخي",
      language: "اللغة",
      dir: "rtl",
    },
    ckb: {
      support: "پشتیوانی",
      preLive: "پێش دەستپێکردن: پشتیوانی کار ناکات.",
      cannotSend:
        "لێرە ناتوانیت سکاڵا بنێریت، پەیوەندی بە تیمی پشتیوانیەوە بکەیت یان دۆسیەیەک بکەیتەوە.",
      noMessage:
        "هیچ پەیامێک نانێردرێت و هیچ کاتێک بۆ وەڵامدانەوە بەڵێن نادرێت.",
      signIn: "بچۆ ژوورەوە یان هەژمارێک دروست بکە",
      customer: "حجزەکانم وەک کڕیار",
      owner: "حجزەکانی کۆتێجەکانم",
      language: "زمان",
      dir: "rtl",
    },
  } as const;
  for (const [locale, labels] of Object.entries(copy)) {
    await page.goto(`/${locale}/bookings?token=private-support-sentinel`);
    const support = page
      .getByRole("banner")
      .getByRole("link", { name: labels.support, exact: true });
    await expect(support).toHaveAttribute("href", `/${locale}/support`);
    await support.focus();
    await expect(support).toBeFocused();
    await expect(support).toHaveCSS("outline-style", "solid");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/${locale}/support$`));
    await expect(page.locator("html")).toHaveAttribute("dir", labels.dir);
    await expect(
      page.getByRole("heading", { level: 1, name: labels.support }),
    ).toBeVisible();
    await expect(page.getByRole("status")).toContainText(labels.preLive);
    await expect(page.getByRole("status")).toContainText(labels.cannotSend);
    await expect(page.getByRole("status")).toContainText(labels.noMessage);
    await expect(page.getByRole("main")).not.toContainText(
      "private-support-sentinel",
    );
    await expect(page.getByRole("main").getByRole("form")).toHaveCount(0);
    await expect(page.getByRole("main").getByRole("button")).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath(
        `support-${testInfo.project.name}-${locale}.png`,
      ),
      fullPage: true,
    });
    const language = page.getByRole("navigation", { name: labels.language });
    const nextLocale = locale === "en" ? "ar" : locale === "ar" ? "ckb" : "en";
    await language
      .getByRole("link", {
        name: { en: "English", ar: "العربية", ckb: "کوردی" }[nextLocale],
      })
      .click();
    await expect(page).toHaveURL(new RegExp(`/${nextLocale}/support$`));
    await expect(
      page.getByRole("heading", { level: 1, name: copy[nextLocale].support }),
    ).toBeVisible();
    await page.goto(`/${locale}/support?reference=private-support-sentinel`);
    await expect(page.getByRole("main")).not.toContainText(
      "private-support-sentinel",
    );
    for (const [label, href] of [
      [labels.customer, `/${locale}/bookings`],
      [labels.owner, `/${locale}/bookings?workspace=owner`],
    ]) {
      const link = page.getByRole("main").getByRole("link", { name: label });
      await expect(link).toHaveAttribute("href", href);
      await link.click();
      await expect(
        page.getByRole("heading", { name: labels.signIn }),
      ).toBeVisible();
      await page.goto(`/${locale}/support`);
    }
  }
  await page.setViewportSize({ width: 320, height: 800 });
  for (const [locale, labels] of Object.entries(copy)) {
    await page.goto(`/${locale}/support`);
    await expect(
      page.getByRole("heading", { level: 1, name: labels.support }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        ),
      )
      .toBeLessThanOrEqual(0);
    await page.screenshot({
      path: testInfo.outputPath(`support-mobile-320-${locale}.png`),
      fullPage: true,
    });
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
    const signIn = page
      .getByRole("banner")
      .getByRole("link", { name, exact: true });
    const href = `/${locale}/access?returnTo=${encodeURIComponent(destination)}`;
    await expect(signIn).toHaveAttribute("href", href);
    await signIn.click();
    await expect(page).toHaveURL(new URL(href, page.url()).href);
    await expect(page.locator('input[autocomplete="tel"]')).toBeVisible();
  }
});
