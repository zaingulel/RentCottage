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
import { bookingPayoutMessages as payoutMessages } from "../src/i18n/administrator-payment-history-messages";
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
  "supabase/tests/database/booking_cancellation.test.sql",
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
const fixture = source
  .slice(0, source.indexOf("-- END CANCELLATION FIXTURE"))
  .replace(
    /insert into auth.users \(id, aud, role, phone, phone_confirmed_at\) values[\s\S]*?;/,
    "",
  )
  .replace(
    /'\{"cottageName":"Preserved Cottage"[^\n]+?'::jsonb/g,
    `'${JSON.stringify(browserQuote)}'::jsonb`,
  );
let activeAdministratorId: string | null = null;
const observer = readFileSync(
  "scripts/verify-booking-payout-concurrency.mjs",
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
      "Cancellation browser proof requires the exact disposable Supabase",
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
  const email = `cancellation-${randomUUID()}@rentcottage.test`;
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
async function snapshots(
  page: Page,
  role: "customer" | "cottage_owner" | "platform_administrator",
  project: string,
  label: string,
) {
  mkdirSync(".agent-evidence/visible-screenshots", { recursive: true });
  for (const locale of ["en", "ar", "ckb"] as const) {
    const route =
      role === "customer"
        ? "booking-requests"
        : role === "cottage_owner"
          ? "owner/booking-requests"
          : "administrator/payments";
    await page.goto(`/${locale}/${route}/${reference}`);
    await expect(
      page.getByRole("region", { name: messages[locale].title }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.agent-evidence/visible-screenshots/${project}-${label}-${locale}.png`,
      fullPage: true,
    });
    if (role === "platform_administrator")
      await page
        .getByRole("region", { name: messages[locale].title })
        .screenshot({
          path: `.agent-evidence/visible-screenshots/${project}-${label}-${locale}-financial.png`,
        });
  }
}
test.describe("retained cancellation and refund controls", () => {
  test.setTimeout(120000);
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
    const payoutJourney = test.info().title.includes("payout holds");
    const datedFixture = fixture.replace(
      "fixture:=replace(fixture,'2101-01-02'",
      "fixture:=replace(fixture,'2101-01-03',(start_day+2)::text); fixture:=replace(fixture,'2101-01-02'",
    );
    harness.runSql(
      `${datedFixture}select pg_temp.seed_cancellation_booking(${payoutJourney ? "(clock_timestamp() at time zone 'Asia/Baghdad')::date-3" : "'2101-01-01'"});commit;`,
    );
    if (payoutJourney)
      harness.runSql(
        `set role service_role;select public.commit_booking_completion('${request}',(select value->>'revision' from public.list_due_booking_completions(50) value));`,
      );
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
  test("administrator manages independent payout holds and settlement on the existing detail", async ({
    page,
    browser,
    baseURL,
  }, info) => {
    await administrator(page);
    await page.goto(`/en/administrator/payments/${reference}`);
    const p = payoutMessages.en;
    const command = async (
      action: "place_hold" | "release_hold" | "open_dispute" | "settle",
      reason: string,
    ) => {
      const form = page.getByRole("form", { name: p[action] });
      await form.getByLabel(p.reason, { exact: true }).fill(reason);
      await form.getByRole("button", { name: p[action], exact: true }).click();
    };
    await command("place_hold", "PRIVATE payout review");
    await expect(page.getByText(p.held, { exact: true })).toBeVisible();
    await command("open_dispute", "PRIVATE dispute review");
    await expect(page.getByText(p.open, { exact: true })).toBeVisible();
    const resolution = page.getByRole("form", { name: p.resolve_dispute });
    await resolution.getByLabel(p.outcome).selectOption("owner_won");
    await resolution
      .getByLabel(p.reason, { exact: true })
      .fill("PRIVATE decision");
    await resolution
      .getByRole("button", { name: p.resolve_dispute, exact: true })
      .click();
    await expect(page.getByText(p.resolved, { exact: true })).toBeVisible();
    await expect(page.getByText(p.held, { exact: true })).toBeVisible();
    await command("settle", "Held settlement check");
    await expect(
      page.getByRole("form", { name: p.settle }).getByRole("alert"),
    ).toContainText(p.blocked);
    expect(
      harness.runSql(
        `select count(*) from public.payment_provider_operations where operation_kind='settlement'`,
      ),
    ).toBe("0");
    await snapshots(
      page,
      "platform_administrator",
      info.project.name,
      "payout-held",
    );
    await page.goto(`/en/administrator/payments/${reference}`);
    await command("release_hold", "PRIVATE review complete");
    await expect(page.getByText(p.clear, { exact: true })).toBeVisible();
    await command("settle", "PRIVATE settlement approval");
    await expect(page.getByTestId("settlement-recovery")).toContainText(
      "IQD 99,000",
    );
    await expect(page.getByTestId("settlement-recovery")).toContainText(
      p.noDebit,
    );
    await snapshots(
      page,
      "platform_administrator",
      info.project.name,
      "payout-settled",
    );
    const ownerContext = await browser.newContext({
      baseURL,
      viewport: page.viewportSize() ?? undefined,
    });
    try {
      await participant(ownerContext, owner, baseURL);
      const ownerPage = await ownerContext.newPage();
      await ownerPage.goto(`/en/owner/booking-requests/${reference}`);
      await expect(
        ownerPage.getByText("PRIVATE payout review", { exact: true }),
      ).toHaveCount(0);
      await expect(
        ownerPage.getByRole("region", { name: p.title }),
      ).toHaveCount(0);
      await expect(ownerPage.getByTestId("settlement-recovery")).toHaveCount(0);
    } finally {
      await ownerContext.close();
    }
  });
  test("customer cancels with the disclosed rule and returns through retained history", async ({
    page,
    baseURL,
  }, info) => {
    await participant(page.context(), customer, baseURL);
    await page.goto(`/en/booking-requests/${reference}`);
    await expect(
      page.getByRole("heading", { name: "Confirmed booking", exact: true }),
    ).toBeVisible();
    const form = page.getByRole("form", { name: messages.en.cancel });
    await expect(form).toContainText("48 hours");
    await form.getByRole("checkbox").focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: "Cancelled booking", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Full refund required", exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("verified-refund")).toContainText("IQD 0");
    await expect(
      page.getByText("Private address", { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText("+9647500001001", { exact: true })).toHaveCount(
      0,
    );
    await page.getByRole("link", { name: messages.en.history }).click();
    await expect(page).toHaveURL("/en/bookings");
    await expect(
      page.getByRole("heading", { name: "My bookings", exact: true }),
    ).toBeVisible();
    const retainedBooking = page.getByRole("link", {
      name: /Preserved Cottage/,
    });
    await expect(retainedBooking).toContainText("Cancelled booking");
    await expect(retainedBooking).toHaveAttribute(
      "href",
      `/en/booking-requests/${reference}`,
    );
    await retainedBooking.click();
    await expect(
      page.getByRole("heading", { name: "Cancelled booking", exact: true }),
    ).toBeVisible();
    await snapshots(page, "customer", info.project.name, "customer-cancelled");
    expect((await triggerScheduled(baseURL, "/__scheduled")).ok).toBe(true);
    await page.goto(`/en/booking-requests/${reference}`);
    await expect(page.getByTestId("verified-refund")).toContainText(
      "IQD 115,000",
    );
    await expect(
      page.getByText("Private address", { exact: true }),
    ).toHaveCount(0);
  });
  test("owner must supply a reason and retains the no-payout cancellation outcome", async ({
    page,
    baseURL,
  }, info) => {
    await participant(page.context(), owner, baseURL);
    await page.goto(`/ar/owner/booking-requests/${reference}`);
    const form = page.getByRole("form", { name: messages.ar.cancel });
    await form.getByRole("checkbox").check();
    await form
      .getByRole("button", { name: messages.ar.cancel, exact: true })
      .click();
    await expect(form.getByRole("textbox")).toBeFocused();
    await form.getByRole("textbox").fill("PRIVATE owner operational reason");
    await form
      .getByRole("button", { name: messages.ar.cancel, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: messages.ar.cancelled, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(messages.ar.noPayout, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("PRIVATE owner operational reason", { exact: true }),
    ).toHaveCount(0);
    await snapshots(
      page,
      "cottage_owner",
      info.project.name,
      "owner-cancelled",
    );
  });
  test("administrator approves exact partial exceptions then cancels with a privileged reason", async ({
    page,
    browser,
    baseURL,
  }, info) => {
    await administrator(page);
    const ownerContext = await browser.newContext({
      baseURL,
      viewport: page.viewportSize() ?? undefined,
    });
    try {
      await page.goto(`/en/administrator/payments/${reference}`);
      let form = page.getByRole("form", { name: messages.en.exception });
      await form
        .getByLabel(messages.en.reason)
        .fill("PRIVATE first compensation");
      await form.getByLabel(messages.en.priceInput).fill("20000.001");
      await form.getByRole("button", { name: messages.en.approve }).click();
      await expect(form.getByRole("alert")).toContainText(messages.en.invalid);
      const initialId = await form
        .locator('input[name="commandId"]')
        .inputValue();
      await form.getByLabel(messages.en.priceInput).fill("20000");
      await form.getByLabel(messages.en.feeInput).fill("0.001");
      await form.getByRole("button", { name: messages.en.approve }).click();
      await expect(
        page.getByRole("list", { name: messages.en.approved }),
      ).toContainText("IQD 20,000.001");
      await expect(form.locator('input[name="commandId"]')).not.toHaveValue(
        initialId,
      );
      await expect(form.getByLabel(messages.en.reason)).toHaveValue("");
      await participant(ownerContext, owner, baseURL);
      const ownerPage = await ownerContext.newPage();
      await ownerPage.goto(`${baseURL}/en/owner/booking-requests/${reference}`);
      await expect(
        ownerPage.getByTestId("owner-after-completed"),
      ).toContainText("IQD 99,000");
      await expect(
        ownerPage.getByText(messages.en.pendingWarning, { exact: true }),
      ).toBeVisible();
      await expect(
        ownerPage.getByText("PRIVATE first compensation", { exact: true }),
      ).toHaveCount(0);
      expect((await triggerScheduled(baseURL, "/__scheduled")).ok).toBe(true);
      await ownerPage.reload();
      await expect(
        ownerPage.getByTestId("owner-after-completed"),
      ).toContainText("IQD 81,000");
      await expect(ownerPage.getByTestId("verified-refund")).toContainText(
        "IQD 20,000.001",
      );
      await snapshots(
        ownerPage,
        "cottage_owner",
        info.project.name,
        "owner-partial-returned",
      );
      await page.reload();
      form = page.getByRole("form", { name: messages.en.exception });
      await form
        .getByLabel(messages.en.reason)
        .fill("PRIVATE fee-only compensation");
      await form.getByLabel(messages.en.feeInput).fill("0.002");
      await form.getByRole("button", { name: messages.en.approve }).click();
      await expect(
        page.getByRole("list", { name: messages.en.approved }).locator("li"),
      ).toHaveCount(2);
      expect((await triggerScheduled(baseURL, "/__scheduled")).ok).toBe(true);
      await ownerPage.goto(`${baseURL}/en/owner/booking-requests/${reference}`);
      await expect(
        ownerPage.getByTestId("owner-after-completed"),
      ).toContainText("IQD 81,000");
      await expect(ownerPage.getByTestId("verified-refund")).toContainText(
        "IQD 20,000.003",
      );
      await page.goto(`/ckb/administrator/payments/${reference}`);
      const cancel = page.getByRole("form", { name: messages.ckb.cancel });
      await cancel.getByLabel(messages.ckb.category).selectOption("safety");
      await cancel
        .getByLabel(messages.ckb.reason, { exact: true })
        .fill("PRIVATE administrator safety reason");
      await cancel.getByRole("checkbox").check();
      await cancel
        .getByRole("button", { name: messages.ckb.cancel, exact: true })
        .click();
      await expect(
        page.getByRole("heading", {
          name: messages.ckb.cancelled,
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByText(messages.ckb.noPayout, { exact: true }),
      ).toBeVisible();
      await snapshots(
        page,
        "platform_administrator",
        info.project.name,
        "administrator-cancelled",
      );
      await ownerPage.goto(`${baseURL}/en/owner/booking-requests/${reference}`);
      await expect(
        ownerPage.getByText("PRIVATE administrator safety reason", {
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(
        ownerPage.getByText("Private address", { exact: true }),
      ).toHaveCount(0);
    } finally {
      await ownerContext.close();
    }
  });
});
