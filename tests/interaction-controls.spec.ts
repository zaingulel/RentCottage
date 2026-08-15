import { expect, test } from "@playwright/test";

const localeFixtures = [
  { locale: "en", search: "Find your retreat", direction: "ltr" },
  { locale: "ar", search: "ابحث عن ملاذك", direction: "rtl" },
  { locale: "ckb", search: "پەناگەکەت بدۆزەوە", direction: "rtl" },
] as const;

test("shared actions expose native semantics and visible interaction states", async ({
  page,
}) => {
  await page.goto("/en");

  const search = page.getByRole("button", { name: "Find your retreat" });
  const searchBox = await search.boundingBox();
  expect(searchBox?.height).toBeGreaterThanOrEqual(44);

  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const focused = page.getByRole("button", { name: "العربية" });
  await expect(focused).toBeFocused();
  expect(
    await focused.evaluate((element) => getComputedStyle(element).outlineStyle),
  ).not.toBe("none");

  const pool = page.getByRole("button", { name: "Pool" });
  await expect(pool).toHaveAttribute("aria-pressed", "false");
  await pool.click();
  await expect(pool).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "Increase Guests" }),
  ).not.toHaveAttribute("aria-pressed");
});

test("booking controls share native field styling and legible disabled treatment", async ({
  page,
}) => {
  await page.goto("/en/request/garden-house");

  const fullName = page.getByLabel("Full name");
  const note = page.getByLabel("Note to the owner");
  await expect(fullName).toHaveAttribute("type", "text");
  expect(
    await fullName.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    ),
  ).toBe(
    await note.evaluate((element) => getComputedStyle(element).backgroundColor),
  );
  expect(
    await fullName.evaluate(
      (element) => getComputedStyle(element).borderRadius,
    ),
  ).toBe(
    await note.evaluate((element) => getComputedStyle(element).borderRadius),
  );

  const submit = page.getByRole("button", { name: "Send booking request" });
  await expect(submit).toBeDisabled();
  expect(
    await submit.evaluate((element) =>
      Number(getComputedStyle(element).opacity),
    ),
  ).toBeGreaterThanOrEqual(0.7);
  expect(
    await submit.evaluate((element) => getComputedStyle(element).borderStyle),
  ).not.toBe("none");
});

test("internal action links preserve client-side navigation", async ({
  page,
}) => {
  await page.goto("/en/results?period=full-day&guests=4");
  await page.evaluate(() => {
    Reflect.set(window, "rentcottageClientNavigation", true);
  });

  await page.getByRole("link", { name: "View cottage" }).first().click();

  await expect(page).toHaveURL(/\/en\/cottages\/garden-house$/);
  expect(
    await page.evaluate(() =>
      Reflect.get(window, "rentcottageClientNavigation"),
    ),
  ).toBe(true);
});

for (const fixture of localeFixtures) {
  test(`${fixture.locale} keeps direction, public navigation and current control pixels`, async ({
    page,
  }, testInfo) => {
    await page.goto(`/${fixture.locale}`);
    await expect(page.locator("html")).toHaveAttribute(
      "dir",
      fixture.direction,
    );

    const search = page.getByRole("button", { name: fixture.search });
    await search.hover();
    await page.screenshot({
      path: testInfo.outputPath(`${fixture.locale}-marketplace-hover.png`),
      fullPage: true,
    });

    await search.focus();
    await page.screenshot({
      path: testInfo.outputPath(`${fixture.locale}-marketplace-focus.png`),
      fullPage: true,
    });

    await search.click();
    await expect(page).toHaveURL(new RegExp(`/${fixture.locale}/results`));
  });
}

test("desktop CKB results actions have current pixel evidence", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop");
  await page.goto("/ckb/results?period=full-day&guests=4");
  await page.getByRole("link", { name: "گەڕانەوە بۆ گەڕان" }).focus();
  await page.screenshot({
    path: testInfo.outputPath("ckb-results-actions.png"),
    fullPage: true,
  });
});

test("mobile EN cottage booking action has current pixel evidence", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile");
  await page.goto("/en/cottages/garden-house");
  await page
    .getByRole("link", { name: "Request booking" })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("en-cottage-booking-action.png"),
    fullPage: true,
  });
});

test("mobile CKB booking request fields and disabled action have current pixel evidence", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile");
  await page.goto("/ckb/request/garden-house");
  await page.getByLabel("ناوی تەواو").fill("ئارام محەمەد");
  await page
    .getByLabel("تێبینی بۆ خاوەنەکە")
    .fill("تکایە کاتی گەیشتن پشتڕاست بکەرەوە.");
  await expect(
    page.getByRole("button", { name: "داواکاری حجز بنێرە" }),
  ).toBeDisabled();
  await page.screenshot({
    path: testInfo.outputPath("ckb-booking-request-controls.png"),
    fullPage: true,
  });
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
