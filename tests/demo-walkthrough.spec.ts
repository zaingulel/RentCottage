import { expect, test, type Locator, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import * as OTPAuth from "otpauth";
import { createClient } from "@supabase/supabase-js";

type AccessBrowserFixture = {
  bookingCottageName: string;
  bookingOwnerPhone: string;
};

type DemoAdministratorCredential = {
  email: string;
  factorId: string;
  password: string;
  secret: string;
  userId: string;
  version: 1;
};

const { accessBrowserFixture } = createRequire(import.meta.url)(
  "../scripts/lib/access-browser-fixtures.mjs",
) as {
  accessBrowserFixture(project: string): AccessBrowserFixture;
};

const administratorEmail = "mvp-demo-administrator-v2@rentcottage.test";
const customerPhone = "+9647520000001";
const fixturePassword = "Local-test-password-2026";
const verificationCode = "123456";
const demoOutputDirectory = resolve("test-results/demo");
const administratorCredentialPath = resolve(
  ".env.demo-administrator.local.json",
);
const canonicalVideoPath = resolve(
  demoOutputDirectory,
  "rentcottage-mvp-walkthrough.webm",
);

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
}

async function assertApplicationHealth(page: Page) {
  requireIsolatedLocalDemo();
  const response = await page.goto("/api/health?check=supabase");
  if (!response) {
    throw new Error("The application health check returned no response");
  }
  const health = (await response.json()) as {
    environment?: string;
    supabase?: {
      configured?: boolean;
      connected?: boolean;
      projectRef?: string;
    };
  };
  if (
    response.status() !== 200 ||
    health.environment !== "test" ||
    health.supabase?.projectRef !== "local-test" ||
    health.supabase.configured !== true ||
    health.supabase.connected !== true
  ) {
    throw new Error(
      `The running application is not connected to the isolated local test environment: ${JSON.stringify(health)}`,
    );
  }
}

function isDemoAdministratorCredential(
  value: unknown,
): value is DemoAdministratorCredential {
  if (!value || typeof value !== "object") return false;
  const credential = value as Partial<DemoAdministratorCredential>;
  return (
    credential.version === 1 &&
    credential.email === administratorEmail &&
    typeof credential.userId === "string" &&
    typeof credential.password === "string" &&
    credential.password.length >= 16 &&
    typeof credential.factorId === "string" &&
    typeof credential.secret === "string" &&
    credential.secret.length >= 16
  );
}

