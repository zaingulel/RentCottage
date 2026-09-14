import { expect, test } from "@playwright/test";
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
  await expect(
    page.getByText("Use a new enquiry for a different stay."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Start an independent new enquiry" })
    .click();
  await expect(page).toHaveURL(/\/en\/messages\/[0-9a-f-]{36}\?/);
  await expect(
    page.getByRole("heading", { name: fixture.bookingCottageName }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "You can send contact details once this booking has a valid payment.",
    ),
  ).toBeVisible();
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
  await page.getByRole("button", { name: "Send message" }).click();
  const message = page
    .getByRole("list", { name: "Messages" })
    .getByRole("listitem")
    .first();
  await expect(message).toContainText("Original language: AR");
  await expect(message.locator("p[dir=rtl]")).toHaveText(
    "هل يمكننا استخدام الحديقة؟",
  );
  await message.getByRole("button", { name: "Automatic translation" }).click();
  await expect(message).toContainText("Could we use the garden?");
  await expect(message).toContainText(
    "Automatic translation · Fictional local-test translation",
  );
  await message.getByRole("button", { name: "View original" }).click();
  await expect(message.locator("p[dir=rtl]")).toHaveText(
    "هل يمكننا استخدام الحديقة؟",
  );
  await message
    .getByRole("button", { name: "Report poor translation" })
    .click();
  await expect(message.getByRole("status")).toContainText(
    "Translation reported.",
  );
  await page.screenshot({
    path: testInfo.outputPath("en-messaging-translation.png"),
    fullPage: true,
  });

  await page.getByRole("link", { name: "العربية" }).click();
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
  await page.getByRole("link", { name: "العربية" }).focus();
  await page.keyboard.press("Tab");
  const focusedLanguage = page.getByRole("link", { name: "کوردی" });
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
  await page.screenshot({
    path: testInfo.outputPath("ckb-messaging-translation.png"),
    fullPage: true,
  });
});
