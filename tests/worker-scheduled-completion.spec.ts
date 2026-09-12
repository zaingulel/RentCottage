import { expect, test, type Page, type BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { readFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import * as OTPAuth from "otpauth";
import { getConfirmedBookingAccess } from "../src/booking-request/confirmed-booking-access";
import { getBookingFinancialView } from "../src/booking-request/booking-financial-view";
import { triggerScheduled } from "./fixtures/trigger-scheduled";
import { bookingLifecycleMessages as lifecycle } from "../src/i18n/booking-lifecycle-messages";
import { bookingManagementMessages as messages } from "../src/i18n/booking-management-messages";
const { createLocalSupabaseConcurrencyHarness } = createRequire(
  import.meta.url,
)("../scripts/local-supabase-concurrency-harness.mjs") as {
  createLocalSupabaseConcurrencyHarness(): {
    guardDisposableLocalDatabase(): void;
    runSql(sql: string): string;
  };
};
const harness = createLocalSupabaseConcurrencyHarness();
const request = "60000000-0000-4000-8000-000000001001",
  reference = "RC-REQ-0000000000001001";
const owner = "10000000-0000-4000-8000-000000001001",
  customer = "10000000-0000-4000-8000-000000001002";
const source = readFileSync(
  "supabase/tests/database/booking_completion.test.sql",
  "utf8",
);
const browserQuote = {
  cottageName: "Preserved Cottage",
  houseRules: "Preserved House Rules",
  bookingPriceIqd: 110000,
  serviceFeeIqd: 5000,
  customerTotalIqd: 115000,
  items: [
    {
      serviceDay: "2101-01-01",
      displayName: "Morning",
      startsAt: "2101-01-01T08:00:00+03:00",
      endsAt: "2101-01-01T12:00:00+03:00",
      crossesMidnight: false,
      priceIqd: 30000,
      kind: "shift",
      position: 1,
    },
    {
      serviceDay: "2101-01-01",
      displayName: "Night",
      startsAt: "2101-01-01T20:00:00+03:00",
      endsAt: "2101-01-02T02:00:00+03:00",
      crossesMidnight: true,
      priceIqd: 30000,
      kind: "shift",
      position: 3,
    },
    {
      serviceDay: "2101-01-02",
      displayName: "Full day",
      startsAt: "2101-01-02T08:00:00+03:00",
      endsAt: "2101-01-03T02:00:00+03:00",
      crossesMidnight: true,
      priceIqd: 50000,
      kind: "full-day",
    },
  ],
};
const section = (name: string) => {
  const start = source.indexOf(`-- BEGIN ${name}`),
    end = source.indexOf(`-- END ${name}`, start);
  if (start < 0 || end < 0) throw new Error(`Missing ${name}`);
  return source.slice(start, end);
};
const fixture =
  `begin; ${section("PAYMENT EVIDENCE FIXTURE")} ${section("COMPLETION FIXTURE")}`
    .replace(
      /insert into auth.users \(id, aud, role, phone, phone_confirmed_at\) values[\s\S]*?;/,
      "",
    )
    .replace(
      /'\{"cottageName":"Preserved Cottage"[^\n]+?'::jsonb/g,
      `'${JSON.stringify(browserQuote)}'::jsonb`,
    )
    .replace(
      "fixture:=replace(fixture,'2101-01-02'",
      "fixture:=replace(fixture,'2101-01-03',(start_day+2)::text); fixture:=replace(fixture,'2101-01-02'",
    );
let activeAdministratorId: string | null = null;
const observer = readFileSync(
  "scripts/verify-booking-completion-concurrency.mjs",
  "utf8",
);
const template = (name: string) =>
  observer.split(`const ${name} = \``)[1].split("`;")[0];
let cleanup =
  template("resetCancellation") +
  template("cleanup").replace("${resetCancellation}", "");
for (const [key, value] of Object.entries({
  request,
  owner,
  customer,
  claim: "72000000-0000-4000-8000-000000001001",
}))
  cleanup = cleanup.replaceAll(`\${${key}}`, value);
const clear = () => {
  harness.guardDisposableLocalDatabase();
  harness.runSql(
    `delete from auth.sessions where user_id in ('${owner}','${customer}','10000000-0000-4000-8000-000000001003');delete from auth.identities where user_id in ('${owner}','${customer}','10000000-0000-4000-8000-000000001003');${cleanup}`,
  );
};
function connection() {
  harness.guardDisposableLocalDatabase();
  const url = process.env.SUPABASE_URL,
    key = process.env.SUPABASE_SECRET_KEY,
    publishable = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (
    process.env.APP_ENVIRONMENT !== "test" ||
    !url ||
    new URL(url).protocol !== "http:" ||
    new URL(url).hostname !== "127.0.0.1" ||
    !key ||
    !publishable
  )
    throw new Error(
      "Completion browser proof requires the exact disposable Supabase",
    );
  return {
    url,
    key,
    publishable,
    admin: createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  };
}
async function participant(
  context: BrowserContext,
  userId: string,
  baseURL: string | undefined,
) {
  const { url, publishable } = connection();
  const password = "Local-cancellation-test-password-2026";
  const values: {
    name: string;
    value: string;
    options: {
      path?: string;
      httpOnly?: boolean;
      sameSite?: boolean | "lax" | "strict" | "none";
      secure?: boolean;
    };
  }[] = [];
  const client = createServerClient(url, publishable, {
    cookieOptions: { name: "rentcottage-auth" },
    cookies: {
      getAll: () => [],
      setAll: (items) => {
        values.push(...items);
      },
    },
  });
  const { error } = await client.auth.signInWithPassword({
    phone: userId === owner ? "+9647500001001" : "+9647500001002",
    password,
  });
  if (error) throw error;
  // A real authenticated setup/read preflight fails before any browser journey
  // when the purchased snapshot, participant binding or financial view is invalid.
  const role = userId === owner ? "cottage_owner" : "customer";
  const access = await getConfirmedBookingAccess(client, reference);
  const financial = await getBookingFinancialView(client, reference, role);
  expect(access?.actorRole).toBe(role);
  expect(financial?.captured).toEqual({
    bookingPriceFils: 110000000,
    bookingServiceFeeFils: 5000000,
  });
  expect(financial).not.toHaveProperty("audit");
  if (!baseURL) throw new Error("Missing browser origin");
  await context.addCookies(
    values.map(({ name, value, options }) => ({
      name,
      value,
      url: baseURL,
      httpOnly: options.httpOnly,
      secure: false,
      sameSite:
        options.sameSite === "strict" ? ("Strict" as const) : ("Lax" as const),
    })),
  );
}
async function administrator(page: Page) {
  const { admin } = connection();
  const email = `completion-${randomUUID()}@rentcottage.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: "Local-test-password-2026",
    email_confirm: true,
  });
  if (error || !data.user)
    throw new Error("Could not create local administrator");
  activeAdministratorId = data.user.id;
  const provision = await admin.rpc("provision_platform_administrator", {
    target_user_id: data.user.id,
  });
  if (provision.error) throw provision.error;
  await page.goto("/en/administrator/access");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("Local-test-password-2026");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const secret = await page.getByTestId("mfa-secret").textContent();
  if (!secret) throw new Error("Missing MFA enrollment secret");
  await page.getByLabel("Authenticator app code").fill(
    new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(secret),
    }).generate(),
  );
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page.getByText(/Administrator access is ready/)).toBeVisible();
  return data.user.id;
}
function observe() {
  return JSON.parse(
    harness.runSql(`select jsonb_build_object(
    'outcomes',(select coalesce(jsonb_agg(to_jsonb(o) order by id),'[]') from public.booking_lifecycle_outcomes o where booking_request_id='${request}'),
    'maturity',(select coalesce(jsonb_agg(to_jsonb(m) order by booking_request_id),'[]') from public.booking_completion_maturity m where booking_request_id='${request}'),
    'incidents',(select coalesce(jsonb_agg(to_jsonb(i) order by id),'[]') from public.booking_incidents i where booking_request_id='${request}'),
    'end',(select upper(range_merge(access_ranges)) from public.cottage_booking_period_commitments where id='50000000-0000-4000-8000-000000001001'),
    'original',jsonb_build_object(
      'snapshot',(select to_jsonb(s) from public.booking_snapshots s where id='40000000-0000-4000-8000-000000001001'),
      'confirmation',(select to_jsonb(c) from public.booking_confirmations c where booking_request_id='${request}'),
      'receipts',(select jsonb_agg(to_jsonb(r) order by id) from public.booking_receipts r where booking_confirmation_id in (select id from public.booking_confirmations where booking_request_id='${request}')),
      'commitment',(select to_jsonb(c) from public.cottage_booking_period_commitments c where id='50000000-0000-4000-8000-000000001001'),
      'operations',(select jsonb_agg(to_jsonb(o) order by id) from public.payment_provider_operations o where claim_id='72000000-0000-4000-8000-000000001001'),
      'observations',(select jsonb_agg(to_jsonb(o) order by id) from public.payment_provider_observations o where operation_id in (select id from public.payment_provider_operations where claim_id='72000000-0000-4000-8000-000000001001')),
      'paymentHistory',(select jsonb_agg(to_jsonb(h) order by id) from public.booking_request_payment_history h where booking_request_id='${request}')));`),
  );
}
async function tick(baseURL: string | undefined) {
  expect((await triggerScheduled(baseURL, "/__scheduled")).ok).toBe(true);
}
function route(
  role: "customer" | "cottage_owner" | "platform_administrator",
  locale = "en",
) {
  return `/${locale}/${role === "customer" ? "booking-requests" : role === "cottage_owner" ? "owner/booking-requests" : "administrator/payments"}/${reference}`;
}
async function privatePage(
  page: Page,
  target: string,
  ...restricted: string[]
) {
  const response = await page.goto(target);
  expect(response?.ok()).toBe(true);
  const payload = await response!.text();
  for (const secret of restricted) {
    expect(payload).not.toContain(secret);
    expect(await page.content()).not.toContain(secret);
  }
  return page.getByRole("region", { name: lifecycle.en.title });
}
async function screenshots(
  page: Page,
  role: "customer" | "cottage_owner" | "platform_administrator",
  status: "completed" | "incident_pending" | "no_show",
  label: string,
) {
  mkdirSync(".agent-evidence/lifecycle-screenshots", { recursive: true });
  for (const [size, viewport] of [
    ["mobile", { width: 393, height: 851 }],
    ["desktop", { width: 1440, height: 1000 }],
  ] as const) {
    await page.setViewportSize(viewport);
    for (const locale of ["en", "ar", "ckb"] as const) {
      await page.goto(route(role, locale));
      const region = page.getByRole("region", {
        name: lifecycle[locale].title,
      });
      await expect(region).toBeVisible();
      await expect(region).toContainText(lifecycle[locale][status]);
      expect(await page.locator("html").getAttribute("dir")).toBe(
        locale === "en" ? "ltr" : "rtl",
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `.agent-evidence/lifecycle-screenshots/${label}-${size}-${locale}.png`,
        fullPage: true,
      });
      await region.screenshot({
        path: `.agent-evidence/lifecycle-screenshots/${label}-${size}-${locale}-lifecycle.png`,
      });
    }
  }
}
test.describe("scheduled completion and restricted lifecycle journeys", () => {
  test.setTimeout(180000);
  test.use({ actionTimeout: 10000 });
  test.beforeEach(async () => {
    clear();
    const { admin } = connection();
    for (const [id, phone] of [
      [owner, "+9647500001001"],
      [customer, "+9647500001002"],
      ["10000000-0000-4000-8000-000000001003", "+9647500001003"],
    ]) {
      const result = await admin.auth.admin.createUser({
        id,
        phone,
        password: "Local-cancellation-test-password-2026",
        phone_confirm: true,
      });
      if (result.error || result.data.user?.id !== id)
        throw new Error("Could not create exact participant Auth identity", {
          cause: result.error,
        });
    }
    harness.runSql(
      `${fixture} select pg_temp.seed_completion_booking((clock_timestamp() at time zone 'Asia/Baghdad')::date-3); commit;`,
    );
    expect(
      harness.runSql(
        `select public.booking_request_payment_status(r) from public.booking_requests r where id='${request}'`,
      ),
    ).toBe("paid-confirmed");
  });
  test.afterEach(async () => {
    clear();
    if (activeAdministratorId) {
      const { error } = await connection().admin.auth.admin.deleteUser(
        activeAdministratorId,
      );
      if (error) throw error;
      activeAdministratorId = null;
    }
  });
  test("actual scheduled tick records completion once with the original purchased end and financial evidence", async ({
    baseURL,
  }) => {
    const before = observe();
    expect(before.outcomes).toEqual([]);
    await tick(baseURL);
    const after = observe();
    expect(after.outcomes).toHaveLength(1);
    expect(after.outcomes[0]).toMatchObject({
      outcome: "completed",
      effective_period_end: before.end,
    });
    expect(after.maturity).toHaveLength(1);
    expect(after.maturity[0]).toMatchObject({
      outcome: "completed",
      effective_period_end: before.end,
    });
    expect(
      Date.parse(after.maturity[0].review_expires_at) - Date.parse(before.end),
    ).toBe(14 * 24 * 60 * 60 * 1000);
    expect(after.original).toEqual(before.original);
    await tick(baseURL);
    expect(observe()).toEqual(after);
  });
  test("participants retain completed bookings and a later administrator incident stays restricted", async ({
    page,
    browser,
    baseURL,
  }) => {
    await tick(baseURL);
    const before = observe();
    await participant(page.context(), customer, baseURL);
    await page.goto(route("customer"));
    await expect(
      page.getByRole("heading", { name: lifecycle.en.completed, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("form", { name: messages.en.cancel }),
    ).toHaveCount(0);
    await expect(
      page.getByText(lifecycle.en.reviewOpen, { exact: false }),
    ).toBeVisible();
    await page.goto("/en/bookings");
    await expect(
      page.getByRole("link", { name: /Preserved Cottage/ }),
    ).toContainText(lifecycle.en.completed);
    await screenshots(page, "customer", "completed", "customer-completed");
    const adminContext = await browser.newContext({ baseURL });
    const ownerContext = await browser.newContext({ baseURL });
    try {
      const adminPage = await adminContext.newPage();
      await administrator(adminPage);
      await adminPage.goto(route("platform_administrator"));
      await expect(
        adminPage.getByRole("form", { name: lifecycle.en.markNoShow }),
      ).toHaveCount(0);
      const form = adminPage.getByRole("form", { name: lifecycle.en.report });
      await form.getByLabel(lifecycle.en.category).selectOption("safety");
      await form
        .getByLabel(lifecycle.en.reason)
        .fill("PRIVATE later administrator incident39");
      await form
        .getByRole("button", { name: lifecycle.en.report, exact: true })
        .click();
      await expect(
        adminPage.getByRole("region", { name: lifecycle.en.incidents }),
      ).toContainText("PRIVATE later administrator incident39");
      const after = observe();
      expect(after.outcomes).toEqual(before.outcomes);
      expect(after.maturity).toEqual(before.maturity);
      expect(after.original).toEqual(before.original);
      await privatePage(
        page,
        route("customer"),
        "PRIVATE later administrator incident39",
        activeAdministratorId!,
      );
      await participant(ownerContext, owner, baseURL);
      const ownerPage = await ownerContext.newPage();
      const region = await privatePage(
        ownerPage,
        route("cottage_owner"),
        "PRIVATE later administrator incident39",
        activeAdministratorId!,
      );
      await expect(region).toContainText(lifecycle.en.payoutReady);
      await expect(region).toContainText(lifecycle.en.payoutHelp);
    } finally {
      await adminContext.close();
      await ownerContext.close();
    }
  });
  test("approved owner reports an incident that blocks completion without leaking narrative to either participant", async ({
    page,
    browser,
    baseURL,
  }) => {
    const before = observe();
    await participant(page.context(), owner, baseURL);
    await page.goto(route("cottage_owner"));
    await expect(
      page.getByRole("form", { name: lifecycle.en.markNoShow }),
    ).toHaveCount(0);
    const form = page.getByRole("form", { name: lifecycle.en.report });
    await form
      .getByLabel(lifecycle.en.category)
      .selectOption("property_damage");
    await form
      .getByRole("button", { name: lifecycle.en.report, exact: true })
      .click();
    await expect(form.getByRole("textbox")).toBeFocused();
    await form.getByLabel(lifecycle.en.reason).fill("PRIVATE owner incident39");
    await form
      .getByRole("button", { name: lifecycle.en.report, exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: lifecycle.en.incident_pending,
        exact: true,
      }),
    ).toBeVisible();
    await expect(form.getByText(lifecycle.en.recorded)).toBeVisible();
    await expect(form.getByRole("textbox")).toHaveValue("");
    await tick(baseURL);
    await tick(baseURL);
    const after = observe();
    expect(after.outcomes).toEqual([]);
    expect(after.maturity).toEqual([]);
    expect(after.incidents).toHaveLength(1);
    expect(after.incidents[0]).toMatchObject({
      actor_user_id: owner,
      actor_role: "cottage_owner",
      category: "property_damage",
      narrative: "PRIVATE owner incident39",
    });
    expect(after.original).toEqual(before.original);
    await privatePage(page, route("cottage_owner"), "PRIVATE owner incident39");
    await screenshots(
      page,
      "cottage_owner",
      "incident_pending",
      "owner-incident",
    );
    const customerContext = await browser.newContext({ baseURL });
    const adminContext = await browser.newContext({ baseURL });
    try {
      await participant(customerContext, customer, baseURL);
      const customerPage = await customerContext.newPage();
      await privatePage(
        customerPage,
        route("customer"),
        "PRIVATE owner incident39",
      );
      await expect(
        customerPage.getByRole("form", { name: lifecycle.en.report }),
      ).toHaveCount(0);
      const adminPage = await adminContext.newPage();
      await administrator(adminPage);
      await adminPage.goto(route("platform_administrator"));
      await expect(
        adminPage.getByRole("region", { name: lifecycle.en.incidents }),
      ).toContainText("PRIVATE owner incident39");
      await expect(
        adminPage.getByRole("form", { name: lifecycle.en.markNoShow }),
      ).toHaveCount(0);
    } finally {
      await customerContext.close();
      await adminContext.close();
    }
  });
  test("administrator records a zero-refund no-show; maturity preserves it and grants no review", async ({
    page,
    browser,
    baseURL,
  }) => {
    const before = observe();
    const administratorId = await administrator(page);
    await page.goto(route("platform_administrator"));
    const form = page.getByRole("form", { name: lifecycle.en.markNoShow });
    await expect(form).toContainText(lifecycle.en.noShowHelp);
    await form.getByLabel(lifecycle.en.reason).fill("PRIVATE no-show reason39");
    await form
      .getByRole("button", { name: lifecycle.en.markNoShow, exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: lifecycle.en.title }),
    ).toContainText(lifecycle.en.no_show);
    await expect(
      page.getByRole("region", { name: lifecycle.en.noShowAttribution }),
    ).toContainText("PRIVATE no-show reason39");
    const recorded = observe();
    expect(recorded.outcomes).toHaveLength(1);
    expect(recorded.outcomes[0]).toMatchObject({
      outcome: "no_show",
      actor_user_id: administratorId,
    });
    expect(recorded.original).toEqual(before.original);
    await tick(baseURL);
    const after = observe();
    expect(after.outcomes).toEqual(recorded.outcomes);
    expect(after.maturity).toHaveLength(1);
    expect(after.maturity[0]).toMatchObject({
      outcome: "no_show",
      effective_period_end: before.end,
      review_expires_at: null,
    });
    expect(after.original).toEqual(before.original);
    await tick(baseURL);
    expect(observe()).toEqual(after);
    await screenshots(
      page,
      "platform_administrator",
      "no_show",
      "administrator-no-show",
    );
    const customerContext = await browser.newContext({ baseURL });
    try {
      await participant(customerContext, customer, baseURL);
      const customerPage = await customerContext.newPage();
      const region = await privatePage(
        customerPage,
        route("customer"),
        "PRIVATE no-show reason39",
        administratorId,
      );
      await expect(region).toContainText(lifecycle.en.noRefund);
      await expect(region).toContainText(lifecycle.en.reviewClosed);
      await expect(
        customerPage.getByRole("form", { name: messages.en.cancel }),
      ).toHaveCount(0);
    } finally {
      await customerContext.close();
    }
  });
});