async function readDemoAdministratorCredential() {
  try {
    const credential = JSON.parse(
      await readFile(administratorCredentialPath, "utf8"),
    ) as unknown;
    if (!isDemoAdministratorCredential(credential)) {
      throw new Error("The local demo administrator credential is invalid");
    }
    await chmod(administratorCredentialPath, 0o600);
    return credential;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function prepareDemoAdministrator(
  url: string,
  publishableKey: string,
  secretKey: string,
) {
  const privileged = createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  let credential = await readDemoAdministratorCredential();
  let administrator;
  if (credential) {
    const existing = await privileged.auth.admin.getUserById(credential.userId);
    if (existing.error || existing.data.user.email !== administratorEmail) {
      throw new Error(
        "The dedicated demo administrator and its ignored local credential do not match; inspect them without deleting unrelated MFA factors",
      );
    }
    administrator = existing.data.user;
  } else {
    for (let page = 1; !administrator; page += 1) {
      const users = await privileged.auth.admin.listUsers({
        page,
        perPage: 1000,
      });
      if (users.error) throw users.error;
      administrator = users.data.users.find(
        (user) => user.email === administratorEmail,
      );
      if (users.data.users.length < 1000) break;
    }
  }
  if ((administrator && !credential) || (!administrator && credential)) {
    throw new Error(
      "The dedicated demo administrator and its ignored local credential do not match; inspect them without deleting unrelated MFA factors",
    );
  }

  if (!administrator && !credential) {
    const password = `${Buffer.from(randomBytes(24)).toString("base64url")}Aa1!`;
    const created = await privileged.auth.admin.createUser({
      email: administratorEmail,
      password,
      email_confirm: true,
    });
    if (created.error) throw created.error;
    administrator = created.data.user;
    const provisioned = await privileged.rpc(
      "provision_platform_administrator",
      {
        target_user_id: administrator.id,
      },
    );
    if (provisioned.error) throw provisioned.error;

    const enrollmentClient = createClient(url, publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const signedIn = await enrollmentClient.auth.signInWithPassword({
      email: administratorEmail,
      password,
    });
    if (signedIn.error) throw signedIn.error;
    const enrollment = await enrollmentClient.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "RentCottage MVP demo administrator",
    });
    if (enrollment.error) throw enrollment.error;
    const totp = new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(enrollment.data.totp.secret),
    });
    const challenge = await enrollmentClient.auth.mfa.challenge({
      factorId: enrollment.data.id,
    });
    if (challenge.error) throw challenge.error;
    const verified = await enrollmentClient.auth.mfa.verify({
      factorId: enrollment.data.id,
      challengeId: challenge.data.id,
      code: totp.generate(),
    });
    if (verified.error) throw verified.error;
    const signedOut = await enrollmentClient.auth.signOut();
    if (signedOut.error) throw signedOut.error;
    credential = {
      email: administratorEmail,
      factorId: enrollment.data.id,
      password,
      secret: enrollment.data.totp.secret,
      userId: administrator.id,
      version: 1,
    };
    await writeFile(
      administratorCredentialPath,
      `${JSON.stringify(credential, null, 2)}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
  }

  if (!administrator || !credential || administrator.id !== credential.userId) {
    throw new Error(
      "The dedicated demo administrator identity is incompatible",
    );
  }
  const factors = await privileged.auth.admin.mfa.listFactors({
    userId: administrator.id,
  });
  if (factors.error) throw factors.error;
  const factor = factors.data.factors.find(
    (candidate) => candidate.id === credential.factorId,
  );
  if (!factor || factor.status !== "verified") {
    throw new Error(
      "The dedicated demo administrator MFA factor is incompatible",
    );
  }

  const administratorClient = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const signedInAdministrator =
    await administratorClient.auth.signInWithPassword({
      email: administratorEmail,
      password: credential.password,
    });
  if (signedInAdministrator.error) throw signedInAdministrator.error;
  const context = await administratorClient
    .from("account_contexts")
    .select("role")
    .eq("user_id", administrator.id)
    .single();
  if (context.error || context.data.role !== "platform_administrator") {
    throw new Error("The dedicated demo administrator role is incompatible");
  }
  const administratorSignOut = await administratorClient.auth.signOut();
  if (administratorSignOut.error) throw administratorSignOut.error;
  return {
    email: credential.email,
    password: credential.password,
    totp: new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(credential.secret),
    }),
  };
}

async function prepareDemoState() {
  const fixture = accessBrowserFixture("desktop");
  const url = process.env.SUPABASE_URL ?? "";
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
  const secretKey = process.env.SUPABASE_SECRET_KEY ?? "";
  await mkdir(demoOutputDirectory, { recursive: true });
  const administrator = await prepareDemoAdministrator(
    url,
    publishableKey,
    secretKey,
  );

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
  const existingOwnerRequests = await owner.rpc(
    "list_owner_booking_request_notifications",
  );
  if (
    existingOwnerRequests.error ||
    !Array.isArray(existingOwnerRequests.data) ||
    existingOwnerRequests.data.some(
      (request: {
        bookingNote?: unknown;
        bookingPeriod?: unknown;
        bookingRequestReference?: unknown;
        cottageName?: unknown;
        customerName?: unknown;
        houseRules?: unknown;
      }) =>
        request.cottageName !== fixture.bookingCottageName ||
        !["Demo Customer", "Browser Customer"].includes(
          request.customerName as string,
        ) ||
        request.bookingNote !== null ||
        request.houseRules !== "Synthetic fixture only. Respect neighbours." ||
        !Array.isArray(request.bookingPeriod) ||
        request.bookingPeriod.length !== 1 ||
        request.bookingPeriod.some(
          (item: {
            displayName?: unknown;
            kind?: unknown;
            position?: unknown;
            priceIqd?: unknown;
            serviceDay?: unknown;
          }) =>
            item.kind !== "shift" ||
            item.displayName !== "Morning" ||
            item.position !== 1 ||
            item.priceIqd !== 180_000 ||
            typeof item.serviceDay !== "string" ||
            !/^\d{4}-\d{2}-\d{2}$/.test(item.serviceDay),
        ) ||
        typeof request.bookingRequestReference !== "string" ||
        !/^RC-REQ-[A-F0-9]{16}$/.test(request.bookingRequestReference),
    )
  ) {
    throw new Error(
      "The Owner request overview contains unaudited data and cannot be recorded safely",
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
  const selectedDays: string[] = [];
  for (let offset = 30; offset <= 760 && selectedDays.length < 2; offset += 1) {
    const day = serviceDay(offset);
    const state = await owner.rpc("resolve_cottage_inventory_owner_calendar", {
      target_profile_id: profile.data.id,
      target_schedule_revision_id: profile.data.current_shift_schedule_id,
      target_service_day: day,
    });
    if (state.error) throw state.error;
    if (
      !Array.isArray(state.data?.units) ||
      state.data.units.length !== (shifts.data?.length ?? 0) + 1 ||
      state.data.units.some(
        (unit: {
          calendarState?: string;
          commitmentReference?: string | null;
          editable?: boolean;
        }) =>
          unit.calendarState !== "closed" ||
          unit.commitmentReference !== null ||
          unit.editable !== true,
      )
    ) {
      continue;
    }
    selectedDays.push(day);
  }
  if (selectedDays.length !== 2) {
    throw new Error("Two unused future Service Days are not available");
  }
  const [recordedDay, liveDemoDay] = selectedDays;
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
    administrator,
    cottageName: fixture.bookingCottageName,
    liveDemoDay,
    ownerPhone: fixture.bookingOwnerPhone,
    recordedDay,
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
  await mkdir(demoOutputDirectory, { recursive: true });
  const runVideoPath = resolve(
    demoOutputDirectory,
    `rentcottage-mvp-walkthrough-${randomUUID()}.webm`,
  );
  await assertApplicationHealth(page);
  const demo = await prepareDemoState();
  console.log(`Recorded walkthrough Service Day: ${demo.recordedDay}`);
  console.log(`Reserved live-demo Service Day: ${demo.liveDemoDay}`);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/en");
  let journeyError: unknown;
  let screencastStarted = false;
  try {
    await page.screencast.start({
      path: runVideoPath,
      quality: 90,
      size: { width: 1920, height: 1080 },
      annotate: { duration: 900, fontSize: 28, position: "top-right" },
    });
    screencastStarted = true;
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
    await page.getByLabel("Email").fill(demo.administrator.email);
    await page.screencast.hideActions();
    await page.getByLabel("Password").fill(demo.administrator.password);
    await expect(page.getByLabel("Password")).toHaveAttribute(
      "type",
      "password",
    );
    await expect(page.getByLabel("Password")).toHaveValue(
      demo.administrator.password,
    );
    await expectScene(page.getByLabel("Password"));
    await page.getByRole("button", { name: "Continue" }).click();
    await page.screencast.showActions({ duration: 900, fontSize: 28 });
    await expect(
      page.getByText("Enter the code from your authenticator app."),
    ).toBeVisible();
    await expect(page.getByTestId("mfa-secret")).toHaveCount(0);
    await expect(page.getByRole("img", { name: /QR/i })).toHaveCount(0);
    const secureMfaCover = await page.screencast.showOverlay(
      `<section style="position:fixed;inset:0;z-index:2147483646;display:grid;place-content:center;background:#102c26;color:white;text-align:center;font:700 52px/1.2 system-ui">Authenticator verification<small style="display:block;margin-top:18px;font:500 24px/1.4 system-ui">The one-time code is intentionally kept off the recording</small></section>`,
    );
    await page.screencast.hideActions();
    await page
      .getByLabel("Authenticator app code")
      .fill(demo.administrator.totp.generate());
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByText(/Administrator access is ready/)).toBeVisible();
    await page.screencast.showActions({ duration: 900, fontSize: 28 });
    await secureMfaCover.dispose();
    await expectScene(page.getByText(/Administrator access is ready/));
    await expect(
      page.getByRole("link", { name: "Review submitted Owner Applications" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Manage Cottage Profiles" }),
    ).toBeVisible();

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
    await cottageCard
      .getByRole("link", { name: "Open Cottage Profile" })
      .click();
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
    await expect(
      page.getByText("Synthetic private fixture address"),
    ).toHaveCount(0);

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
    await page
      .getByRole("button", { name: "Search available cottages" })
      .click();
    await expectScene(
      page.getByRole("heading", { name: "Available cottages" }),
    );
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
    await expect(
      page.getByText("Customer Total", { exact: true }),
    ).toBeVisible();
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
    await expect(
      page.getByText("Synthetic private fixture address"),
    ).toHaveCount(0);
  } catch (error) {
    journeyError = error;
  } finally {
    if (screencastStarted) {
      try {
        await page.screencast.stop();
      } catch (error) {
        journeyError ??= error;
      }
    }
  }
  if (journeyError) {
    await rm(runVideoPath, { force: true });
    throw journeyError;
  }
  await rename(runVideoPath, canonicalVideoPath);
  console.log(`Published walkthrough video: ${canonicalVideoPath}`);
});
