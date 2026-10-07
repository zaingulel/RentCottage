import { expect, type Locator, test } from "@playwright/test";
import { build } from "esbuild";

import { readApplicationStylesheet } from "./fixtures/application-stylesheet";

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

function computed(
  locator: Locator,
  properties: readonly string[],
  pseudoElement?: string,
) {
  return locator.evaluate(
    (element, [names, pseudo]) => {
      const style = getComputedStyle(element, pseudo);
      return names.map((name) => style.getPropertyValue(name));
    },
    [properties, pseudoElement] as const,
  );
}

test("choice, option group and disclosure controls keep native behaviour, visible focus and state cues in both directions", async ({
  page,
}, testInfo) => {
  const bundlePath = testInfo.outputPath("interaction-controls.js");
  await build({
    entryPoints: ["tests/fixtures/interaction-controls.browser.tsx"],
    outfile: bundlePath,
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
  });
  if (testInfo.project.name === "mobile") {
    await page.setViewportSize({ width: 390, height: 844 });
  }
  await page.goto("/api/health");
  await page.setContent(
    '<meta name="viewport" content="width=device-width, initial-scale=1"><main id="fixture-root"></main>',
  );
  await page.addStyleTag({ content: await readApplicationStylesheet() });
  await page.addScriptTag({ path: bundlePath });

  const reference = page.getByRole("textbox", { name: "Reference" });
  const pool = page.getByRole("checkbox", { name: "Pool" });
  const garden = page.getByRole("checkbox", { name: "Garden" });
  const closed = page.getByRole("checkbox", { name: "Closed" });
  const invalid = page.getByRole("checkbox", { name: /^I confirm/ });
  const newEnquiry = page.getByRole("radio", { name: "New enquiry" });
  const continueEnquiry = page.getByRole("radio", {
    name: "Continue enquiry",
  });
  const disclosure = page.locator("details.disclosure");
  const summary = disclosure.locator("summary");
  const choices = page.locator(".choice-control");
  const resting = [
    "border-top-width",
    "border-top-color",
    "border-top-left-radius",
    "background-color",
  ];
  const focusRing = [
    "outline-width",
    "outline-offset",
    "outline-color",
    "box-shadow",
  ];

  await expect(reference).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.keyboard.press("Tab");
  await expect(reference).toBeFocused();

  for (const direction of ["ltr", "rtl"] as const) {
    await page.evaluate((dir) => {
      document.documentElement.dir = dir;
    }, direction);
    await expect(page.locator("html")).toHaveAttribute("dir", direction);
    await expect(choices).toHaveCount(6);

    const root = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);

    const rows = await choices.evaluateAll((labels) =>
      labels.map((label) => {
        const mark = label.querySelector("input")!.getBoundingClientRect();
        const text = label.querySelector("span")!.getBoundingClientRect();
        return {
          height: label.getBoundingClientRect().height,
          markLeft: mark.left,
          markRight: mark.right,
          textLeft: text.left,
          textRight: text.right,
        };
      }),
    );
    for (const row of rows) {
      expect(row.height).toBeGreaterThanOrEqual(44);
      if (direction === "ltr") {
        expect(row.markLeft).toBeLessThan(row.textLeft);
      } else {
        expect(row.markRight).toBeGreaterThan(row.textRight);
      }
    }
    expect((await summary.boundingBox())?.height).toBeGreaterThanOrEqual(44);

    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement)
        document.activeElement.blur();
    });
    await expect(page.locator(":focus")).toHaveCount(0);
    const restingField = await computed(reference, resting);
    expect(await computed(summary, resting)).toEqual(restingField);
    expect(await computed(garden, ["background-color"])).toEqual([
      restingField[3],
    ]);

    await reference.focus();
    await expect(reference).toBeFocused();
    const focusedField = await computed(reference, focusRing);
    const [focusedFieldBorder] = await computed(reference, [
      "border-top-color",
    ]);
    await garden.focus();
    await expect(garden).toBeFocused();
    expect(await computed(garden, focusRing)).toEqual(focusedField);
    await summary.focus();
    await expect(summary).toBeFocused();
    expect(await computed(summary, [...focusRing, "border-top-color"])).toEqual(
      [...focusedField, focusedFieldBorder],
    );

    expect(await computed(pool, ["content"], "::before")).not.toEqual(["none"]);
    expect(await computed(newEnquiry, ["content"], "::before")).not.toEqual([
      "none",
    ]);
    expect(await computed(garden, ["content"], "::before")).toEqual(["none"]);
    expect(await computed(continueEnquiry, ["content"], "::before")).toEqual([
      "none",
    ]);
    expect(await computed(closed, ["border-top-style"])).toEqual(["dashed"]);
    expect(await computed(garden, ["border-top-style"])).toEqual(["solid"]);
    const [invalidBorder] = await computed(invalid, ["border-top-width"]);
    const [validBorder] = await computed(garden, ["border-top-width"]);
    expect(Number.parseFloat(invalidBorder)).toBeGreaterThan(
      Number.parseFloat(validBorder),
    );
    const closedChevron = await computed(summary, ["transform"], "::after");
    await disclosure.evaluate((details: HTMLDetailsElement) => {
      details.open = true;
    });
    await expect(disclosure).toHaveJSProperty("open", true);
    expect(await computed(summary, ["transform"], "::after")).not.toEqual(
      closedChevron,
    );
    await disclosure.evaluate((details: HTMLDetailsElement) => {
      details.open = false;
    });
    await expect(disclosure).toHaveJSProperty("open", false);
  }

  await page.evaluate(() => {
    document.documentElement.dir = "ltr";
  });
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await garden.focus();
  await page.keyboard.press("Space");
  await expect(garden).toBeChecked();
  await newEnquiry.focus();
  await page.keyboard.press("ArrowDown");
  await expect(continueEnquiry).toBeChecked();
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(disclosure).toHaveJSProperty("open", true);

  if (testInfo.project.name === "desktop") {
    await page.screenshot({
      path: testInfo.outputPath("form-control-states.png"),
      fullPage: true,
    });
  }
});
