import { writeFile } from "node:fs/promises";

import { expect, type Locator, type Page, test } from "@playwright/test";
import { build } from "esbuild";

import { readApplicationStylesheet } from "./fixtures/application-stylesheet";
import { openHeaderPanel } from "./fixtures/site-header";

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
  await openHeaderPanel(page, "language");
  await expect(arabic).not.toHaveAttribute("aria-current", "page");
  await page.keyboard.press("Tab");
  await arabic.focus();
  const focused = arabic;
  await expect(focused).toBeFocused();
  expect(
    await computed(focused, [
      "outline-width",
      "outline-offset",
      "outline-style",
      "outline-color",
      "box-shadow",
    ]),
  ).toEqual([
    "3px",
    "4px",
    "solid",
    "rgb(255, 252, 245)",
    "rgb(255, 252, 245) 0px 0px 0px 2px, rgb(34, 64, 47) 0px 0px 0px 4px",
  ]);

  await arabic.click();
  await expect(page).toHaveURL(/\/ar$/);
  await openHeaderPanel(page, "language");
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

    await openHeaderPanel(page, "language");
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

async function samplePixels(
  page: Page,
  points: readonly { x: number; y: number }[],
) {
  const screenshot = await page.screenshot({ scale: "css" });
  return page.evaluate(
    async ({ data, points }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      return points.map(({ x, y }) =>
        Array.from(
          context.getImageData(Math.floor(x), Math.floor(y), 1, 1).data,
        ).slice(0, 3),
      );
    },
    { data: screenshot.toString("base64"), points },
  );
}

