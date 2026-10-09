import { expect, test } from "@playwright/test";
import { openHeaderPanel } from "./fixtures/site-header";

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

const languageNames = ["English", "کوردی", "العربية"] as const;

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
  await openHeaderPanel(page, "language");
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

    await openHeaderPanel(page, "menu");
    await expect(ownerLink).toHaveAttribute("href", copy.href);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.locator("html")).toHaveAttribute("dir", copy.dir);
    await openHeaderPanel(page, "language");
    if (locale === "ar") {
      await expect(
        page.getByRole("navigation", { name: "اللغة" }),
      ).toBeVisible();
    }
    await expect(page.locator("html")).toHaveJSProperty(
      "scrollWidth",
      await page.locator("html").evaluate((element) => element.clientWidth),
    );

    const languageNavigation = header.getByRole("navigation", {
      name: locale === "en" ? "Language" : locale === "ar" ? "اللغة" : "زمان",
    });
    const languageBoxes = [];
    for (const language of languageNames) {
      const box = await languageNavigation
        .getByRole("link", { name: language, exact: true })
        .boundingBox();
      expect(box).not.toBeNull();
      languageBoxes.push(box);
      await expect(
        page
          .getByRole("contentinfo")
          .getByRole("link", { name: language, exact: true }),
      ).toHaveCount(0);
    }
    expect(languageBoxes[0]!.x).toBeLessThan(languageBoxes[1]!.x);
    expect(languageBoxes[1]!.x).toBeLessThan(languageBoxes[2]!.x);

    await page.keyboard.press("Tab");
    await expect(header.getByRole("link", { name: copy.brand })).toBeFocused();
    for (const language of languageNames) {
      await page.keyboard.press("Tab");
      await expect(
        languageNavigation.getByRole("link", { name: language, exact: true }),
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
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(copy.href);
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
      await openHeaderPanel(page, "menu");
      await expect(
        page
          .getByRole("banner")
          .getByRole("link", { name: copy.label, exact: true }),
      ).toBeVisible();
      await openHeaderPanel(page, "language");
      for (const language of languageNames) {
        await expect(
          page
            .getByRole("banner")
            .getByRole("link", { name: language, exact: true }),
        ).toBeInViewport();
      }
    }
  }
});

test("pre-live support stays honest, private and keyboard-accessible in every language", async ({
  page,
}, testInfo) => {
  const copy = {
    en: {
      support: "Support",
      accountNavigation: "Account and support",
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
      accountNavigation: "الحساب والدعم",
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
      accountNavigation: "هەژمار و پشتیوانی",
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
    const header = page.getByRole("banner");
    const navigation = header.getByRole("navigation", {
      name: labels.accountNavigation,
    });
    const support = navigation.getByRole("link", {
      name: labels.support,
      exact: true,
    });
    await openHeaderPanel(page, "menu");
    await expect(support).toHaveAttribute("href", `/${locale}/support`);
    for (let index = 0; index < 7; index += 1) {
      await page.keyboard.press("Tab");
    }
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
    await expect(page.getByRole("main").locator("form")).toHaveCount(0);
    await expect(page.getByRole("main").getByRole("textbox")).toHaveCount(0);
    await expect(page.getByRole("main").getByRole("button")).toHaveCount(0);
    const language = page.getByRole("navigation", { name: labels.language });
    const nextLocale = locale === "en" ? "ar" : locale === "ar" ? "ckb" : "en";
    await openHeaderPanel(page, "language");
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
    await expect(
      page.getByRole("heading", { level: 1, name: labels.support }),
    ).toBeVisible();
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
  if (testInfo.project.name === "mobile") {
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
    const signIn = page
      .getByRole("banner")
      .getByRole("link", { name, exact: true });
    const href = `/${locale}/access?returnTo=${encodeURIComponent(destination)}`;
    await openHeaderPanel(page, "menu");
    await expect(signIn).toHaveAttribute("href", href);
    await signIn.click();
    await expect(page).toHaveURL(new URL(href, page.url()).href);
    await expect(page.locator('input[autocomplete="tel"]')).toBeVisible();
  }
});

test("keeps the hero subtitle clear of the headline's lowest letters in every language", async ({
  page,
}) => {
  for (const locale of ["ar", "ckb", "en"]) {
    await page.goto(`/${locale}`);
    const { clearance, subtitleFontSize } = await page.evaluate(async () => {
      const context = document.createElement("canvas").getContext("2d")!;
      const measure = async (selector: string) => {
        const element = document.querySelector(selector)!;
        const style = getComputedStyle(element);
        const text = element.textContent ?? "";
        const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        await document.fonts.load(font, text);
        context.font = font;
        const metrics = context.measureText(text);
        const lineHeight = parseFloat(style.lineHeight);
        const half =
          (lineHeight -
            (metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent)) /
          2;
        return {
          rect: element.getBoundingClientRect(),
          metrics,
          lineHeight,
          half,
          fontSize: parseFloat(style.fontSize),
        };
      };
      const headline = await measure(".retreat-copy h1");
      const subtitle = await measure(".retreat-copy p");
      const headlineInkBottom =
        headline.rect.bottom -
        headline.lineHeight +
        headline.half +
        headline.metrics.fontBoundingBoxAscent +
        headline.metrics.actualBoundingBoxDescent;
      const subtitleInkTop =
        subtitle.rect.top +
        subtitle.half +
        subtitle.metrics.fontBoundingBoxAscent -
        subtitle.metrics.actualBoundingBoxAscent;
      return {
        clearance: subtitleInkTop - headlineInkBottom,
        subtitleFontSize: subtitle.fontSize,
      };
    });
    expect(clearance, locale).toBeGreaterThanOrEqual(subtitleFontSize / 2);
  }
});
