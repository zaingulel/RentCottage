import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import * as OTPAuth from "otpauth";
import { createClient } from "@supabase/supabase-js";

type AccessBrowserFixture = {
  bookingCottageName: string;
  bookingOwnerPhone: string;
  reviewCottageName: string;
  reviewLegalName: string;
  reviewOwnerPhone: string;
};

const { accessBrowserFixture } = createRequire(import.meta.url)(
  "../scripts/lib/access-browser-fixtures.mjs",
) as {
  accessBrowserFixture(project: string): AccessBrowserFixture;
};

const administratorEmail = "platform-administrator-desktop@rentcottage.test";
const customerPhone = "+9647520000001";
const fixturePassword = "Local-test-password-2026";
const verificationCode = "123456";
const videoPath = resolve("test-results/demo/rentcottage-mvp-walkthrough.webm");

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

function requireIsolatedLocalDemo() {
  const target = new URL(process.env.SUPABASE_URL ?? "invalid:");
  if (
    process.env.APP_ENVIRONMENT !== "test" ||
    process.env.SUPABASE_PROJECT_REF !== "local-test" ||
    target.protocol !== "http:" ||
    target.hostname !== "127.0.0.1"
  ) {
    throw new Error(
      "The demo walkthrough requires the isolated local test environment",
    );
  }
}

async function expectScene(locator: Locator, milliseconds = 1_200) {
  await expect(locator).toBeVisible();
  await locator.page().waitForTimeout(milliseconds);
}

async function coverPrivateTransition(page: Page, title: string) {
  return page.screencast.showOverlay(
    `<section style="position:fixed;inset:0;z-index:2147483646;display:grid;place-content:center;background:#102c26;color:white;text-align:center;font:700 52px/1.2 system-ui">${title}<small style="display:block;margin-top:18px;font:500 24px/1.4 system-ui">Local demo · Synthetic data only</small></section>`,
  );
}

async function clearBrowserSession(page: Page) {
  await page.context().clearCookies();
  await page.goto("/en");
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
}