test("normal input boundaries retain accessible contrast on every shared surface", async ({
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
  const width = testInfo.project.name === "mobile" ? 390 : 1440;
  if (testInfo.project.name === "mobile") {
    await page.setViewportSize({ width, height: 844 });
  }
  await page.goto("/api/health");
  await page.setContent(
    '<meta name="viewport" content="width=device-width, initial-scale=1"><div id="fixture-root"></div>',
  );
  await page.addStyleTag({ content: await readApplicationStylesheet() });
  await page.addScriptTag({ path: bundlePath });
  const surface = page.getByRole("region", { name: "Normal input boundaries" });
  await expect(surface).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width);

  function rgba(color: string) {
    const channels = color.match(/[\d.]+/g)?.map(Number);
    if (!channels || channels.length < 3 || channels.length > 4)
      throw new Error(`Unsupported computed color: ${color}`);
    return { rgb: channels.slice(0, 3), alpha: channels[3] ?? 1 };
  }
  function luminance(rgb: number[]) {
    const linear = rgb.map((channel) => {
      const value = channel / 255;
      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    });
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  }
  function contrast(first: number[], second: number[]) {
    const values = [luminance(first), luminance(second)];
    return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
  }
  const measurements = [];
  for (const { locale, direction } of localeFixtures) {
    await page.evaluate(
      ({ locale, direction }) => {
        document.documentElement.lang = locale;
        document.documentElement.dir = direction;
      },
      { locale, direction },
    );
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.locator("html")).toHaveAttribute("dir", direction);
    await page.evaluate(() => document.fonts.ready);
    for (const outside of [
      "--background",
      "--card",
      "--surface-raised",
      "--surface-bright",
      "--surface-field",
    ]) {
      for (const fill of ["default", "--background"]) {
        await surface.evaluate(
          (element, { outside, fill }) => {
            element.style.removeProperty("--surface-field");
            const root = getComputedStyle(document.documentElement);
            element.style.backgroundColor = root.getPropertyValue(outside);
            if (fill !== "default")
              element.style.setProperty(
                "--surface-field",
                root.getPropertyValue(fill),
              );
          },
          { outside, fill },
        );
        for (const name of [
          "Boundary input",
          "Boundary select",
          "Boundary textarea",
        ]) {
          const control = surface.getByLabel(name, { exact: true });
          await expect(control).toBeEnabled();
          await expect(control).not.toBeFocused();
          const actual = await control.evaluate((element) => {
            const style = getComputedStyle(element);
            return {
              border: style.borderTopColor,
              fill: style.backgroundColor,
              outside: getComputedStyle(element.parentElement!).backgroundColor,
              valid: (element as HTMLInputElement).validity.valid,
              invalid: element.getAttribute("aria-invalid"),
              direction: style.direction,
            };
          });
          expect(actual.valid).toBe(true);
          expect(actual.invalid).not.toBe("true");
          expect(actual.direction).toBe(direction);
          const border = rgba(actual.border);
          const field = rgba(actual.fill);
          const surround = rgba(actual.outside);
          expect(field.alpha).toBe(1);
          expect(surround.alpha).toBe(1);
          const painted = border.rgb.map(
            (channel, index) =>
              channel * border.alpha + field.rgb[index] * (1 - border.alpha),
          );
          const againstFill = contrast(painted, field.rgb);
          const againstOutside = contrast(painted, surround.rgb);
          const measurement = {
            locale,
            width,
            outsideToken: outside,
            fillToken: fill,
            name,
            ...actual,
            painted,
            againstFill,
            againstOutside,
          };
          measurements.push(measurement);
          const context = `${locale} ${width} ${outside} ${fill} ${name}`;
          expect
            .soft(againstFill, `${context}: field fill`)
            .toBeGreaterThanOrEqual(3);
          expect
            .soft(againstOutside, `${context}: surrounding surface`)
            .toBeGreaterThanOrEqual(3);
        }
      }
    }
  }
  const measurementPath = testInfo.outputPath("normal-input-contrast.json");
  await writeFile(measurementPath, JSON.stringify(measurements, null, 2));
  await testInfo.attach("Normal input contrast measurements", {
    path: measurementPath,
    contentType: "application/json",
  });
});

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
    '<meta name="viewport" content="width=device-width, initial-scale=1"><div id="fixture-root"></div>',
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
  const restingToggle = page.getByRole("button", { name: "Shift 1" });
  const pressedToggle = page.getByRole("button", { name: "Shift 2" });
  const disabledToggle = page.getByRole("button", { name: "Shift 3" });
  const secondary = page.getByRole("button", { name: "Secondary" });
  const choices = page.locator(".choice-control");
  const resting = [
    "border-top-width",
    "border-top-left-radius",
    "background-color",
  ];
  const focusRing = [
    "outline-width",
    "outline-offset",
    "outline-color",
    "box-shadow",
  ];
  const borderWidths = [
    "border-top-width",
    "border-right-width",
    "border-bottom-width",
    "border-left-width",
  ];
  const cornerRadii = [
    "border-top-left-radius",
    "border-top-right-radius",
    "border-bottom-right-radius",
    "border-bottom-left-radius",
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
    await expect(choices).toHaveCount(7);

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
    expect(await computed(summary, ["border-top-color"])).toEqual([
      "rgba(34, 64, 47, 0.16)",
    ]);
    expect(await computed(garden, ["background-color"])).toEqual([
      restingField[2],
    ]);

    await reference.focus();
    await expect(reference).toBeFocused();
    const focusedField = await computed(reference, focusRing);
    expect(focusedField).toEqual([
      "2px",
      "4px",
      "rgb(255, 252, 245)",
      "rgb(255, 252, 245) 0px 0px 0px 2px, rgb(34, 64, 47) 0px 0px 0px 4px",
    ]);
    const [focusedFieldBorder] = await computed(reference, [
      "border-top-color",
    ]);
    expect(focusedFieldBorder).toBe("rgb(34, 64, 47)");
    const invalidFieldResting = await reference.evaluate((element) => {
      element.setAttribute("aria-invalid", "true");
      (element as HTMLElement).blur();
      return getComputedStyle(element).boxShadow;
    });
    await reference.focus();
    await expect(reference).toBeFocused();
    expect(
      await computed(reference, [...focusRing, "border-top-color"]),
    ).toEqual([...focusedField, "rgb(163, 52, 37)"]);
    await garden.focus();
    expect(await computed(reference, ["box-shadow"])).toEqual([
      invalidFieldResting,
    ]);
    await reference.evaluate((element) =>
      element.removeAttribute("aria-invalid"),
    );
    await expect(garden).toBeFocused();
    expect(await computed(garden, focusRing)).toEqual(focusedField);
    await summary.focus();
    await expect(summary).toBeFocused();
    expect(await computed(summary, [...focusRing, "border-top-color"])).toEqual(
      [...focusedField, focusedFieldBorder],
    );

    const invalidResting = await computed(invalid, ["box-shadow"]);
    await invalid.focus();
    await expect(invalid).toBeFocused();
    expect(await computed(invalid, [...focusRing, "border-top-color"])).toEqual(
      [...focusedField, "rgb(163, 52, 37)"],
    );
    const pressedResting = await computed(pressedToggle, [
      "background-color",
      "box-shadow",
    ]);
    await pressedToggle.focus();
    await expect(pressedToggle).toBeFocused();
    expect(await computed(invalid, ["box-shadow"])).toEqual(invalidResting);
    expect(await computed(pressedToggle, focusRing)).toEqual([
      ...focusedField.slice(0, 3),
      `${focusedField[3]}, ${pressedResting[1]}`,
    ]);
    expect(await computed(pressedToggle, ["background-color"])).toEqual([
      pressedResting[0],
    ]);
    await expect(pressedToggle).toHaveAttribute("aria-pressed", "true");
    await secondary.focus();
    await expect(secondary).toBeFocused();
    expect(await computed(secondary, focusRing)).toEqual(focusedField);
    await page
      .locator("#fixture-root")
      .evaluate((element) =>
        element.classList.add("cottage-shift-schedule-form"),
      );
    for (const control of [reference, garden, secondary]) {
      await control.focus();
      await expect(control).toBeFocused();
      expect(await computed(control, focusRing)).toEqual(focusedField);
    }
    await page
      .locator("#fixture-root")
      .evaluate((element) =>
        element.classList.remove("cottage-shift-schedule-form"),
      );

    expect(await computed(pool, ["content"], "::before")).not.toEqual(["none"]);
    expect(await computed(newEnquiry, ["content"], "::before")).not.toEqual([
      "none",
    ]);
    expect(await computed(garden, ["content"], "::before")).toEqual(["none"]);
    expect(await computed(continueEnquiry, ["content"], "::before")).toEqual([
      "none",
    ]);
    const [tickTop, tickRight, tickBottom, tickLeft, tickTransform] =
      await computed(pool, [...borderWidths, "transform"], "::before");
    expect(Number.parseFloat(tickRight)).toBeGreaterThan(0);
    expect(Number.parseFloat(tickBottom)).toBeGreaterThan(0);
    expect(Number.parseFloat(tickTop)).toBe(0);
    expect(Number.parseFloat(tickLeft)).toBe(0);
    expect(tickTransform).not.toBe("none");
    for (const width of await computed(newEnquiry, borderWidths, "::before")) {
      expect(Number.parseFloat(width)).toBeGreaterThan(0);
    }
    expect(await computed(newEnquiry, cornerRadii, "::before")).toEqual([
      "50%",
      "50%",
      "50%",
      "50%",
    ]);
    expect(await computed(closed, ["border-top-style"])).toEqual(["dashed"]);
    expect(await computed(garden, ["border-top-style"])).toEqual(["solid"]);
    const [invalidBorder] = await computed(invalid, ["border-top-width"]);
    const [validBorder] = await computed(garden, ["border-top-width"]);
    expect(Number.parseFloat(invalidBorder)).toBeGreaterThan(
      Number.parseFloat(validBorder),
    );
    expect(
      await computed(restingToggle, [
        "color",
        "background-color",
        "border-top-color",
      ]),
    ).toEqual(
      await computed(secondary, [
        "color",
        "background-color",
        "border-top-color",
      ]),
    );
    expect(await computed(secondary, ["border-top-color"])).toEqual([
      "rgba(34, 64, 47, 0.3)",
    ]);
    expect(await computed(disabledToggle, ["border-top-style"])).toEqual([
      "dashed",
    ]);
    expect(await computed(restingToggle, ["border-top-style"])).toEqual([
      "solid",
    ]);
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

  const fixtureRoot = page.locator("#fixture-root");
  const fixtureStyle = await fixtureRoot.evaluate((element: HTMLElement) => {
    const original = element.style.cssText;
    element.style.padding = "16px";
    element.style.background = "#fffcf5";
    return original;
  });
  const primary = page.getByRole("button", { name: "Save fixture" });
  await page.mouse.move(0, 0);
  await page.keyboard.press("Tab");
  await primary.scrollIntoViewIfNeeded();
  await primary.evaluate((element: HTMLElement) => element.blur());
  await expect(primary).not.toBeFocused();
  const bounds = (await primary.boundingBox())!;
  const bandPoints = [1, 3, 5].map((distance) => ({
    x: bounds.x - distance,
    y: bounds.y + bounds.height / 2,
  }));
  expect(await samplePixels(page, bandPoints)).toEqual([
    [255, 252, 245],
    [255, 252, 245],
    [255, 252, 245],
  ]);
  await primary.focus();
  await expect(primary).toBeFocused();
  expect(
    await primary.evaluate((element) => element.matches(":focus-visible")),
  ).toBe(true);
  expect(await primary.boundingBox()).toEqual(bounds);
  expect(await samplePixels(page, bandPoints)).toEqual([
    [255, 252, 245],
    [34, 64, 47],
    [255, 252, 245],
  ]);
  await fixtureRoot.evaluate((element: HTMLElement, original) => {
    element.style.cssText = original;
  }, fixtureStyle);

  await page.emulateMedia({ forcedColors: "active" });
  await summary.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(summary).toBeFocused();
  expect(
    await summary.evaluate((element) => element.matches(":focus-visible")),
  ).toBe(true);
  const [forcedWidth, forcedStyle, forcedOutline, forcedBackground] =
    await computed(summary, [
      "outline-width",
      "outline-style",
      "outline-color",
      "background-color",
    ]);
  expect(Number.parseFloat(forcedWidth)).toBeGreaterThan(0);
  expect(forcedStyle).toBe("solid");
  expect(forcedOutline).not.toBe("rgba(0, 0, 0, 0)");
  expect(forcedOutline).not.toBe(forcedBackground);
  await page.emulateMedia({ forcedColors: "none" });

  if (testInfo.project.name === "desktop") {
    await page.screenshot({
      path: testInfo.outputPath("form-control-states.png"),
      fullPage: true,
    });
  }
});

