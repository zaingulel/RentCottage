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

  const arabic = page.getByRole("button", { name: "العربية" });
  await expect(arabic).toHaveAttribute("aria-pressed", "false");
  await arabic.focus();
  const focused = arabic;
  await expect(focused).toBeFocused();
  expect(
    await focused.evaluate((element) => getComputedStyle(element).outlineStyle),
  ).not.toBe("none");

  await arabic.click();
  await expect(arabic).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/\/ar$/);
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
  test(`${fixture.locale} keeps direction, resilient discovery and current control pixels`, async ({
    page,
  }, testInfo) => {
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
    const english = page.getByRole("button", { name: "English" });
    await english.hover();
    await page.screenshot({
      path: testInfo.outputPath(`${fixture.locale}-marketplace-hover.png`),
      fullPage: true,
    });

    await english.focus();
    await page.screenshot({
      path: testInfo.outputPath(`${fixture.locale}-marketplace-focus.png`),
      fullPage: true,
    });
  });
}

test("desktop CKB invalid-search actions have current pixel evidence", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop");
  await page.goto("/ckb/results?period=full-day&guests=4");
  await page.getByRole("link", { name: "گەڕانێکی نوێ دەست پێ بکە" }).focus();
  await page.screenshot({
    path: testInfo.outputPath("ckb-results-actions.png"),
    fullPage: true,
  });
});

test("mobile EN resilient discovery has current pixel evidence", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile");
  await page.goto("/en");
  await expect(page.locator("p[role='alert']")).toHaveText(
    "Search choices could not be loaded right now.",
  );
  await page.screenshot({
    path: testInfo.outputPath("en-resilient-discovery.png"),
    fullPage: true,
  });
});

test("mobile CKB fictional booking request stays disconnected", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile");
  const response = await page.goto("/ckb/request/garden-house");
  expect(response?.status()).toBe(404);
});

test("desktop AR owner access focus has current pixel evidence", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop");
  await page.goto("/ar/owner/access");
  await page.locator('input[type="tel"]').focus();
  await page.screenshot({
    path: testInfo.outputPath("ar-owner-access-focus.png"),
    fullPage: true,
  });
});

test("desktop EN administrator access has current pixel evidence", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop");
  await page.goto("/en/administrator/access");
  await page.screenshot({
    path: testInfo.outputPath("en-administrator-access.png"),
    fullPage: true,
  });
});

test("visual-only synthetic pending and file-control fixture", async ({
  page,
}, testInfo) => {
  await page.goto("/en/administrator/access");
  await page.evaluate(() => {
    const panel = document.querySelector(".access-panel");
    if (!panel) throw new Error("Access panel is unavailable");
    const label = document.createElement("label");
    label.textContent = "Synthetic verification file";
    const input = document.createElement("input");
    input.type = "file";
    input.className = "form-control";
    input.setAttribute("aria-label", "Synthetic verification file");
    label.appendChild(input);
    panel.appendChild(label);
  });
  await page.getByRole("button", { name: "Continue" }).evaluate((element) => {
    element.setAttribute("aria-busy", "true");
    (element as HTMLButtonElement).disabled = true;
  });

  await expect(page.getByLabel("Synthetic verification file")).toHaveAttribute(
    "type",
    "file",
  );
  await page.screenshot({
    path: testInfo.outputPath("visual-only-synthetic-pending-file.png"),
    fullPage: true,
  });
});
