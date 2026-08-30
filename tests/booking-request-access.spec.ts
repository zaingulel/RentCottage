import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";

type AccessBrowserFixture = {
  bookingCottageName: string;
  bookingOwnerPhone: string;
};

const { accessBrowserFixture } = createRequire(import.meta.url)(
  "../scripts/lib/access-browser-fixtures.mjs",
) as {
  accessBrowserFixture(project: string): AccessBrowserFixture;
};

const customerPhones: Record<string, string> = {
  mobile: "+9647520000000",
  desktop: "+9647520000001",
  worker: "+9647520000002",
};

function serviceDay(offset: number) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Baghdad",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(Date.now() + offset * 86_400_000));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

test("a verified Customer double-submit creates one Pending request and one minimal owner notice", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  const target = new URL(process.env.SUPABASE_URL ?? "invalid:");
  if (
    process.env.APP_ENVIRONMENT !== "test" ||
    target.protocol !== "http:" ||
    target.hostname !== "127.0.0.1"
  ) {
    throw new Error("Booking Request journey requires isolated local fixtures");
  }
  const bookingFixture = accessBrowserFixture(testInfo.project.name);
  const ownerPhone = bookingFixture.bookingOwnerPhone;
  const cottageName = bookingFixture.bookingCottageName;
  const customerPhone = customerPhones[testInfo.project.name];
  const offset = { mobile: 4, desktop: 5, worker: 6 }[testInfo.project.name];
  if (!customerPhone || !offset) {
    throw new Error("Booking fixture is unmapped");
  }

  const fixtureOwner = createClient(
    process.env.SUPABASE_URL ?? "",
    process.env.SUPABASE_PUBLISHABLE_KEY ?? "",
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { error: signInError } = await fixtureOwner.auth.signInWithPassword({
    phone: ownerPhone,
    password: "Local-test-password-2026",
  });
  if (signInError) throw signInError;
  const { data: profile, error: profileError } = await fixtureOwner
    .from("owner_application_cottage_profiles")
    .select("id,current_shift_schedule_id")
    .eq("name", cottageName)
    .not("current_publication_id", "is", null)
    .not("current_shift_schedule_id", "is", null)
    .single();
  if (profileError) throw profileError;
  if (!profile?.current_shift_schedule_id) {
    throw new Error("Published Booking Request fixture is unavailable");
  }
  const { data: shifts, error: shiftsError } = await fixtureOwner
    .from("cottage_shifts")
    .select("id,position")
    .eq("schedule_revision_id", profile.current_shift_schedule_id)
    .order("position");
  if (shiftsError) throw shiftsError;
  const { data: schedule, error: scheduleError } = await fixtureOwner
    .from("cottage_shift_schedule_revisions")
    .select("full_day_bundle_id")
    .eq("id", profile.current_shift_schedule_id)
    .single();
  if (scheduleError) throw scheduleError;
  const shift = shifts[0];
  if (!shift || !schedule.full_day_bundle_id) {
    throw new Error("Booking Request schedule fixture is incomplete");
  }
  const requestedDay = serviceDay(offset);
  const { error: pricingError } = await fixtureOwner.rpc(
    "save_cottage_inventory_pricing",
    {
      target_profile_id: profile.id,
      target_schedule_revision_id: profile.current_shift_schedule_id,
      requested_prices: {
        units: [
          ...shifts.map((item) => ({
            unitId: item.id,
            unitKind: "shift",
            standardPriceIqd: 170000 + item.position * 10000,
          })),
          {
            unitId: schedule.full_day_bundle_id,
            unitKind: "full_day_bundle",
            standardPriceIqd: 250000,
          },
        ],
      },
    },
  );
  if (pricingError) throw pricingError;
  const { error: availabilityError } = await fixtureOwner.rpc(
    "set_cottage_inventory_availability",
    {
      target_profile_id: profile.id,
      target_schedule_revision_id: profile.current_shift_schedule_id,
      target_service_day: requestedDay,
      requested_states: [
        ...shifts.map((item) => ({
          unitId: item.id,
          unitKind: "shift",
          state: "open",
        })),
        {
          unitId: schedule.full_day_bundle_id,
          unitKind: "full_day_bundle",
          state: "open",
        },
      ],
    },
  );
  if (availabilityError) throw availabilityError;

  const slug = `cottage-${profile.id.replaceAll("-", "")}`;
  const query = new URLSearchParams({
    from: requestedDay,
    to: requestedDay,
    guests: "4",
    selection: `${requestedDay}:shift:${shift.position}`,
  });
  await page.goto(`/en/request/${slug}?${query.toString()}`);
  await expect(
    page.getByRole("heading", { name: "Verify your phone to continue" }),
  ).toBeVisible();
  await page.getByLabel("Iraqi phone number").fill(customerPhone);
  await page.getByRole("button", { name: "Send verification code" }).click();
  const verificationCode = page.getByLabel("Verification code");
  await expect(verificationCode).toBeVisible();
  await verificationCode.fill("123456");
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Send your Booking Request" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "العربية" }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(
    page.getByRole("heading", { name: "أرسل طلب الحجز" }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("ar-booking-request-form.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "English" }).click();
  await expect(
    page.getByRole("heading", { name: "Send your Booking Request" }),
  ).toBeVisible();
  await page.getByLabel("Customer name").fill("Browser Customer");
  await page.getByLabel(/accept the preserved House Rules/i).check();
  await page.getByLabel(/accept the cancellation policy/i).check();
  await page.getByLabel(/accept the marketplace booking terms/i).check();
  await page
    .getByRole("form", { name: "Send your Booking Request" })
    .evaluate((form) => {
      (form as HTMLFormElement).requestSubmit();
      (form as HTMLFormElement).requestSubmit();
    });

  await expect(
    page.getByRole("heading", { name: "Booking Request pending" }),
  ).toBeVisible();
  await expect(page.getByText(/does not reserve/)).toHaveCount(0);
  await expect(page.getByText("Owner response deadline")).toBeVisible();
  const requestReference = await page
    .getByText(/^RC-REQ-[A-F0-9]{16}$/)
    .innerText();
  expect(requestReference).toMatch(/^RC-REQ-[A-F0-9]{16}$/);
  await page.screenshot({
    path: testInfo.outputPath("en-booking-request-pending.png"),
    fullPage: true,
  });
  const ownerContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  });
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto("/en/owner/access");
  await ownerPage.getByLabel("Iraqi phone number").fill(ownerPhone);
  await ownerPage
    .getByRole("button", { name: "Send verification code" })
    .click();
  await ownerPage.getByLabel("Verification code").fill("123456");
  await ownerPage.getByRole("button", { name: "Verify", exact: true }).click();
  await ownerPage.getByRole("link", { name: "Open Cottage Profiles" }).click();
  const ownerNotice = ownerPage.getByRole("article", {
    name: requestReference,
  });
  await expect(ownerNotice).toBeVisible();
  await expect(ownerNotice).toContainText("Browser Customer");
  await expect(ownerNotice).not.toContainText(/provider|payment|phone|@/i);
  await expect(ownerNotice).toContainText("Marketplace commission");
  await expect(ownerNotice).toContainText("Expected net amount");
  await expect(ownerNotice).toContainText("House Rules");
  await expect(ownerNotice).toContainText("Marketplace terms version");
  await expect(ownerNotice).toContainText("(Cottage Shift)");
  await ownerPage.screenshot({
    path: testInfo.outputPath("en-owner-booking-request-notice.png"),
    fullPage: true,
  });

  async function submitAnotherRequest(locale: "en" | "ckb") {
    await page.goto(`/${locale}/request/${slug}?${query.toString()}`);
    const form = page.locator("form.booking-request-form");
    await form.getByRole("textbox").first().fill("Browser Customer");
    const checkboxes = form.getByRole("checkbox");
    for (let index = 0; index < (await checkboxes.count()); index += 1) {
      await checkboxes.nth(index).check();
    }
    await form.evaluate((node) => (node as HTMLFormElement).requestSubmit());
    const reference = page.getByText(/^RC-REQ-[A-F0-9]{16}$/);
    await expect(reference).toBeVisible();
    return reference.innerText();
  }

  if (testInfo.project.name === "mobile") {
    await ownerPage.goto("/ar/owner/cottages");
    const arabicNotice = ownerPage.getByRole("article", {
      name: requestReference,
    });
    await arabicNotice
      .getByLabel("سبب الرفض")
      .selectOption("cottage_unavailable");
    await arabicNotice
      .getByLabel("ملاحظة اختيارية للعميل")
      .fill("صيانة مجدولة للمسبح.");
    await arabicNotice
      .getByRole("button", { name: "رفض الطلب كاملاً" })
      .click();
    await expect(
      arabicNotice.getByText("مرفوض", { exact: true }),
    ).toBeVisible();
    await ownerPage.reload();
    await expect(
      ownerPage.getByText("إشعار الحالة", { exact: true }),
    ).toBeVisible();
    await ownerPage.screenshot({
      path: testInfo.outputPath("ar-owner-booking-request-declined.png"),
      fullPage: true,
    });
    await page.goto(`/ar/booking-requests/${requestReference}`);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(
      page.getByText("البيت غير متاح", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("ar-customer-booking-request-declined.png"),
      fullPage: true,
    });
    const secondReference = await submitAnotherRequest("ckb");
    await page.goto(`/ckb/booking-requests/${secondReference}`);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByText("چاوەڕێ", { exact: true })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("ckb-customer-booking-request-pending.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "کشاندنەوەی داواکاری چاوەڕێ" })
      .click();
    await expect(page.getByText("کشێنراوەتەوە", { exact: true })).toBeVisible();
    await page.reload();
    await expect(
      page.getByText("ئاگادارکردنەوەی دۆخ", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("ckb-customer-booking-request-withdrawn.png"),
      fullPage: true,
    });
  } else if (testInfo.project.name === "desktop") {
    await ownerNotice
      .getByLabel("Decline reason")
      .selectOption("cannot_accommodate_request");
    await ownerNotice
      .getByLabel("Optional note to the Customer")
      .fill("The requested party cannot be accommodated safely.");
    await ownerNotice
      .getByRole("button", { name: "Decline complete request" })
      .click();
    await expect(
      ownerNotice.getByText("Declined", { exact: true }),
    ).toBeVisible();
    await ownerPage.reload();
    await expect(
      ownerPage.getByText("Status notification", { exact: true }),
    ).toBeVisible();
    await ownerPage.screenshot({
      path: testInfo.outputPath("en-owner-booking-request-declined.png"),
      fullPage: true,
    });
    await page.goto(`/en/booking-requests/${requestReference}`);
    await expect(
      page.getByText("Cannot accommodate this request", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("The requested party cannot be accommodated safely.", {
        exact: true,
      }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("en-customer-booking-request-declined.png"),
      fullPage: true,
    });

    const processingReference = await submitAnotherRequest("en");
    await page.goto(`/en/booking-requests/${processingReference}`);
    await page.route(page.url(), async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const response = await route.fetch();
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      await route.fulfill({ response });
    });
    await page
      .getByRole("button", { name: "Withdraw pending request" })
      .click();
    await expect(page.getByText("Processing", { exact: true })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("en-customer-booking-request-processing.png"),
      fullPage: true,
    });
    await expect(page.getByText("Withdrawn", { exact: true })).toBeVisible();
    const scheduledExpiryReference = await submitAnotherRequest("en");
    await page.goto(`/en/booking-requests/${scheduledExpiryReference}`);
    await expect(page.getByText("Pending", { exact: true })).toBeVisible();
  } else {
    await ownerNotice
      .getByRole("button", { name: "Accept complete request" })
      .click();
    await expect(
      ownerNotice.getByText("Accepted", { exact: true }),
    ).toBeVisible();
    await ownerPage.reload();
    await expect(
      ownerPage.getByText("Status notification", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "View and manage this request" })
      .click();
    await expect(page.getByText("Accepted", { exact: true })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("en-customer-booking-request-accepted.png"),
      fullPage: true,
    });
  }
  await ownerContext.close();
});