test("the choose-file button and the search form's Booking Period toggles are at least 44 pixels tall", async ({
  page,
}, testInfo) => {
  const bundlePath = testInfo.outputPath("control-heights.js");
  const stubs: Record<string, string> = {
    "next/navigation": "export const useRouter = () => ({ push: () => {} });",
  };
  await build({
    entryPoints: ["tests/fixtures/control-heights.browser.tsx"],
    outfile: bundlePath,
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
    plugins: [
      {
        name: "control-heights-stubs",
        setup(pluginBuild) {
          pluginBuild.onResolve({ filter: /^next\/navigation$/ }, (args) => ({
            path: args.path,
            namespace: "fixture",
          }));
          pluginBuild.onLoad(
            { filter: /.*/, namespace: "fixture" },
            (args) => ({
              contents: stubs[args.path],
              loader: "js",
              resolveDir: process.cwd(),
            }),
          );
        },
      },
    ],
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
  await page.evaluate(() => document.fonts.ready);

  const softly = expect.configure({ soft: true });
  const shortest = (toggles: Locator) =>
    toggles.evaluateAll((elements) =>
      elements.length === 0
        ? 0
        : Math.min(
            ...elements.map(
              (element) => element.getBoundingClientRect().height,
            ),
          ),
    );

  const fileInput = page.getByLabel("Evidence document");
  await expect(fileInput).toBeVisible();
  await softly
    .poll(
      () =>
        fileInput.evaluate((element) =>
          Number.parseFloat(
            getComputedStyle(element, "::file-selector-button").height,
          ),
        ),
      { message: "choose-file button height in pixels" },
    )
    .toBeGreaterThanOrEqual(44);

  await page.getByText("Booking Period filters (optional)").click();
  const filters = page.getByRole("group", {
    name: "Booking Period for each Service Day",
  });
  await expect(filters).toBeVisible();
  const toggles = filters.getByRole("button").filter({ visible: true });
  await softly
    .poll(() => shortest(toggles), {
      message: "shortest Booking Period toggle before dates are chosen",
    })
    .toBeGreaterThanOrEqual(44);

  await page.getByLabel("From Service Day", { exact: true }).fill("2101-01-01");
  await page.getByLabel("To Service Day", { exact: true }).fill("2101-01-02");
  const dayGroups = filters.getByRole("group");
  await expect(dayGroups.first()).toBeVisible();
  await softly
    .poll(() => shortest(toggles), {
      message: "shortest Booking Period toggle after dates are chosen",
    })
    .toBeGreaterThanOrEqual(44);
});

test("discovery preserves early native edits through hydration in every launch language", async ({
  page,
}, testInfo) => {
  const bundlePath = testInfo.outputPath("discovery-hydration.js");
  await build({
    entryPoints: ["tests/fixtures/control-heights.browser.tsx"],
    outfile: bundlePath,
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
    plugins: [
      {
        name: "discovery-hydration-navigation",
        setup(pluginBuild) {
          pluginBuild.onResolve({ filter: /^next\/navigation$/ }, (args) => ({
            path: args.path,
            namespace: "fixture",
          }));
          pluginBuild.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents:
              "export const useRouter = () => ({ push: (path) => window.discoveryHydration.pushes.push(path) });",
            loader: "js",
          }));
        },
      },
    ],
  });
  const expected = {
    from: "2030-01-10",
    to: "2030-01-11",
    guests: "7",
    governorate: "Fictional Governorate",
    area: "Fictional Area",
    pool: true,
  };
  const locales = [
    {
      locale: "en",
      direction: "ltr",
      from: "From Service Day",
      to: "To Service Day",
      guests: "Guests",
      governorate: "Governorate (optional)",
      area: "Approximate area (optional)",
      pool: "Pool",
      filters: "Booking Period filters (optional)",
      shift: "Shift 1",
      submit: "Search available cottages",
    },
    {
      locale: "ar",
      direction: "rtl",
      from: "من تاريخ",
      to: "إلى تاريخ",
      guests: "عدد الضيوف",
      governorate: "المحافظة (اختياري)",
      area: "المنطقة التقريبية (اختياري)",
      pool: "مسبح",
      filters: "مرشحات فترة الحجز (اختياري)",
      shift: "الفترة 1",
      submit: "ابحث عن البيوت المتاحة",
    },
    {
      locale: "ckb",
      direction: "rtl",
      from: "لە بەرواری",
      to: "تا بەرواری",
      guests: "ژمارەی میوان",
      governorate: "پارێزگا (ئارەزوومەندانە)",
      area: "ناوچەی نزیکەیی (ئارەزوومەندانە)",
      pool: "مەلەوانگە",
      filters: "پاڵاوتەکانی ماوەی حجز (ئارەزوومەندانە)",
      shift: "شیفت 1",
      submit: "گەڕان بۆ کۆتێجی بەردەست",
    },
  ] as const;

  for (const messages of locales) {
    await page.goto("/api/health");
    await page.clock.setFixedTime(new Date("2030-01-01T09:00:00Z"));
    await page.setContent(
      `<html lang="${messages.locale}" dir="${messages.direction}"><meta name="viewport" content="width=device-width, initial-scale=1"><main id="fixture-root" data-hydration-locale="${messages.locale}" style="padding-block-start:4rem"></main></html>`,
    );
    await page.addStyleTag({ content: await readApplicationStylesheet() });
    await page.addScriptTag({ path: bundlePath });

    const root = page.locator("#fixture-root");
    const from = page.getByLabel(messages.from, { exact: true });
    const to = page.getByLabel(messages.to, { exact: true });
    const guests = page.getByLabel(messages.guests, { exact: true });
    const governorate = page.getByRole("combobox", {
      name: messages.governorate,
      exact: true,
    });
    const area = page.getByRole("combobox", {
      name: messages.area,
      exact: true,
    });
    const pool = page.getByRole("checkbox", {
      name: messages.pool,
      exact: true,
    });
    const snapshot = async () => ({
      from: await from.inputValue(),
      to: await to.inputValue(),
      guests: await guests.inputValue(),
      governorate: await governorate.inputValue(),
      area: await area.inputValue(),
      pool: await pool.isChecked(),
    });

    await expect(root).not.toHaveAttribute("data-hydration-committed");
    await from.fill("2030-01-10");
    await to.fill("2030-01-11");
    await guests.fill("7");
    await governorate.selectOption("Fictional Governorate");
    await area.selectOption("Fictional Area");
    await pool.check();
    expect(await snapshot(), `${messages.locale} before hydration`).toEqual(
      expected,
    );
    await expect(root).not.toHaveAttribute("data-hydration-committed");

    await page.evaluate(() => window.discoveryHydration.hydrate());
    await expect(root).toHaveAttribute("data-hydration-committed", "true");
    await expect(to).toHaveAttribute("min", "2030-01-10");
    const dayGroups = root
      .locator(".booking-period-filter")
      .getByRole("group", { includeHidden: true });
    await expect(dayGroups).toHaveCount(2);
    expect(
      await page.evaluate(() => window.discoveryHydration.recoverableErrors),
    ).toEqual([]);
    expect(await snapshot(), `${messages.locale} hydration committed`).toEqual(
      expected,
    );

    await page.getByText(messages.filters, { exact: true }).click();
    const firstShift = page
      .getByRole("button", { name: messages.shift, exact: true })
      .first();
    await firstShift.click();
    await expect(firstShift).toHaveAttribute("aria-pressed", "true");
    expect(await snapshot(), `${messages.locale} after Shift 1`).toEqual(
      expected,
    );
    expect(
      await page.evaluate(() => window.discoveryHydration.recoverableErrors),
    ).toEqual([]);

    await page
      .getByRole("button", { name: messages.submit, exact: true })
      .click();
    const pushes = await page.evaluate(() => window.discoveryHydration.pushes);
    expect(
      pushes,
      `${messages.locale} normal submit reaches router`,
    ).toHaveLength(1);
    const url = new URL(pushes[0], page.url());
    expect(url.pathname).toBe(`/${messages.locale}/results`);
    expect(Array.from(url.searchParams.entries()).sort()).toEqual([
      ["amenity", "pool"],
      ["area", "Fictional Area"],
      ["from", "2030-01-10"],
      ["governorate", "Fictional Governorate"],
      ["guests", "7"],
      ["selection", "2030-01-10:shift:1"],
      ["to", "2030-01-11"],
    ]);

    if (
      (messages.locale === "en" && testInfo.project.name === "desktop") ||
      (messages.locale === "ar" && testInfo.project.name === "mobile")
    ) {
      await root.locator("form").screenshot({
        path: testInfo.outputPath(
          `discovery-hydration-${messages.locale}-${testInfo.project.name}.png`,
        ),
      });
    }

    const submit = page.getByRole("button", {
      name: messages.submit,
      exact: true,
    });
    await pool.evaluate((input: HTMLInputElement) => {
      input.value = "unsupported-amenity";
    });
    await submit.click();
    await expect(page.getByRole("alert")).toHaveText(/\S/);
    expect(
      await page.evaluate(() => window.discoveryHydration.pushes),
    ).toHaveLength(1);
    await pool.evaluate((input: HTMLInputElement) => {
      input.value = "pool";
    });

    await guests.fill("");
    await firstShift.click();
    await expect(firstShift).toHaveAttribute("aria-pressed", "false");
    await expect(guests).toHaveValue("");
    await submit.click();
    expect(
      await page.evaluate(() => window.discoveryHydration.pushes),
    ).toHaveLength(1);

    await guests.fill("9");
    await from.fill("2030-01-11");
    await governorate.selectOption("");
    await area.selectOption("");
    await pool.uncheck();
    await expect(to).toHaveAttribute("min", "2030-01-11");
    await expect(dayGroups).toHaveCount(1);
    await expect(firstShift).toHaveAttribute("aria-pressed", "false");
    await firstShift.click();
    await expect(firstShift).toHaveAttribute("aria-pressed", "true");
    await submit.click();
    const laterPushes = await page.evaluate(
      () => window.discoveryHydration.pushes,
    );
    expect(laterPushes).toHaveLength(2);
    const laterUrl = new URL(laterPushes[1], page.url());
    expect(laterUrl.pathname).toBe(`/${messages.locale}/results`);
    expect(Array.from(laterUrl.searchParams.entries()).sort()).toEqual([
      ["from", "2030-01-11"],
      ["guests", "9"],
      ["selection", "2030-01-11:shift:1"],
      ["to", "2030-01-11"],
    ]);
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
});

