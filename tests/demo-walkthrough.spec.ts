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

type DemoInventoryUnit = {
  id: string;
  kind: "shift" | "full_day_bundle";
  calendarState:
    | "open"
    | "closed"
    | "private_blocked"
    | "confirmed_booking"
    | "component_unavailable";
  available: boolean;
};

type ValidatedDemoCottage = {
  fixture: AccessBrowserFixture;
  profile: {
    id: string;
    current_publication_id: string;
    current_shift_schedule_id: string;
  };
};

const {
  requireDemoEnvironment,
  validateDemoBrowserFixtures,
  assertDemoInventoryReadback,
} = createRequire(import.meta.url)(
  "../scripts/lib/access-browser-fixtures.mjs",
) as {
  requireDemoEnvironment(): string;
  validateDemoBrowserFixtures(input: {
    privilegedClient: unknown;
    publishableKey: string;
    url: string;
  }): Promise<ValidatedDemoCottage[]>;
  assertDemoInventoryReadback(input: {
    ownerCalendar: unknown;
    publicAvailability: unknown;
    expectedUnits: DemoInventoryUnit[];
  }): void;
};

const administratorEmail = "mvp-demo-administrator-v2@rentcottage.test";
const customerPhone = "+9647520000001";
const fixturePassword = "Local-test-password-2026";
const verificationCode = "123456";
const demoOutputDirectory = resolve("test-results/demo");
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

function expectedMorningPeriod(day: string) {
  const format = new Intl.DateTimeFormat("en-IQ", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Baghdad",
  });
  return `Morning · ${format.format(new Date(`${day}T08:00:00+03:00`))} – ${format.format(new Date(`${day}T12:00:00+03:00`))}`;
}

function expectedServiceDayLabel(day: string) {
  return new Intl.DateTimeFormat("en-IQ", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));
}

async function expectScene(locator: Locator, milliseconds = 1_200) {
  await expect(locator).toBeVisible();
  await locator.page().waitForTimeout(milliseconds);
}