async function prepareDemoState() {
  requireIsolatedLocalDemo();
  const fixture = accessBrowserFixture("desktop");
  const url = process.env.SUPABASE_URL ?? "";
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
  const secretKey = process.env.SUPABASE_SECRET_KEY ?? "";
  const privileged = createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const users = await privileged.auth.admin.listUsers({ perPage: 1000 });
  if (users.error) throw users.error;
  const normalizedPhone = (phone: string) => phone.replace(/^\+/, "");
  const reviewUser = users.data.users.find(
    (user) => user.phone === normalizedPhone(fixture.reviewOwnerPhone),
  );
  const administrator = users.data.users.find(
    (user) => user.email === administratorEmail,
  );
  if (!reviewUser || !administrator) {
    throw new Error("The exact synthetic desktop demo identities are missing");
  }
  const reviewOwner = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const reviewOwnerSignIn = await reviewOwner.auth.signInWithPassword({
    phone: fixture.reviewOwnerPhone,
    password: fixturePassword,
  });
  if (reviewOwnerSignIn.error) throw reviewOwnerSignIn.error;
  const reviewApplication = await reviewOwner
    .from("owner_applications")
    .select("id,status,legal_name")
    .eq("owner_user_id", reviewUser.id)
    .single();
  if (
    reviewApplication.error ||
    !["submitted", "under_review"].includes(reviewApplication.data.status) ||
    reviewApplication.data.legal_name !== fixture.reviewLegalName
  ) {
    throw new Error(
      "The exact synthetic administrator queue item is incompatible",
    );
  }
  const reviewProfile = await reviewOwner
    .from("owner_application_cottage_profiles")
    .select("name")
    .eq("application_id", reviewApplication.data.id)
    .single();
  if (
    reviewProfile.error ||
    reviewProfile.data.name !== fixture.reviewCottageName
  ) {
    throw new Error(
      "The exact synthetic administrator cottage is incompatible",
    );
  }
  const reviewOwnerSignOut = await reviewOwner.auth.signOut();
  if (reviewOwnerSignOut.error) throw reviewOwnerSignOut.error;

  const factors = await privileged.auth.admin.mfa.listFactors({
    userId: administrator.id,
  });
  if (factors.error) throw factors.error;
  for (const factor of factors.data.factors) {
    const deleted = await privileged.auth.admin.mfa.deleteFactor({
      userId: administrator.id,
      id: factor.id,
    });
    if (deleted.error) throw deleted.error;
  }
  const administratorClient = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const signedInAdministrator =
    await administratorClient.auth.signInWithPassword({
      email: administratorEmail,
      password: fixturePassword,
    });
  if (signedInAdministrator.error) throw signedInAdministrator.error;
  const enrollment = await administratorClient.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "RentCottage demo administrator",
  });
  if (enrollment.error) throw enrollment.error;
  const challenge = await administratorClient.auth.mfa.challenge({
    factorId: enrollment.data.id,
  });
  if (challenge.error) throw challenge.error;
  const administratorTotp = new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(enrollment.data.totp.secret),
  });
  const verifiedFactor = await administratorClient.auth.mfa.verify({
    factorId: enrollment.data.id,
    challengeId: challenge.data.id,
    code: administratorTotp.generate(),
  });
  if (verifiedFactor.error) throw verifiedFactor.error;
  const administratorSignOut = await administratorClient.auth.signOut();
  if (administratorSignOut.error) throw administratorSignOut.error;

  const owner = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const ownerSignIn = await owner.auth.signInWithPassword({
    phone: fixture.bookingOwnerPhone,
    password: fixturePassword,
  });
  if (ownerSignIn.error) throw ownerSignIn.error;
  const profile = await owner
    .from("owner_application_cottage_profiles")
    .select("id,name,current_publication_id,current_shift_schedule_id")
    .eq("name", fixture.bookingCottageName)
    .single();
  if (
    profile.error ||
    !profile.data.current_publication_id ||
    !profile.data.current_shift_schedule_id
  ) {
    throw new Error(
      "The exact published synthetic demo cottage is incompatible",
    );
  }
  const shifts = await owner
    .from("cottage_shifts")
    .select("id,position")
    .eq("schedule_revision_id", profile.data.current_shift_schedule_id)
    .order("position");
  const schedule = await owner
    .from("cottage_shift_schedule_revisions")
    .select("full_day_bundle_id")
    .eq("id", profile.data.current_shift_schedule_id)
    .single();
  const shift = shifts.data?.[0];
  if (
    shifts.error ||
    schedule.error ||
    !shift ||
    !schedule.data.full_day_bundle_id
  ) {
    throw new Error("The synthetic demo cottage schedule is incompatible");
  }
  const dateOffset = 30 + (Math.floor(Date.now() / 60_000) % 300);
  const recordedDay = serviceDay(dateOffset);
  const liveDemoDay = serviceDay(dateOffset + 1);
  for (const day of [recordedDay, liveDemoDay]) {
    const availability = await owner.rpc("set_cottage_inventory_availability", {
      target_profile_id: profile.data.id,
      target_schedule_revision_id: profile.data.current_shift_schedule_id,
      target_service_day: day,
      requested_states: [
        ...(shifts.data ?? []).map((item) => ({
          unitId: item.id,
          unitKind: "shift",
          state: "open",
        })),
        {
          unitId: schedule.data.full_day_bundle_id,
          unitKind: "full_day_bundle",
          state: "open",
        },
      ],
    });
    if (availability.error) throw availability.error;
  }
  const pricing = await owner.rpc("load_cottage_inventory_owner_editor_state", {
    target_profile_id: profile.data.id,
    target_schedule_revision_id: profile.data.current_shift_schedule_id,
    target_service_day: null,
  });
  if (
    pricing.error ||
    !Array.isArray(pricing.data?.units) ||
    pricing.data.units.some(
      (unit: { standardPriceIqd?: number | null }) =>
        !unit.standardPriceIqd || unit.standardPriceIqd <= 0,
    )
  ) {
    throw new Error("The synthetic demo cottage pricing is incompatible");
  }
  const ownerSignOut = await owner.auth.signOut();
  if (ownerSignOut.error) throw ownerSignOut.error;

  return {
    administratorTotp,
    cottageName: fixture.bookingCottageName,
    ownerPhone: fixture.bookingOwnerPhone,
    profileId: profile.data.id,
    recordedDay,
    reviewLegalName: fixture.reviewLegalName,
    shiftPosition: shift.position,
  };
}

async function verifyPhone(page: Page, phone: string) {
  await page.getByLabel("Iraqi phone number").fill(phone);
  await page.getByRole("button", { name: "Send verification code" }).click();
  await expect(page.getByLabel("Verification code")).toBeVisible();
  await page.getByLabel("Verification code").fill(verificationCode);
  await page.getByRole("button", { name: "Verify", exact: true }).click();
}

