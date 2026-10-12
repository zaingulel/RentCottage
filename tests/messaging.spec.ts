import { expect, test } from "@playwright/test";
import { openHeaderPanel } from "./fixtures/site-header";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";

type MessagingBrowserFixture = {
  readonly bookingCottageName: string;
  readonly bookingOwnerPhone: string;
};

const { accessBrowserFixture } = createRequire(import.meta.url)(
  "../scripts/lib/access-browser-fixtures.mjs",
) as {
  accessBrowserFixture(project: string): MessagingBrowserFixture;
};

const customerPhones: Record<string, string> = {
  mobile: "+9647560000000",
  desktop: "+9647560000001",
  worker: "+9647560000002",
};

test("booking customer keeps the original while using fictional translations across directions", async ({
  page,
}, testInfo) => {
  page.on("console", (message) => {
    if (
      message.type() === "info" &&
      message.text().startsWith("FOCUS_BASELINE ")
    ) {
      console.log(message.text());
    }
  });
  const phone = customerPhones[testInfo.project.name];
  if (!phone) throw new Error("Messaging browser fixture project is unknown");
  const url = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error(
      "Messaging browser fixture database credentials are missing",
    );
  }
  const fixture = accessBrowserFixture(testInfo.project.name);
  const fixtureOwner = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const signedInOwner = await fixtureOwner.auth.signInWithPassword({
    phone: fixture.bookingOwnerPhone,
    password: "Local-test-password-2026",
  });
  if (signedInOwner.error) throw signedInOwner.error;
  const profile = await fixtureOwner
    .from("owner_application_cottage_profiles")
    .select("id")
    .eq("name", fixture.bookingCottageName)
    .single();
  if (profile.error || !profile.data) {
    throw new Error("Messaging browser Cottage Profile is missing", {
      cause: profile.error,
    });
  }
  const slug = `cottage-${profile.data.id.replaceAll("-", "")}`;

  const contextQuery =
    "from=2101-01-01&to=2101-01-01&guests=4&selection=2101-01-01%3Ashift%3A1";
  await page.goto(`/en/messages?cottage=${slug}&${contextQuery}`);
  await expect(
    page.getByRole("heading", { name: "Sign in or create an account" }),
  ).toBeVisible();
  await page.getByLabel("Iraqi phone number").fill(phone);
  await page.getByRole("button", { name: "Send verification code" }).click();
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Verify", exact: true }).click();

  await expect(
    page.getByRole("heading", { name: "Message this cottage" }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("page-messages-en.png"),
    fullPage: true,
  });
  await expect(
    page.getByText("Use a new enquiry for a different stay."),
  ).toBeVisible();
  const startControl = page.getByRole("button", {
    name: "Start an independent new enquiry",
  });
  await startControl.focus();
  await expect(startControl).toBeFocused();
  const startSource = await startControl.elementHandle();
  if (!startSource) throw new Error("Focus measurement source is missing");
  const startMeasurement = await startSource.evaluateHandle(
    (source, labels) => {
      const read = (phase: string) => {
        console.info(
          "FOCUS_BASELINE " +
            JSON.stringify({
              ...labels,
              phase,
              pathname: location.pathname,
              locale: document.documentElement.lang,
              direction: document.documentElement.dir,
              activeTag: document.activeElement?.tagName ?? null,
              activeId: document.activeElement?.id ?? null,
              sourceConnected: source.isConnected,
              sourceDisabled: source.matches(":disabled"),
              sourceBusy: source.getAttribute("aria-busy"),
              sameNode: source.isConnected,
            }),
        );
      };
      let previous = "";
      const observer = new MutationObserver(() => {
        const current = JSON.stringify([
          source.isConnected,
          source.matches(":disabled"),
          source.getAttribute("aria-busy"),
          location.pathname,
        ]);
        if (current !== previous) {
          previous = current;
          read("transition");
        }
      });
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["disabled", "aria-busy"],
      });
      read("before");
      return { read, observer };
    },
    { family: "messaging-start", action: "Start conversation" },
  );
  await startControl.press("Enter");
  await expect(page).toHaveURL(/\/en\/messages\/[0-9a-f-]{36}\?/);
  await expect(
    page.getByRole("heading", { name: fixture.bookingCottageName }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: fixture.bookingCottageName, level: 1 }),
  ).toBeFocused();
  await expect(
    page.getByText(
      "You can send contact details once this booking has a valid payment.",
    ),
  ).toBeVisible();
  await startMeasurement.evaluate((measurement) => {
    measurement.read("settled");
    measurement.observer.disconnect();
  });
  await startMeasurement.dispose();
  await startSource.dispose();
  const conversationId = new URL(page.url()).pathname.split("/").at(-1);
  const bookingHref = await page
    .getByRole("link", { name: "Booking request" })
    .getAttribute("href");
  const bookingUrl = new URL(bookingHref ?? "", "http://rentcottage.test");
  expect(bookingUrl.pathname).toBe(`/en/request/${slug}`);
  expect(Object.fromEntries(bookingUrl.searchParams)).toEqual({
    from: "2101-01-01",
    to: "2101-01-01",
    guests: "4",
    selection: "2101-01-01:shift:1",
    conversation: conversationId,
  });

  await page.getByLabel("Message language").selectOption("ar");
  await page
    .getByLabel("Message", { exact: true })
    .fill("هل يمكننا استخدام الحديقة؟");
  const sendEnControl = page.getByRole("button", { name: "Send message" });
  await sendEnControl.focus();
  await expect(sendEnControl).toBeFocused();
  const sendEnSource = await sendEnControl.elementHandle();
  if (!sendEnSource) throw new Error("Focus measurement source is missing");
  const sendEnMeasurement = await sendEnSource.evaluateHandle(
    (source, labels) => {
      const read = (phase: string) => {
        console.info(
          "FOCUS_BASELINE " +
            JSON.stringify({
              ...labels,
              phase,
              pathname: location.pathname,
              locale: document.documentElement.lang,
              direction: document.documentElement.dir,
              activeTag: document.activeElement?.tagName ?? null,
              activeId: document.activeElement?.id ?? null,
              sourceConnected: source.isConnected,
              sourceDisabled: source.matches(":disabled"),
              sourceBusy: source.getAttribute("aria-busy"),
              sameNode: source.isConnected,
            }),
        );
      };
      let previous = "";
      const observer = new MutationObserver(() => {
        const current = JSON.stringify([
          source.isConnected,
          source.matches(":disabled"),
          source.getAttribute("aria-busy"),
          location.pathname,
        ]);
        if (current !== previous) {
          previous = current;
          read("transition");
        }
      });
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["disabled", "aria-busy"],
      });
      read("before");
      return { read, observer };
    },
    { family: "messaging-conversation", action: "Send English" },
  );
  await sendEnControl.press("Enter");
  const message = page
    .getByRole("list", { name: "Messages" })
    .getByRole("listitem")
    .first();
  await expect(message).toContainText("Original language: العربية");
  await expect(message.locator("p[dir=rtl]")).toHaveText(
    "هل يمكننا استخدام الحديقة؟",
  );
  await expect(sendEnControl).toBeFocused();
  await sendEnMeasurement.evaluate((measurement) => {
    measurement.read("settled");
    measurement.observer.disconnect();
  });
  await sendEnMeasurement.dispose();
  await sendEnSource.dispose();
  const translateEnControl = message.getByRole("button", {
    name: "Automatic translation",
  });
  await translateEnControl.focus();
  await expect(translateEnControl).toBeFocused();
  const translateEnSource = await translateEnControl.elementHandle();
  if (!translateEnSource)
    throw new Error("Focus measurement source is missing");
  const translateEnMeasurement = await translateEnSource.evaluateHandle(
    (source, labels) => {
      const read = (phase: string) => {
        console.info(
          "FOCUS_BASELINE " +
            JSON.stringify({
              ...labels,
              phase,
              pathname: location.pathname,
              locale: document.documentElement.lang,
              direction: document.documentElement.dir,
              activeTag: document.activeElement?.tagName ?? null,
              activeId: document.activeElement?.id ?? null,
              sourceConnected: source.isConnected,
              sourceDisabled: source.matches(":disabled"),
              sourceBusy: source.getAttribute("aria-busy"),
              sameNode: source.isConnected,
            }),
        );
      };
      let previous = "";
      const observer = new MutationObserver(() => {
        const current = JSON.stringify([
          source.isConnected,
          source.matches(":disabled"),
          source.getAttribute("aria-busy"),
          location.pathname,
        ]);
        if (current !== previous) {
          previous = current;
          read("transition");
        }
      });
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["disabled", "aria-busy"],
      });
      read("before");
      return { read, observer };
    },
    { family: "messaging-conversation", action: "Translate English" },
  );
  await translateEnControl.press("Enter");
  await expect(message).toContainText("Could we use the garden?");
  await expect(message).toContainText(
    "Automatic translation · Fictional local-test translation",
  );
  await expect(
    message.getByRole("button", { name: "View original" }),
  ).toBeFocused();
  await translateEnMeasurement.evaluate((measurement) => {
    measurement.read("settled");
    measurement.observer.disconnect();
  });
  await translateEnMeasurement.dispose();
  await translateEnSource.dispose();
  await message.getByRole("button", { name: "View original" }).click();
  await expect(message.locator("p[dir=rtl]")).toHaveText(
    "هل يمكننا استخدام الحديقة؟",
  );
  const reportEnControl = message.getByRole("button", {
    name: "Report poor translation",
  });
  await reportEnControl.focus();
  await expect(reportEnControl).toBeFocused();
  const reportEnSource = await reportEnControl.elementHandle();
  if (!reportEnSource) throw new Error("Focus measurement source is missing");
  const reportEnMeasurement = await reportEnSource.evaluateHandle(
    (source, labels) => {
      const read = (phase: string) => {
        console.info(
          "FOCUS_BASELINE " +
            JSON.stringify({
              ...labels,
              phase,
              pathname: location.pathname,
              locale: document.documentElement.lang,
              direction: document.documentElement.dir,
              activeTag: document.activeElement?.tagName ?? null,
              activeId: document.activeElement?.id ?? null,
              sourceConnected: source.isConnected,
              sourceDisabled: source.matches(":disabled"),
              sourceBusy: source.getAttribute("aria-busy"),
              sameNode: source.isConnected,
            }),
        );
      };
      let previous = "";
      const observer = new MutationObserver(() => {
        const current = JSON.stringify([
          source.isConnected,
          source.matches(":disabled"),
          source.getAttribute("aria-busy"),
          location.pathname,
        ]);
        if (current !== previous) {
          previous = current;
          read("transition");
        }
      });
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["disabled", "aria-busy"],
      });
      read("before");
      return { read, observer };
    },
    { family: "messaging-conversation", action: "Report English" },
  );
  await reportEnControl.press("Enter");
  await expect(message.getByRole("status")).toContainText(
    "Translation reported.",
  );
  await expect(
    message.getByRole("button", { name: "View translation" }),
  ).toBeFocused();
  await reportEnMeasurement.evaluate((measurement) => {
    measurement.read("settled");
    measurement.observer.disconnect();
  });
  await reportEnMeasurement.dispose();
  await reportEnSource.dispose();

  await openHeaderPanel(page, "language");
  await page.getByRole("banner").getByRole("link", { name: "العربية" }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  expect(new URL(page.url()).searchParams.get("selection")).toBe(
    "2101-01-01:shift:1",
  );
  const arabicMessage = page
    .getByRole("list", { name: "الرسائل" })
    .getByRole("listitem")
    .first();
  await expect(arabicMessage.locator("p[dir=rtl]")).toHaveText(
    "هل يمكننا استخدام الحديقة؟",
  );
  await page.getByLabel("لغة الرسالة").selectOption("ar");
  await page
    .getByLabel("الرسالة", { exact: true })
    .fill("هل يمكننا استخدام الحديقة؟");
  const sendArControl = page.getByRole("button", { name: "إرسال الرسالة" });
  await sendArControl.focus();
  await expect(sendArControl).toBeFocused();
  const sendArSource = await sendArControl.elementHandle();
  if (!sendArSource) throw new Error("Focus measurement source is missing");
  const sendArMeasurement = await sendArSource.evaluateHandle(
    (source, labels) => {
      const read = (phase: string) => {
        console.info(
          "FOCUS_BASELINE " +
            JSON.stringify({
              ...labels,
              phase,
              pathname: location.pathname,
              locale: document.documentElement.lang,
              direction: document.documentElement.dir,
              activeTag: document.activeElement?.tagName ?? null,
              activeId: document.activeElement?.id ?? null,
              sourceConnected: source.isConnected,
              sourceDisabled: source.matches(":disabled"),
              sourceBusy: source.getAttribute("aria-busy"),
              sameNode: source.isConnected,
            }),
        );
      };
      let previous = "";
      const observer = new MutationObserver(() => {
        const current = JSON.stringify([
          source.isConnected,
          source.matches(":disabled"),
          source.getAttribute("aria-busy"),
          location.pathname,
        ]);
        if (current !== previous) {
          previous = current;
          read("transition");
        }
      });
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["disabled", "aria-busy"],
      });
      read("before");
      return { read, observer };
    },
    { family: "messaging-conversation", action: "Send Arabic" },
  );
  await sendArControl.press("Enter");
  await expect(page.getByLabel("الرسالة", { exact: true })).toHaveValue("");
  await expect(sendArControl).toBeFocused();
  await sendArMeasurement.evaluate((measurement) => {
    measurement.read("settled");
    measurement.observer.disconnect();
  });
  await sendArMeasurement.dispose();
  await sendArSource.dispose();
  await openHeaderPanel(page, "language");
  await page.getByRole("banner").getByRole("link", { name: "English" }).focus();
  await page.keyboard.press("Tab");
  const focusedLanguage = page
    .getByRole("banner")
    .getByRole("link", { name: "کوردی" });
  await expect(focusedLanguage).toBeFocused();
  expect(
    await focusedLanguage.evaluate(
      (element) => getComputedStyle(element).outlineStyle,
    ),
  ).not.toBe("none");
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const ckbMessage = page
    .getByRole("list", { name: "نامەکان" })
    .getByRole("listitem")
    .first();
  await ckbMessage.getByRole("button", { name: "وەرگێڕانی خۆکار" }).click();
  await expect(ckbMessage).toContainText("دەتوانین باخچەکە بەکاربهێنین؟");
  await expect(ckbMessage).toContainText(
    "وەرگێڕانی خۆکار · وەرگێڕانی خەیاڵی تاقیکردنەوەی ناوخۆیی",
  );
  expect(
    await page.locator("body").evaluate((body) => body.scrollWidth),
  ).toBeLessThanOrEqual(
    await page.locator("body").evaluate((body) => body.clientWidth),
  );

  const longMessage = "W".repeat(1000);
  await page.getByLabel("نامە", { exact: true }).fill(longMessage);
  await page.getByRole("button", { name: "نامە بنێرە" }).click();
  await expect(
    page.getByRole("list", { name: "نامەکان" }).getByText(longMessage),
  ).toBeVisible();
  await page.goto("/ckb/messages");
  await expect(
    page.getByRole("listitem").filter({ hasText: longMessage }),
  ).toBeVisible();
  expect(
    await page.locator("body").evaluate((body) => body.scrollWidth),
  ).toBeLessThanOrEqual(
    await page.locator("body").evaluate((body) => body.clientWidth),
  );
});