test("busy action focus preserves native blocking and explicit successors", async ({
  page,
}, testInfo) => {
  const bundlePath = testInfo.outputPath("busy-action-controls.js");
  await build({
    entryPoints: ["tests/fixtures/interaction-controls.browser.tsx"],
    outfile: bundlePath,
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '\"production\"', "process.env": "{}" },
  });
  await page.goto("/api/health");
  await page.setContent(
    '<meta name="viewport" content="width=device-width, initial-scale=1"><div id="fixture-root"></div>',
  );
  await page.addStyleTag({ content: await readApplicationStylesheet() });
  await page.addScriptTag({ path: bundlePath });
  const fixture = page.getByRole("region", { name: "Busy action fixture" });
  const source = fixture.getByRole("button", { name: "Save fixture" });
  const result = fixture.getByRole("heading", { name: /^Result/ });
  const destination = fixture.getByRole("heading", { name: "Destination" });
  const elsewhere = fixture.getByRole("textbox", { name: "Busy elsewhere" });
  for (const direction of ["ltr", "rtl"] as const) {
    await page.evaluate((dir) => {
      document.documentElement.dir = dir;
    }, direction);
    await expect(destination).not.toBeFocused();
    for (const scenario of [
      "retained",
      "replacement",
      "disabled",
      "immediate",
      "fieldset",
      "direct-disabled",
      "main",
      "navigation",
      "ordinary",
      "abort",
    ] as const) {
      await page
        .getByRole("textbox", { name: "Reference", exact: true })
        .focus();
      await page.evaluate(
        (next) => Reflect.get(window, "configureBusyAction")(next),
        scenario,
      );
      await expect(fixture).toHaveAttribute("data-scenario", scenario);
      await expect(fixture).toHaveAttribute("data-stage", "source");
      if (scenario === "retained") {
        const required = fixture.getByRole("textbox", {
          name: "Required fixture value",
        });
        await required.fill("");
        await source.focus();
        await page.keyboard.press("Enter");
        await expect(fixture.getByRole("status")).toHaveText("Actions: 0");
        await expect(source).toBeEnabled();
        await expect(required).toBeFocused();
        await required.fill("Valid");
      }
      const transientToggle =
        scenario === "fieldset" || scenario === "direct-disabled";
      const originalResult = transientToggle
        ? await result.elementHandle()
        : null;
      const originalSource = await source.elementHandle();
      const originalMain = await page.locator("#busy-landmark").elementHandle();
      await source.focus();
      await page.keyboard.press(transientToggle ? "Space" : "Enter");
      if (scenario === "immediate" || scenario === "abort")
        await expect(source).toHaveCount(0);
      else {
        await expect(source).toBeDisabled();
        if (!transientToggle)
          await expect(source).toHaveAttribute("aria-busy", "true");
        else {
          await expect(source).not.toHaveAttribute("aria-busy");
          await expect(result).toBeVisible();
          await expect(result).not.toBeFocused();
          expect(
            await originalResult!.evaluate((element) => element.isConnected),
          ).toBe(true);
        }
      }
      await page.keyboard.press("Enter");
      await page.keyboard.press("Space");
      await expect(fixture.getByRole("status")).toHaveText("Actions: 1");
      if (scenario === "ordinary")
        await page.evaluate(() =>
          Reflect.get(window, "requestBusyNavigation")("unrelated-source"),
        );
      await page.evaluate(() => Reflect.get(window, "releaseBusyAction")());
      await expect(fixture).toHaveAttribute("data-stage", "result");
      if (scenario === "retained" || transientToggle) {
        await expect(source).toBeEnabled();
        await expect(source).toBeFocused();
        if (transientToggle)
          expect(
            await originalResult!.evaluate((element) => element.isConnected),
          ).toBe(true);
        expect(
          await originalSource!.evaluate(
            (element) => element === document.activeElement,
          ),
        ).toBe(true);
      } else if (scenario === "main") {
        await expect(page.locator("#busy-landmark")).toBeFocused();
        expect(
          await originalMain!.evaluate(
            (element) => element === document.activeElement,
          ),
        ).toBe(true);
        await page.evaluate(() => Reflect.get(window, "replaceBusyContent")());
        await expect(result).toHaveText("Result 1");
        expect(
          await originalMain!.evaluate(
            (element) => element === document.activeElement,
          ),
        ).toBe(true);
        await elsewhere.focus();
        await page.evaluate(() => Reflect.get(window, "replaceBusyContent")());
        await expect(result).toHaveText("Result 2");
        await expect(elsewhere).toBeFocused();
      } else if (scenario === "navigation")
        await expect(destination).toBeFocused();
      else {
        await expect(result).toBeFocused();
        await expect(destination).not.toBeFocused();
      }
      if (
        ["replacement", "disabled", "immediate", "main", "abort"].includes(
          scenario,
        )
      ) {
        const target =
          scenario === "main" ? page.locator("#busy-landmark") : result;
        if (scenario === "main") await target.focus();
        expect(
          await computed(target, [
            "outline-width",
            "outline-offset",
            "outline-style",
            "outline-color",
            "box-shadow",
          ]),
        ).toEqual([
          "3px",
          "4px",
          "solid",
          "rgb(255, 252, 245)",
          "rgb(255, 252, 245) 0px 0px 0px 2px, rgb(34, 64, 47) 0px 0px 0px 4px",
        ]);
        const colors = await target.evaluate((element) => {
          let surface = element.parentElement!;
          while (
            getComputedStyle(surface).backgroundColor === "rgba(0, 0, 0, 0)"
          )
            surface = surface.parentElement!;
          const band =
            getComputedStyle(element).boxShadow.match(/rgb\([^)]*\)/g)?.[1];
          if (!band)
            throw new Error(
              "Focused handoff target has no opaque green shadow band",
            );
          return {
            band,
            background: getComputedStyle(surface).backgroundColor,
          };
        });
        const luminance = (color: string) => {
          const channels = color
            .match(/\d+/g)!
            .map(Number)
            .slice(0, 3)
            .map((value) => {
              const c = value / 255;
              return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
            });
          return (
            channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
          );
        };
        const fg = luminance(colors.band),
          bg = luminance(colors.background);
        expect(
          (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05),
        ).toBeGreaterThanOrEqual(3);
        if (scenario === "main") {
          const originalFixture = await target.evaluateHandle(
            (element: HTMLElement) => {
              const original = {
                style: element.style.cssText,
                className: element.className,
                children: Array.from(element.childNodes),
              };
              element.classList.add("action-focus-target-inset");
              element.style.width = "192px";
              element.style.height = "64px";
              const child = document.createElement("div");
              child.dataset.focusPaintFixture = "";
              child.style.cssText =
                "width: 100%; height: 64px; margin: 0; padding: 0; border: 0; background: var(--background)";
              element.replaceChildren(child);
              return original;
            },
          );
          const child = target.locator("[data-focus-paint-fixture]");
          expect(await computed(target, ["position", "z-index"])).toEqual([
            "static",
            "auto",
          ]);
          expect(await computed(child, ["position", "z-index"])).toEqual([
            "static",
            "auto",
          ]);
          await target.scrollIntoViewIfNeeded();
          await expect(target).toBeFocused();
          expect(
            await target.evaluate((element) =>
              element.matches(":focus-visible"),
            ),
          ).toBe(true);
          const insetBounds = (await target.boundingBox())!;
          expect(insetBounds.width).toBe(192);
          expect(insetBounds.height).toBe(64);
          expect(await child.boundingBox()).toEqual(insetBounds);
          expect(
            await samplePixels(page, [
              {
                x: insetBounds.x + insetBounds.width / 2,
                y: insetBounds.y + 1,
              },
              {
                x: insetBounds.x + insetBounds.width / 2,
                y: insetBounds.y + insetBounds.height - 1,
              },
            ]),
          ).toEqual([
            [34, 64, 47],
            [34, 64, 47],
          ]);
          expect(
            await computed(target, [
              "outline-width",
              "outline-offset",
              "outline-color",
              "box-shadow",
            ]),
          ).toEqual(["3px", "-3px", "rgb(34, 64, 47)", "none"]);
          await target.evaluate((element: HTMLElement, original) => {
            element.replaceChildren(...original.children);
            element.style.cssText = original.style;
            element.className = original.className;
          }, originalFixture);
          await originalFixture.dispose();
        }
        if (scenario === "replacement") {
          await elsewhere.click();
          await result.click();
          await expect(result).toBeFocused();
          await expect(result).toHaveCSS("outline-style", "none");
        }
      }
      await originalResult?.dispose();
      await originalSource?.dispose();
      await originalMain?.dispose();
    }
    for (const cancellation of [
      "focus",
      "Tab",
      "pointer",
      "popstate",
      "blur",
      "pagehide",
    ] as const) {
      await page
        .getByRole("textbox", { name: "Reference", exact: true })
        .focus();
      await page.evaluate(() =>
        Reflect.get(window, "configureBusyAction")("navigation"),
      );
      await expect(fixture).toHaveAttribute("data-stage", "source");
      await source.focus();
      await page.keyboard.press("Enter");
      await expect(source).toBeDisabled();
      if (cancellation === "focus") await elsewhere.focus();
      else if (cancellation === "Tab") await page.keyboard.press("Tab");
      else if (cancellation === "pointer")
        await fixture.getByRole("status").click();
      else
        await page.evaluate(
          (name) => window.dispatchEvent(new Event(name)),
          cancellation,
        );
      await page.evaluate(() => Reflect.get(window, "removeBusyElsewhere")());
      await expect(elsewhere).toHaveCount(0);
      await page.evaluate(() => Reflect.get(window, "releaseBusyAction")());
      await expect(fixture).toHaveAttribute("data-stage", "result");
      await expect(destination).not.toBeFocused();
      await expect(result).not.toBeFocused();
    }
  }
});