test("records the continuous local RentCottage MVP story", async ({ page }) => {
  test.setTimeout(240_000);
  const demo = await prepareDemoState();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await mkdir(resolve(videoPath, ".."), { recursive: true });
  await page.screencast.start({
    path: videoPath,
    quality: 90,
    size: { width: 1920, height: 1080 },
    annotate: { duration: 900, fontSize: 28, position: "top-right" },
  });
  await page.screencast.showActions({ duration: 900, fontSize: 28 });
  await page.screencast.showOverlay(
    `<aside style="position:fixed;z-index:2147483647;right:24px;bottom:20px;max-width:760px;padding:12px 18px;border-radius:12px;background:#102c26ee;color:white;font:600 18px/1.35 system-ui;box-shadow:0 8px 30px #0006">Local demo · Synthetic data · Simulated payment · Fictional, non-operative Booking Terms</aside>`,
  );

  await page.screencast.showChapter("Marketplace and languages", {
    description: "English, Arabic, and Sorani with right-to-left layouts",
    duration: 1_400,
  });
  await page.goto("/en");
  await expectScene(
    page.getByRole("heading", {
      level: 1,
      name: "A house in the countryside, all yours",
    }),
  );
  await page.getByRole("button", { name: "العربية" }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expectScene(
    page.getByRole("heading", { name: "بيتٌ في الريف، لكم وحدكم" }),
  );
  await page.getByRole("button", { name: "کوردی" }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expectScene(
    page.getByRole("heading", { name: "ماڵێک لە گوند، تەنها بۆ ئێوە" }),
  );
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");

  await page.screencast.showChapter("Platform Administrator", {
    description: "Synthetic email, masked password, and authenticator MFA",
    duration: 1_400,
  });
  await page.goto("/en/administrator/access");
  await expectScene(
    page.getByRole("heading", { name: "Administrator access" }),
  );
  await page.getByLabel("Email").fill(administratorEmail);
  await page.screencast.hideActions();
  await page.getByLabel("Password").fill(fixturePassword);
  await expect(page.getByLabel("Password")).toHaveAttribute("type", "password");
  await expect(page.getByLabel("Password")).toHaveValue(fixturePassword);
  await expectScene(page.getByLabel("Password"));
  await page.getByRole("button", { name: "Continue" }).click();
  await page.screencast.showActions({ duration: 900, fontSize: 28 });
  await expect(
    page.getByText("Enter the code from your authenticator app."),
  ).toBeVisible();
  await expect(page.getByTestId("mfa-secret")).toHaveCount(0);
  await expect(page.getByRole("img", { name: /QR/i })).toHaveCount(0);
  await page
    .getByLabel("Authenticator app code")
    .fill(demo.administratorTotp.generate());
  await page.getByRole("button", { name: "Verify" }).click();
  await expectScene(page.getByText(/Administrator access is ready/));
  const administratorQueueCover = await coverPrivateTransition(
    page,
    "Safe synthetic administrator queue",
  );
  await page
    .getByRole("link", { name: "Review submitted Owner Applications" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Submitted Owner Applications" }),
  ).toBeVisible();
  await page
    .locator(".administrator-review-card")
    .evaluateAll((cards, legalName) => {
      for (const card of cards) {
        const isTarget = card.textContent?.includes(legalName);
        (card as HTMLElement).style.display = isTarget ? "block" : "none";
        if (isTarget) {
          const documentList = card.querySelector("ul") as HTMLElement | null;
          if (documentList) documentList.style.display = "none";
        }
      }
    }, demo.reviewLegalName);
  const safeReview = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: demo.reviewLegalName }),
  });
  await safeReview.scrollIntoViewIfNeeded();
  await administratorQueueCover.dispose();
  await expectScene(
    safeReview.getByRole("heading", { name: demo.reviewLegalName }),
  );
  await expect(safeReview.getByText(/under review|submitted/i)).toBeVisible();
  await expect(
    page.locator(".administrator-review-filename:visible"),
  ).toHaveCount(0);
  await expect(page.getByText("Synthetic private fixture address")).toHaveCount(
    0,
  );

  await clearBrowserSession(page);
  await page.screencast.showChapter("Cottage Owner", {
    description: "Published cottage, shift prices, and future availability",
    duration: 1_400,
  });
  await page.goto("/en/owner/access");
  await expectScene(
    page.getByRole("heading", { name: "Cottage Owner access" }),
  );
  await verifyPhone(page, demo.ownerPhone);
  await expectScene(page.getByText(/private Cottage Profiles are ready/));
  await page.getByRole("link", { name: "Open Cottage Profiles" }).click();
  const cottageCard = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: demo.cottageName }),
  });
  await expectScene(
    cottageCard.getByRole("heading", { name: demo.cottageName }),
  );
  await cottageCard.getByRole("link", { name: "Open Cottage Profile" }).click();
  const publishedStatus = page.getByText("Published", { exact: true });
  await publishedStatus.scrollIntoViewIfNeeded();
  await expectScene(publishedStatus);
  const inventory = page.getByRole("heading", {
    name: "Pricing and availability",
  });
  await inventory.scrollIntoViewIfNeeded();
  await expectScene(inventory);
  await expect(page.getByLabel("Shift 1 standard price")).toHaveValue(/\d+/);
  const loadAvailability = page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: "Load availability" }) });
  await loadAvailability
    .locator('input[name="serviceDay"]')
    .fill(demo.recordedDay);
  await loadAvailability
    .getByRole("button", { name: "Load availability" })
    .click();
  await expectScene(
    page.getByRole("heading", {
      name: `Availability for a future Service Day: ${demo.recordedDay}`,
    }),
  );
  await expect(page.getByLabel("Shift 1 operational state")).toHaveValue(
    "open",
  );
  await expect(page.getByText("Synthetic private fixture address")).toHaveCount(
    0,
  );

  await clearBrowserSession(page);
  await page.screencast.showChapter("Customer", {
    description: "Discovery, exact quote, verification, and Booking Request",
    duration: 1_400,
  });
  await page.goto("/en");
  await page.getByLabel("From Service Day").fill(demo.recordedDay);
  await page.getByLabel("To Service Day").fill(demo.recordedDay);
  await page
    .getByRole("group", { name: demo.recordedDay })
    .getByLabel("Shift 1")
    .check();
  await page.getByRole("button", { name: "Search available cottages" }).click();
  await expectScene(page.getByRole("heading", { name: "Available cottages" }));
  const publicCottage = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: demo.cottageName }),
  });
  await expectScene(
    publicCottage.getByRole("heading", { name: demo.cottageName }),
  );
  await publicCottage.getByRole("link", { name: "View cottage" }).click();
  await expectScene(page.getByRole("heading", { name: demo.cottageName }));
  await page.getByRole("link", { name: "Get exact quote" }).click();
  await expectScene(
    page.getByRole("heading", { name: "Your exact Booking Quote" }),
  );
  await expect(page.getByText("Customer Total", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Fictional marketplace terms" }),
  ).toBeVisible();
  await expect(page.getByText(/FICTIONAL LOCAL TEST TERMS/)).toBeVisible();
  await page.screencast.showChapter("Booking Request", {
    description: "Customer verification and request submission",
    duration: 1_400,
  });
  await verifyPhone(page, customerPhone);
  await expectScene(
    page.getByRole("heading", { name: "Send your Booking Request" }),
  );
  await page.getByLabel("Customer name").fill("Demo Customer");
  await page.getByLabel(/accept the preserved House Rules/i).check();
  await page.getByLabel(/accept the cancellation policy/i).check();
  await page.getByLabel(/accept the marketplace booking terms/i).check();
  await page.getByRole("button", { name: "Send Booking Request" }).click();
  await expectScene(
    page.getByRole("heading", { name: "Booking Request pending" }),
  );
  const requestReference = await page
    .getByText(/^RC-REQ-[A-F0-9]{16}$/)
    .innerText();
  const customerCookies = await page.context().cookies();

  await clearBrowserSession(page);
  await page.screencast.showChapter("Owner response", {
    description: "The Owner sees only contact-safe request details",
    duration: 1_400,
  });
  await page.goto("/en/owner/access");
  await verifyPhone(page, demo.ownerPhone);
  await page.getByRole("link", { name: "Open Cottage Profiles" }).click();
  const ownerNotice = page.getByRole("article", { name: requestReference });
  const ownerNoticeCover = await coverPrivateTransition(
    page,
    "New synthetic Booking Request",
  );
  await page.addStyleTag({
    content: `
      .owner-booking-request-grid {
        grid-template-columns: minmax(0, 760px) !important;
      }
      .owner-booking-request-card {
        display: none !important;
      }
      .owner-booking-request-card[aria-label="${requestReference}"] {
        display: block !important;
      }
    `,
  });
  await ownerNotice.scrollIntoViewIfNeeded();
  await ownerNoticeCover.dispose();
  await expectScene(ownerNotice);
  await expect(ownerNotice).toContainText("Demo Customer");
  await expect(ownerNotice).not.toContainText(/provider|payment|phone|@/i);
  await ownerNotice
    .getByRole("button", { name: "Accept complete request" })
    .click();
  await expectScene(ownerNotice.getByText("Accepted", { exact: true }));

  await page.context().clearCookies();
  await page.context().addCookies(customerCookies);
  await page.screencast.showChapter("Customer status", {
    description: "The accepted request appears in the Customer account",
    duration: 1_400,
  });
  await page.goto(`/en/booking-requests/${requestReference}`);
  await expectScene(
    page.getByRole("heading", { name: "Booking Request status" }),
  );
  await expectScene(page.getByText("Accepted", { exact: true }), 2_000);
  await expect(page.getByText("Synthetic private fixture address")).toHaveCount(
    0,
  );
  await page.screencast.stop();
});
