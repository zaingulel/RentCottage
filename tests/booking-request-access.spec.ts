import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const ownerPhones: Record<string, string> = {
  mobile: "+9647510000000",
  desktop: "+9647510000001",
  worker: "+9647510000002",
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
  const ownerPhone = ownerPhones[testInfo.project.name];
  const customerPhone = customerPhones[testInfo.project.name];
  const offset = { mobile: 4, desktop: 5, worker: 6 }[testInfo.project.name];
  if (!ownerPhone || !customerPhone || !offset) {
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
  const { data: profiles, error: profileError } = await fixtureOwner
    .from("owner_application_cottage_profiles")
    .select("id,current_shift_schedule_id")
    .not("current_publication_id", "is", null)
    .not("current_shift_schedule_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (profileError) throw profileError;
  const profile = profiles[0];
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
  await ownerPage.screenshot({
    path: testInfo.outputPath("en-owner-booking-request-notice.png"),
    fullPage: true,
  });
  await ownerContext.close();
});
