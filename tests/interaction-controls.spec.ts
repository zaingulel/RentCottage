import { expect, test } from "@playwright/test";

const localeFixtures = [
  {
    locale: "en",
    language: "Language",
    unavailable: "Search choices could not be loaded right now.",
    direction: "ltr",
  },
  {
    locale: "ar",
    language: "اللغة",
    unavailable: "تعذر تحميل خيارات البحث الآن.",
    direction: "rtl",
  },
  {
    locale: "ckb",
    language: "زمان",
    unavailable: "ئێستا ناتوانرێت هەڵبژاردەکانی گەڕان باربکرێن.",
    direction: "rtl",
  },
] as const;

test("locale actions expose native semantics and visible interaction states", async ({
  page,
}) => {
  await page.goto("/en");

  const arabic = page
    .getByRole("banner")
    .getByRole("link", { name: "العربية" });
  await expect(arabic).not.toHaveAttribute("aria-current", "page");
  await arabic.focus();
  const focused = arabic;
  await expect(focused).toBeFocused();
  expect(
    await focused.evaluate((element) => getComputedStyle(element).outlineStyle),
  ).not.toBe("none");

  await arabic.click();
  await expect(page).toHaveURL(/\/ar$/);
  await expect(
    page.getByRole("banner").getByRole("link", { name: "العربية" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
});

test("access controls retain native field styling", async ({ page }) => {
  await page.goto("/en/owner/access");

  const phone = page.getByLabel("Iraqi phone number");
  await expect(phone).toHaveAttribute("type", "tel");
  await phone.focus();
  expect(
    await phone.evaluate((element) => getComputedStyle(element).outlineStyle),
  ).not.toBe("none");
  const submit = page.getByRole("button", { name: "Send verification code" });
  const submitBox = await submit.boundingBox();
  expect(submitBox?.height).toBeGreaterThanOrEqual(44);
});

test("internal action links preserve client-side navigation", async ({
  page,
}) => {
  await page.goto("/en/owner/access");
  await page.evaluate(() => {
    Reflect.set(window, "rentcottageClientNavigation", true);
  });

  await page.getByRole("link", { name: "RentCottage" }).click();

  await expect(page).toHaveURL(/\/en$/);
  expect(
    await page.evaluate(() =>
      Reflect.get(window, "rentcottageClientNavigation"),
    ),
  ).toBe(true);
});

for (const fixture of localeFixtures) {
  test(`${fixture.locale} keeps direction and resilient discovery`, async ({
    page,
  }) => {
    await page.goto(`/${fixture.locale}`);
    await expect(page.locator("html")).toHaveAttribute(
      "dir",
      fixture.direction,
    );

    await expect(
      page.getByRole("navigation", { name: fixture.language }),
    ).toBeVisible();
    await expect(page.locator("p[role='alert']")).toHaveText(
      fixture.unavailable,
    );
  });
}

test("desktop CKB invalid search offers a new search", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop");
  await page.goto("/ckb/results?period=full-day&guests=4");
  await expect(
    page.getByRole("link", { name: "گەڕانێکی نوێ دەست پێ بکە" }),
  ).toHaveAttribute("href", "/ckb");
});

test("mobile CKB fictional booking request stays disconnected", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile");
  const response = await page.goto("/ckb/request/garden-house");
  expect(response?.status()).toBe(404);
});