async function expectDemoImage(locator: Locator) {
  await expect(locator).toBeVisible();
  await expect
    .poll(() =>
      locator.evaluate((image) =>
        image instanceof HTMLImageElement && image.complete
          ? image.naturalWidth
          : 0,
      ),
    )
    .toBeGreaterThan(100);
  await locator.page().waitForTimeout(1_800);
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
  requireDemoEnvironment();
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

async function readDemoAdministratorCredential(
  administratorCredentialPath: string,
) {
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
  administratorCredentialPath: string,
) {
  const privileged = createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  let credential = await readDemoAdministratorCredential(
    administratorCredentialPath,
  );
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
  if (administrator && !credential) {
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
  const localWorkdir = requireDemoEnvironment();
  const url = process.env.SUPABASE_URL ?? "";
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
  const secretKey = process.env.SUPABASE_SECRET_KEY ?? "";
  const privileged = createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const validated = await validateDemoBrowserFixtures({
    privilegedClient: privileged,
    publishableKey,
    url,
  });
  const administrator = await prepareDemoAdministrator(
    url,
    publishableKey,
    secretKey,
    resolve(localWorkdir, ".env.demo-administrator.local.json"),
  );
  const showcaseDay = serviceDay(30);
  const recordedDay = serviceDay(31);
  const rehearsalDay = serviceDay(32);
  const meetingDay = serviceDay(33);
  const anonymous = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const cottages = [];
  for (const [index, cottage] of validated.entries()) {
    const owner = createClient(url, publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const signedIn = await owner.auth.signInWithPassword({
      phone: cottage.fixture.bookingOwnerPhone,
      password: fixturePassword,
    });
    if (signedIn.error) throw signedIn.error;
    const profile = await owner
      .from("owner_application_cottage_profiles")
      .select(
        "id,exact_address,exact_latitude,exact_longitude,private_directions",
      )
      .eq("id", cottage.profile.id)
      .single();
    if (
      profile.error ||
      profile.data.exact_address !== "Synthetic private fixture address" ||
      profile.data.private_directions !== "Synthetic private directions." ||
      profile.data.exact_latitude !== 36.408333 ||
      profile.data.exact_longitude !== 44.385834
    ) {
      throw new Error(
        "The synthetic demo cottage private access fields are incompatible",
      );
    }
    const requests = await owner.rpc(
      "list_owner_booking_request_notifications",
    );
    if (requests.error) throw requests.error;
    if (!Array.isArray(requests.data) || requests.data.length !== 0) {
      throw new Error(
        "Unexpected demo Booking Requests; create a fresh owned demo project.",
      );
    }
    const shifts = await owner
      .from("cottage_shifts")
      .select("id,position")
      .eq("schedule_revision_id", cottage.profile.current_shift_schedule_id)
      .order("position");
    const schedule = await owner
      .from("cottage_shift_schedule_revisions")
      .select("full_day_bundle_id")
      .eq("id", cottage.profile.current_shift_schedule_id)
      .single();
    if (
      shifts.error ||
      schedule.error ||
      !Array.isArray(shifts.data) ||
      shifts.data.length !== 2 ||
      shifts.data[0].position !== 1 ||
      shifts.data[1].position !== 2 ||
      typeof schedule.data.full_day_bundle_id !== "string"
    ) {
      throw new Error("The synthetic demo cottage schedule is incompatible");
    }
    const units = [
      ...shifts.data.map((shift) => ({
        id: shift.id as string,
        kind: "shift" as const,
      })),
      {
        id: schedule.data.full_day_bundle_id as string,
        kind: "full_day_bundle" as const,
      },
    ];
    for (const day of [showcaseDay, recordedDay, rehearsalDay, meetingDay]) {
      const args = {
        target_profile_id: cottage.profile.id,
        target_schedule_revision_id: cottage.profile.current_shift_schedule_id,
        target_service_day: day,
      };
      const before = await owner.rpc(
        "resolve_cottage_inventory_owner_calendar",
        args,
      );
      if (before.error) throw before.error;
      if (
        !Array.isArray(before.data?.units) ||
        before.data.units.length !== 3 ||
        units.some(
          (unit) =>
            before.data.units.filter(
              (row: { id?: unknown; kind?: unknown }) =>
                row.id === unit.id && row.kind === unit.kind,
            ).length !== 1,
        ) ||
        before.data.units.some(
          (unit: { commitmentReference?: unknown; editable?: unknown }) =>
            unit.commitmentReference !== null || unit.editable !== true,
        )
      ) {
        throw new Error(
          "Unexpected demo commitments or malformed calendar; create a fresh owned demo project.",
        );
      }
      const states: DemoInventoryUnit["calendarState"][] =
        day !== showcaseDay || index < 3
          ? ["open", "open", "open"]
          : index === 3
            ? ["open", "closed", "closed"]
            : index === 4
              ? ["closed", "closed", "closed"]
              : ["private_blocked", "open", "closed"];
      const expectedUnits = units.map((unit, position) => ({
        ...unit,
        calendarState: states[position],
        available: states[position] === "open",
      }));
      const written = await owner.rpc("set_cottage_inventory_availability", {
        ...args,
        requested_states: expectedUnits.map((unit) => ({
          unitId: unit.id,
          unitKind: unit.kind,
          state: unit.calendarState,
        })),
      });
      if (written.error) throw written.error;
      const ownerCalendar = await owner.rpc(
        "resolve_cottage_inventory_owner_calendar",
        args,
      );
      const publicAvailability = await anonymous.rpc(
        "resolve_cottage_inventory_public_availability",
        args,
      );
      if (ownerCalendar.error) throw ownerCalendar.error;
      if (publicAvailability.error) throw publicAvailability.error;
      assertDemoInventoryReadback({
        ownerCalendar: ownerCalendar.data,
        publicAvailability: publicAvailability.data,
        expectedUnits,
      });
    }
    const signedOut = await owner.auth.signOut();
    if (signedOut.error) throw signedOut.error;
    cottages.push({ ...cottage, units });
  }
  const participants = await privileged.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (participants.error) throw participants.error;
  if (
    !participants.data.users.some(
      (user) =>
        user.phone?.replace(/^\+/, "") === customerPhone.replace(/^\+/, ""),
    )
  ) {
    throw new Error("The synthetic demo Customer phone is incompatible");
  }
  return {
    administrator,
    cottages,
    showcaseDay,
    recordedDay,
    rehearsalDay,
    meetingDay,
    cottageName: cottages[0].fixture.bookingCottageName,
    ownerPhone: cottages[0].fixture.bookingOwnerPhone,
  };
}

let demo: Awaited<ReturnType<typeof prepareDemoState>>;

test.beforeAll(async () => {
  demo = await prepareDemoState();
});

async function verifyPhone(page: Page, phone: string) {
  await page.getByLabel("Iraqi phone number").fill(phone);
  await page.getByRole("button", { name: "Send verification code" }).click();
  await expect(page.getByLabel("Verification code")).toBeVisible();
  const securePhoneCover = await coverPrivateTransition(
    page,
    "Phone verification",
  );
  await page.screencast.hideActions();
  await page.getByLabel("Verification code").fill(verificationCode);
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page.getByLabel("Verification code")).toHaveCount(0);
  await securePhoneCover.dispose();
  await page.screencast.showActions({ duration: 900, fontSize: 28 });
}

function detailValue(surface: Locator, label: string) {
  return surface
    .locator("dt")
    .filter({ hasText: new RegExp(`^${label}$`) })
    .locator("xpath=following-sibling::dd");
}

test("shows varied demo results and filters across desktop and mobile languages", async ({
  page,
}, testInfo) => {
  await assertApplicationHealth(page);
  const allNames = [
    "Palm Garden",
    "Zab Riverside",
    "Dukan Hills",
    "Orchard Retreat",
    "Tigris Courtyard",
    "Date Palm Cottage",
  ];
  const languages = [
    {
      locale: "en",
      direction: "ltr",
      from: "From Service Day",
      to: "To Service Day",
      guests: "Guests",
      governorate: "Governorate (optional)",
      area: "Approximate area (optional)",
      filters: "Booking Period filters (optional)",
      fullDay: "Full day",
      pool: "Pool",
      submit: "Search available cottages",
      results: "Available cottages",
      back: "Change search",
    },
    {
      locale: "ar",
      direction: "rtl",
      from: "من تاريخ",
      to: "إلى تاريخ",
      guests: "عدد الضيوف",
      governorate: "المحافظة (اختياري)",
      area: "المنطقة التقريبية (اختياري)",
      filters: "مرشحات فترة الحجز (اختياري)",
      fullDay: "يوم كامل",
      pool: "مسبح",
      submit: "ابحث عن البيوت المتاحة",
      results: "البيوت المتاحة",
      back: "تعديل البحث",
    },
    {
      locale: "ckb",
      direction: "rtl",
      from: "لە بەرواری",
      to: "تا بەرواری",
      guests: "ژمارەی میوان",
      governorate: "پارێزگا (ئارەزوومەندانە)",
      area: "ناوچەی نزیکەیی (ئارەزوومەندانە)",
      filters: "پاڵاوتەکانی ماوەی حجز (ئارەزوومەندانە)",
      fullDay: "ڕۆژی تەواو",
      pool: "مەلەوانگە",
      submit: "گەڕان بۆ کۆتێجی بەردەست",
      results: "کۆتێجە بەردەستەکان",
      back: "گەڕانەکە بگۆڕە",
    },
  ];
  type SearchFilters = {
    governorate?: string;
    area?: string;
    guests?: string;
    pool?: boolean;
    fullDay?: boolean;
  };
  async function search(
    language: (typeof languages)[number],
    day: string,
    names: string[],
    filters: SearchFilters = {},
  ) {
    await expect(page.locator("html")).toHaveAttribute("lang", language.locale);
    await expect(page.locator("html")).toHaveAttribute(
      "dir",
      language.direction,
    );
    await expect(page.getByLabel(language.from, { exact: true })).toHaveValue(
      "",
    );
    await expect(
      page.getByRole("combobox", { name: language.governorate, exact: true }),
    ).toHaveValue("");
    await expect(
      page.getByRole("combobox", { name: language.area, exact: true }),
    ).toHaveValue("");
    await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(0);
    await page.getByLabel(language.from, { exact: true }).fill(day);
    await page.getByLabel(language.to, { exact: true }).fill(day);
    await page
      .getByLabel(language.guests, { exact: true })
      .fill(filters.guests ?? "4");
    if (filters.governorate)
      await page
        .getByRole("combobox", { name: language.governorate, exact: true })
        .selectOption(filters.governorate);
    if (filters.area)
      await page
        .getByRole("combobox", { name: language.area, exact: true })
        .selectOption(filters.area);
    if (filters.pool)
      await page
        .getByRole("checkbox", { name: language.pool, exact: true })
        .check();
    const disclosure = page
      .locator("summary")
      .filter({ hasText: language.filters });
    await disclosure.focus();
    await expect(disclosure).toBeFocused();
    await page.keyboard.press("Enter");
    const fullDay = page.getByRole("button", {
      name: language.fullDay,
      exact: true,
    });
    await expect(fullDay).toBeVisible();
    await expect(fullDay).toHaveAttribute("aria-pressed", "false");
    if (filters.fullDay) {
      await fullDay.click();
      await expect(fullDay).toHaveAttribute("aria-pressed", "true");
    }
    const submit = page.getByRole("button", {
      name: language.submit,
      exact: true,
    });
    await submit.focus();
    await expect(submit).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/${language.locale}/results\\?`));
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: language.results,
        exact: true,
      }),
    ).toBeVisible();
    const cards = page.getByRole("main").getByRole("article");
    await expect(cards).toHaveCount(names.length);
    await expect
      .poll(async () =>
        (
          await cards.getByRole("heading", { level: 2 }).allTextContents()
        ).sort(),
      )
      .toEqual([...names].sort());
    for (const name of names) {
      const card = cards.filter({
        has: page.getByRole("heading", { level: 2, name, exact: true }),
      });
      await expect(
        card.getByRole("heading", { level: 2, name, exact: true }),
      ).toBeVisible();
      await expect
        .poll(() =>
          card
            .getByRole("img", { name, exact: true })
            .evaluate((image) =>
              image instanceof HTMLImageElement && image.complete
                ? image.naturalWidth
                : 0,
            ),
        )
        .toBeGreaterThan(100);
    }
    await expect(page.getByRole("main")).not.toContainText(
      /Synthetic private fixture address|Synthetic private directions|36\.408333|44\.385834|private_blocked|commitmentReference|9647540000/,
    );
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      )
      .toBe(true);
  }
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 412, height: 915 },
  ]) {
    await page.setViewportSize(viewport);
    for (const language of languages) {
      await page.goto(`/${language.locale}`);
      await search(language, demo.recordedDay, allNames);
      if (
        (viewport.width === 1440 && language.locale === "en") ||
        (viewport.width === 412 && language.locale === "ar")
      ) {
        const path = testInfo.outputPath(
          `demo-results-${language.locale}-${viewport.width}.png`,
        );
        await page.screenshot({ path, fullPage: true });
        await testInfo.attach(
          `Demo results ${language.locale} ${viewport.width}`,
          { path, contentType: "image/png" },
        );
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/en");
  const english = languages[0];
  await search(english, demo.recordedDay, allNames);
  for (const [name, prices] of [
    ["Palm Garden", ["IQD 180,000", "IQD 190,000", "IQD 250,000"]],
    ["Zab Riverside", ["IQD 140,000", "IQD 150,000", "IQD 220,000"]],
    ["Dukan Hills", ["IQD 240,000", "IQD 260,000", "IQD 360,000"]],
    ["Orchard Retreat", ["IQD 100,000", "IQD 120,000", "IQD 180,000"]],
    ["Tigris Courtyard", ["IQD 210,000", "IQD 230,000", "IQD 320,000"]],
    ["Date Palm Cottage", ["IQD 300,000", "IQD 320,000", "IQD 450,000"]],
  ] as const) {
    const card = page
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name, exact: true }) });
    for (const [index, label] of [
      "Morning",
      "Evening",
      "Full-day bundle",
    ].entries()) {
      await expect(
        card.getByRole("listitem").filter({ hasText: label }).locator("b"),
      ).toHaveText(prices[index]);
    }
    await expect(card.getByText("total", { exact: true })).toHaveCount(0);
  }
  for (const [filters, names] of [
    [{ governorate: "Erbil" }, ["Palm Garden", "Zab Riverside"]],
    [{ area: "Shaqlawa" }, ["Palm Garden"]],
    [
      { guests: "10" },
      ["Dukan Hills", "Tigris Courtyard", "Date Palm Cottage"],
    ],
    [
      { pool: true },
      ["Palm Garden", "Dukan Hills", "Tigris Courtyard", "Date Palm Cottage"],
    ],
  ] satisfies [SearchFilters, string[]][]) {
    await page.getByRole("link", { name: english.back, exact: true }).click();
    await search(english, demo.recordedDay, names, filters);
  }
  await page.getByRole("link", { name: english.back, exact: true }).click();
  await search(english, demo.showcaseDay, [
    "Palm Garden",
    "Zab Riverside",
    "Dukan Hills",
    "Orchard Retreat",
    "Date Palm Cottage",
  ]);
  for (const [name, states] of [
    ["Orchard Retreat", ["Available", "Unavailable", "Unavailable"]],
    ["Date Palm Cottage", ["Unavailable", "Available", "Unavailable"]],
  ] as const) {
    const card = page
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name, exact: true }) });
    for (const [index, label] of [
      "Morning",
      "Evening",
      "Full-day bundle",
    ].entries()) {
      await expect(
        card
          .getByRole("listitem")
          .filter({ hasText: label })
          .getByText(states[index], { exact: true }),
      ).toBeVisible();
    }
  }
  await page.getByRole("link", { name: english.back, exact: true }).click();
  await search(
    english,
    demo.showcaseDay,
    ["Palm Garden", "Zab Riverside", "Dukan Hills"],
    { fullDay: true },
  );
});

test("records the continuous local RentCottage MVP story", async ({ page }) => {
  test.setTimeout(240_000);
  await mkdir(demoOutputDirectory, { recursive: true });
  const runVideoPath = resolve(
    demoOutputDirectory,
    `rentcottage-mvp-walkthrough-${randomUUID()}.webm`,
  );
  await assertApplicationHealth(page);
  console.log(`Recorded walkthrough Service Day: ${demo.recordedDay}`);
  console.log(`Reserved rehearsal Service Day: ${demo.rehearsalDay}`);
  console.log(`Reserved meeting Service Day: ${demo.meetingDay}`);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
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

    await page.screencast.showChapter("Choose English", {
      description: "Start with the marketplace's existing language choices",
      duration: 1_400,
    });
    const siteHeader = page.getByRole("banner");
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    for (const language of ["العربية", "کوردی", "English"]) {
      await expectScene(siteHeader.getByRole("link", { name: language }));
    }
    await siteHeader.getByRole("link", { name: "English" }).click();
    await expect(page).toHaveURL(/\/en$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expectScene(
      page.getByRole("heading", {
        level: 1,
        name: "A house in the countryside, all yours",
      }),
    );
    await expect(
      siteHeader.getByText("Countryside homes of Iraq"),
    ).toBeVisible();
    const siteFooter = page.getByRole("contentinfo");
    await siteFooter.scrollIntoViewIfNeeded();
    await expectScene(siteFooter.getByText("Discover", { exact: true }));
    await page
      .getByRole("heading", {
        level: 1,
        name: "A house in the countryside, all yours",
      })
      .scrollIntoViewIfNeeded();

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
    expect(
      (await page.getByLabel("Password").inputValue()) ===
        demo.administrator.password,
    ).toBe(true);
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
      page.getByRole("heading", { name: "Sign in or create an account" }),
    );
    await verifyPhone(page, demo.ownerPhone);
    await expectScene(page.getByRole("heading", { name: "Your cottages" }));
    const cottageCard = page.getByRole("article").filter({
      has: page.getByRole("heading", { name: demo.cottageName }),
    });
    await expectScene(
      cottageCard.getByRole("heading", { name: demo.cottageName }),
    );
    await cottageCard
      .getByRole("link", { name: "Open Cottage Profile" })
      .click();
    await expect(page).toHaveURL(
      `/en/owner/cottages/${demo.cottages[0].profile.id}`,
    );
    const ownerCottageUrl = page.url();
    const publishedStatus = page
      .getByRole("region", { name: "Language review" })
      .getByText("Published", { exact: true });
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
    for (const label of [
      "Shift 1 operational state",
      "Shift 2 operational state",
      "Full-Day Bundle operational state",
    ]) {
      await expect(page.getByLabel(label)).toHaveValue("open");
    }
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
    await page.getByLabel("Guests", { exact: true }).fill("4");
    await page
      .getByRole("button", { name: "Search available cottages" })
      .click();
    await expectScene(
      page.getByRole("heading", { name: "Available cottages" }),
    );
    const publicCards = page.getByRole("main").getByRole("article");
    const comparedCottages = [
      ["Palm Garden", "IQD 180,000"],
      ["Zab Riverside", "IQD 140,000"],
      ["Dukan Hills", "IQD 240,000"],
      ["Orchard Retreat", "IQD 100,000"],
      ["Tigris Courtyard", "IQD 210,000"],
      ["Date Palm Cottage", "IQD 300,000"],
    ];
    await expect(publicCards).toHaveCount(6);
    for (const [name, morningPrice] of comparedCottages) {
      const card = publicCards.filter({
        has: page.getByRole("heading", { name, exact: true }),
      });
      await card.scrollIntoViewIfNeeded();
      await expectScene(card.getByRole("heading", { name, exact: true }));
      await expect(
        card.getByRole("listitem").filter({ hasText: "Morning" }).locator("b"),
      ).toHaveText(morningPrice);
      await expectDemoImage(card.getByRole("img", { name, exact: true }));
    }
    await expect(page.getByRole("main")).not.toContainText(
      /Synthetic private fixture address|Synthetic private directions|36\.408333|44\.385834|private_blocked|commitmentReference|9647540000/,
    );
    await page
      .getByRole("link", { name: "Change search", exact: true })
      .click();
    await page.getByLabel("From Service Day").fill(demo.recordedDay);
    await page.getByLabel("To Service Day").fill(demo.recordedDay);
    await page.getByLabel("Guests", { exact: true }).fill("4");
    const poolFilter = page.getByRole("checkbox", {
      name: "Pool",
      exact: true,
    });
    await poolFilter.check();
    await expect(poolFilter).toBeChecked();
    await expectScene(poolFilter);
    await page
      .getByRole("button", { name: "Search available cottages" })
      .click();
    await expectScene(
      page.getByRole("heading", { name: "Available cottages" }),
    );
    await expect(publicCards).toHaveCount(4);
    await expect
      .poll(async () =>
        (
          await publicCards.getByRole("heading", { level: 2 }).allTextContents()
        ).sort(),
      )
      .toEqual(
        [
          "Palm Garden",
          "Dukan Hills",
          "Tigris Courtyard",
          "Date Palm Cottage",
        ].sort(),
      );
    const publicCottage = page.getByRole("article").filter({
      has: page.getByRole("heading", { name: demo.cottageName }),
    });
    await expectScene(
      publicCottage.getByRole("heading", { name: demo.cottageName }),
    );
    expect(new URL(page.url()).searchParams.getAll("selection")).toEqual([]);
    await expect(publicCottage.getByText("total", { exact: true })).toHaveCount(
      0,
    );
    await expect(
      publicCottage.getByRole("heading", {
        name: expectedServiceDayLabel(demo.recordedDay).replace(/^\w+, /, ""),
      }),
    ).toBeVisible();
    const morningOption = publicCottage
      .getByRole("listitem")
      .filter({ hasText: "Morning" });
    await expect(morningOption).toContainText("08:00–12:00");
    await expect(morningOption).toContainText("IQD 180,000");
    await expect(
      morningOption.getByText("Available", { exact: true }),
    ).toBeVisible();
    await expectDemoImage(
      publicCottage.getByRole("img", { name: demo.cottageName }),
    );
    const viewCottage = publicCottage.getByRole("link", {
      name: "View cottage",
    });
    const [viewCottageBox, cottageCardBox] = await Promise.all([
      viewCottage.boundingBox(),
      publicCottage.boundingBox(),
    ]);
    expect(viewCottageBox).not.toBeNull();
    expect(cottageCardBox).not.toBeNull();
    expect(viewCottageBox!.width).toBeGreaterThan(cottageCardBox!.width * 0.8);
    await viewCottage.click();
    await expectScene(page.getByRole("heading", { name: demo.cottageName }));
    await expectDemoImage(
      page.getByRole("img", { name: `${demo.cottageName} 1` }),
    );
    const bookingSidebar = page.getByRole("complementary");
    await expect(
      bookingSidebar.getByRole("heading", {
        name: "Choose your Booking Period",
      }),
    ).toBeVisible();
    await expect(bookingSidebar.getByText("Total price")).toHaveCount(0);
    await expect(
      bookingSidebar.getByRole("button", { pressed: true }),
    ).toHaveCount(0);
    await expect(
      bookingSidebar.getByRole("button", { name: "Get exact quote" }),
    ).toBeDisabled();
    const morningChoice = bookingSidebar
      .getByRole("group", { name: expectedServiceDayLabel(demo.recordedDay) })
      .getByRole("button", { name: "Morning", exact: true });
    await morningChoice.click();
    await expect(morningChoice).toHaveAttribute("aria-pressed", "true");
    await expect(
      bookingSidebar.getByRole("link", { name: "Get exact quote" }),
    ).toBeVisible();
    await expect(page.getByText("Capacity", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Bedrooms and bathrooms", { exact: true }),
    ).toBeVisible();
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
    await expectScene(page.getByRole("heading", { name: "Your cottages" }));
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
    await expectScene(
      ownerNotice.getByRole("status").filter({
        hasText: "Payment confirmation pending",
      }),
    );
    const ownerCookies = await page.context().cookies();

    await page.context().clearCookies();
    await page.context().addCookies(customerCookies);
    await page.screencast.showChapter("Simulated payment capture", {
      description:
        "Acceptance starts payment processing; private access remains hidden",
      duration: 1_400,
    });
    await page.goto(`/en/booking-requests/${requestReference}`);
    await expectScene(
      page.getByRole("heading", { name: "Booking Request status" }),
    );
    await expectScene(
      page.getByRole("status").filter({
        hasText: "Payment confirmation pending",
      }),
      2_000,
    );
    for (const privateValue of [
      "Synthetic private fixture address",
      "Synthetic private directions.",
      "36.408333, 44.385834",
      demo.ownerPhone,
    ]) {
      await expect(page.getByText(privateValue, { exact: true })).toHaveCount(
        0,
      );
    }

    const scheduled = await page.request.get(
      "/__scheduled?cron=%2A%20%2A%20%2A%20%2A%20%2A",
    );
    expect(scheduled.ok()).toBe(true);
    await page.screencast.showChapter("Confirmed Booking", {
      description:
        "The real local Worker completes simulated capture and unlocks participant details",
      duration: 1_400,
    });
    const customerDetails = page.getByRole("region", {
      name: "Confirmed booking",
    });
    await expectScene(
      customerDetails.getByRole("heading", { name: "Confirmed booking" }),
      2_000,
    );
    const bookingReference = await customerDetails
      .locator("header strong")
      .innerText();
    expect(bookingReference).toMatch(/^[A-Z0-9][A-Z0-9-]{0,119}$/);
    const bookingPeriod = await detailValue(
      customerDetails,
      "Booking period",
    ).innerText();
    expect(bookingPeriod).toBe(expectedMorningPeriod(demo.recordedDay));
    await expect(
      detailValue(customerDetails, "Original booking price"),
    ).toHaveText("IQD 180,000");
    await expect(detailValue(customerDetails, "Service fee")).toHaveText(
      "IQD 5,000",
    );
    await expect(detailValue(customerDetails, "Customer total")).toHaveText(
      "IQD 185,000",
    );
    for (const value of [
      "Demo Customer",
      customerPhone,
      demo.ownerPhone,
      "Synthetic private fixture address",
      "Synthetic private directions.",
      "36.408333, 44.385834",
    ]) {
      await expect(customerDetails).toContainText(value);
    }
    await detailValue(
      customerDetails,
      "Exact address",
    ).scrollIntoViewIfNeeded();
    await expectScene(detailValue(customerDetails, "Exact address"));
    await detailValue(
      customerDetails,
      "Cottage Owner phone",
    ).scrollIntoViewIfNeeded();
    await expectScene(
      detailValue(customerDetails, "Cottage Owner phone"),
      2_000,
    );
    await page.screencast.showChapter("Booking history and private messaging", {
      description:
        "The paid Booking is retained and its participant conversation unlocks contact-safe messaging",
      duration: 1_400,
    });
    await customerDetails.getByRole("link", { name: "My bookings" }).click();
    await expectScene(page.getByRole("heading", { name: "My bookings" }));
    const customerHistory = page.locator(
      `a[href="/en/booking-requests/${requestReference}"]`,
    );
    await expect(customerHistory).toContainText(bookingReference);
    await customerHistory.click();
    await page.getByRole("button", { name: "Open conversation" }).click();
    await expectScene(
      page.getByText("Contact details are allowed for this paid booking."),
    );
    const customerMessage = `Synthetic arrival note for ${requestReference}`;
    await page.getByLabel("Message", { exact: true }).fill(customerMessage);
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByRole("list", { name: "Messages" })).toContainText(
      customerMessage,
    );

    await page.context().clearCookies();
    await page.context().addCookies(ownerCookies);
    await page.goto("/en/owner/cottages");
    const confirmedOwnerNotice = page.getByRole("article", {
      name: requestReference,
    });
    await expectScene(
      confirmedOwnerNotice.getByRole("status").filter({
        hasText: "Booking confirmed",
      }),
    );
    await confirmedOwnerNotice
      .getByRole("link", { name: "Open confirmed booking" })
      .click();
    const ownerDetails = page.getByRole("region", {
      name: "Confirmed booking",
    });
    await expectScene(
      ownerDetails.getByRole("heading", { name: "Confirmed booking" }),
    );
    await expect(ownerDetails.locator("header strong")).toHaveText(
      bookingReference,
    );
    await expect(detailValue(ownerDetails, "Booking period")).toHaveText(
      bookingPeriod,
    );
    await expect(
      detailValue(ownerDetails, "Original booking price"),
    ).toHaveText("IQD 180,000");
    await expect(detailValue(ownerDetails, "Original commission")).toHaveText(
      "IQD 18,000",
    );
    await expect(detailValue(ownerDetails, "Original owner share")).toHaveText(
      "IQD 162,000",
    );
    for (const value of [
      "Demo Customer",
      customerPhone,
      demo.ownerPhone,
      "Synthetic private fixture address",
      "Synthetic private directions.",
      "36.408333, 44.385834",
    ]) {
      await expect(ownerDetails).toContainText(value);
    }
    await detailValue(ownerDetails, "Exact address").scrollIntoViewIfNeeded();
    await expectScene(detailValue(ownerDetails, "Exact address"));
    await detailValue(
      ownerDetails,
      "Cottage Owner phone",
    ).scrollIntoViewIfNeeded();
    await expectScene(detailValue(ownerDetails, "Cottage Owner phone"), 2_000);
    await ownerDetails
      .getByRole("link", { name: "Bookings for my cottages" })
      .click();
    await expectScene(
      page.getByRole("heading", { name: "Bookings for my cottages" }),
    );
    const ownerHistory = page.locator(
      `a[href="/en/owner/booking-requests/${requestReference}"]`,
    );
    await expect(ownerHistory).toContainText(bookingReference);
    await ownerHistory.click();
    await page.getByRole("button", { name: "Open conversation" }).click();
    await expectScene(
      page.getByText("Contact details are allowed for this paid booking."),
    );
    await expect(page.getByRole("list", { name: "Messages" })).toContainText(
      customerMessage,
    );
    await page
      .getByLabel("Message", { exact: true })
      .fill("Synthetic Cottage Owner reply: arrival noted.");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByRole("list", { name: "Messages" })).toContainText(
      "Synthetic Cottage Owner reply: arrival noted.",
    );

    await page.screencast.showChapter("Confirmed Owner availability", {
      description: "The recorded Morning is now reserved by the paid Booking",
      duration: 1_400,
    });
    await page.goto(ownerCottageUrl);
    await expect(page).toHaveURL(ownerCottageUrl);
    await expect(inventory).toBeVisible();
    await inventory.scrollIntoViewIfNeeded();
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
    const confirmedMorning = page.locator(
      'output[aria-label="Shift 1 operational state"]',
    );
    await expect(confirmedMorning).toHaveText("Confirmed booking");
    await confirmedMorning.scrollIntoViewIfNeeded();
    await expectScene(confirmedMorning);
    await expect(
      page.getByRole("combobox", {
        name: "Shift 1 operational state",
        exact: true,
      }),
    ).toHaveCount(0);

    const url = process.env.SUPABASE_URL ?? "";
    const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
    const owner = createClient(url, publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const signedIn = await owner.auth.signInWithPassword({
      phone: demo.ownerPhone,
      password: fixturePassword,
    });
    if (signedIn.error) throw signedIn.error;
    const anonymous = createClient(url, publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const cottage = demo.cottages[0];
    for (const day of [demo.recordedDay, demo.rehearsalDay, demo.meetingDay]) {
      const args = {
        target_profile_id: cottage.profile.id,
        target_schedule_revision_id: cottage.profile.current_shift_schedule_id,
        target_service_day: day,
      };
      const ownerCalendar = await owner.rpc(
        "resolve_cottage_inventory_owner_calendar",
        args,
      );
      const publicAvailability = await anonymous.rpc(
        "resolve_cottage_inventory_public_availability",
        args,
      );
      if (ownerCalendar.error) throw ownerCalendar.error;
      if (publicAvailability.error) throw publicAvailability.error;
      if (day === demo.recordedDay) {
        const envelope = {
          profileId: cottage.profile.id,
          scheduleRevisionId: cottage.profile.current_shift_schedule_id,
          serviceDay: day,
        };
        expect(ownerCalendar.data).toMatchObject(envelope);
        expect(publicAvailability.data).toMatchObject(envelope);
      }
      const states: DemoInventoryUnit["calendarState"][] =
        day === demo.recordedDay
          ? ["confirmed_booking", "open", "component_unavailable"]
          : ["open", "open", "open"];
      assertDemoInventoryReadback({
        ownerCalendar: ownerCalendar.data,
        publicAvailability: publicAvailability.data,
        expectedUnits: cottage.units.map((unit, position) => ({
          ...unit,
          calendarState: states[position],
          available: states[position] === "open",
        })),
      });
      if (day !== demo.recordedDay) {
        for (const unit of ownerCalendar.data.units) {
          expect(unit.commitmentReference).toBeNull();
          expect(unit.editable).toBe(true);
        }
      }
    }
    const signedOut = await owner.auth.signOut();
    if (signedOut.error) throw signedOut.error;
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
