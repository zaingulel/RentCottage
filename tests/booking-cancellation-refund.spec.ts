import {
  expect,
  test,
  type Page,
  type BrowserContext,
  type Locator,
} from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import * as OTPAuth from "otpauth";
import { getConfirmedBookingAccess } from "../src/booking-request/confirmed-booking-access";
import { getBookingFinancialView } from "../src/booking-request/booking-financial-view";
import { triggerScheduled } from "./fixtures/trigger-scheduled";
import {
  administratorPaymentHistoryMessages,
  bookingPayoutMessages as payoutMessages,
} from "../src/i18n/administrator-payment-history-messages";
import { administratorQueuesMessages } from "../src/i18n/administrator-queues-messages";
import { administratorRecordsMessages } from "../src/i18n/administrator-records-messages";
import { administratorTotalsMessages } from "../src/i18n/administrator-totals-messages";
import { bookingManagementMessages as messages } from "../src/i18n/booking-management-messages";
import { bookingLifecycleMessages } from "../src/i18n/booking-lifecycle-messages";
import { ownerBookingEarningsMessages as earningsMessages } from "../src/i18n/owner-booking-earnings-messages";
import { ownerBookingEarnings } from "../src/booking-request/owner-booking-earnings";
import type { Locale } from "../src/i18n/routing";
const { createLocalSupabaseConcurrencyHarness } = createRequire(
  import.meta.url,
)("../scripts/local-supabase-concurrency-harness.mjs") as {
  createLocalSupabaseConcurrencyHarness(): {
    guardDisposableLocalDatabase(): void;
    runSql(sql: string): string;
  };
};
const { confirmedBookingCleanup } = createRequire(import.meta.url)(
  "../scripts/lib/booking-fixture.mjs",
) as {
  confirmedBookingCleanup(options?: {
    stem?: string;
    completion?: boolean;
    settlement?: boolean;
    terminalRequest?: boolean;
  }): string;
};
const harness = createLocalSupabaseConcurrencyHarness();
async function expectAmount(figures: Locator, label: string, amount: string) {
  await expect(
    figures
      .getByText(label, { exact: true })
      .locator("xpath=following-sibling::dd[1]"),
  ).toHaveText(amount);
}
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
const cleanup = confirmedBookingCleanup({
  completion: true,
  settlement: true,
});
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
  if (role === "cottage_owner") {
    expect(financial?.ownerEarnings).toBeDefined();
    expect(ownerBookingEarnings(financial!.ownerEarnings!).status).not.toBe(
      "unavailable",
    );
  }
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
async function captureMetadataViewports(
  page: Page,
  region: Locator,
  screenshotPrefix: string,
  observe: () => Promise<string[][]>,
) {
  const observations = [];
  for (const [viewport, size] of [
    ["desktop", { width: 1440, height: 1000 }],
    ["mobile", { width: 393, height: 851 }],
  ] as const) {
    await page.setViewportSize(size);
    await expect(region).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    await region.screenshot({
      path: test.info().outputPath(`${screenshotPrefix}-${viewport}.png`),
    });
    observations.push({ viewport, values: await observe() });
  }
  return observations;
}
async function assertResponsiveDetails(
  page: Page,
  role: "customer" | "cottage_owner" | "platform_administrator",
) {
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
  }
}
// The database is shared across specs, so the reference may sit on a later page.
async function findQueueRow(page: Page, locale: Locale = "en") {
  const row = page.getByRole("link", { name: reference, exact: true });
  const next = page.getByRole("link", {
    name: administratorRecordsMessages[locale].next,
  });
  while (!(await row.count())) {
    await expect(next).toHaveCount(1);
    await next.click();
  }
  return row.first();
}
const baghdadDate = (at: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad" }).format(at);
// WCAG 2.2 Success Criterion 2.5.8 sets the 24 by 24 CSS pixel minimum.
async function captureQueueFilters(
  page: Page,
  locale: Locale,
  screenshotPrefix: string,
) {
  const copy = administratorQueuesMessages[locale];
  const records = administratorRecordsMessages[locale];
  const controls = [
    ...(await page
      .getByRole("group", { name: copy.queuesLabel })
      .getByRole("button")
      .all()),
    page.getByLabel(records.status),
    page.getByLabel(records.from),
    page.getByLabel(records.through),
    page.getByRole("button", { name: copy.apply, exact: true }),
    page.getByRole("link", { name: records.reset, exact: true }),
  ];
  expect(controls).toHaveLength(9);
  const original = page.viewportSize();
  for (const [viewport, size] of [
    ["desktop", { width: 1440, height: 1000 }],
    ["mobile", { width: 393, height: 851 }],
  ] as const) {
    await page.setViewportSize(size);
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    for (const control of controls) {
      await expect(control).toBeVisible();
      const box = await control.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(24);
      expect(box!.height).toBeGreaterThanOrEqual(24);
    }
    await page.screenshot({
      path: test
        .info()
        .outputPath(`${screenshotPrefix}-${locale}-${viewport}.png`),
    });
  }
  await page.setViewportSize(original!);
}
test.describe("retained cancellation and refund controls", () => {
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
  }) => {
    await administrator(page);
    await page.goto(`/en/administrator/payments/${reference}`);
    const p = payoutMessages.en;
    const command = async (
      action: "place_hold" | "release_hold" | "open_dispute" | "settle",
      reason: string,
    ) => {
      const form = page.getByRole("form", { name: p[action] });
      await form.getByLabel(p.reason, { exact: true }).fill(reason);
      const payoutCommandControl = form.getByRole("button", {
        name: p[action],
        exact: true,
      });
      await payoutCommandControl.focus();
      await expect(payoutCommandControl).toBeFocused();
      const payoutCommandSource = await payoutCommandControl.elementHandle();
      if (!payoutCommandSource)
        throw new Error("Focus measurement source is missing");
      const payoutCommandMeasurement = await payoutCommandSource.evaluateHandle(
        (source, labels) => {
          const rows: Record<string, string | boolean | null>[] = [];
          const read = (phase: string) =>
            rows.push({
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
            });
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
          return { read, observer, rows };
        },
        { family: "booking-management-controls", action: action },
      );
      await payoutCommandControl.press("Enter");
      return {
        measurement: payoutCommandMeasurement,
        source: payoutCommandSource,
      };
    };
    const payoutHoldObservation = await command(
      "place_hold",
      "PRIVATE payout review",
    );
    await expect(page.getByText(p.held, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: p.title, exact: true }),
    ).toBeFocused();
    const payoutHoldRows = await payoutHoldObservation.measurement.evaluate(
      (measurement) => {
        measurement.read("settled");
        measurement.observer.disconnect();
        return measurement.rows;
      },
    );
    await test
      .info()
      .attach("focus-payoutHold", {
        body: JSON.stringify(payoutHoldRows),
        contentType: "application/json",
      });
    await payoutHoldObservation.measurement.dispose();
    await payoutHoldObservation.source.dispose();

    const payoutDisputeObservation = await command(
      "open_dispute",
      "PRIVATE dispute review",
    );
    await expect(page.getByText(p.open, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: p.title, exact: true }),
    ).toBeFocused();
    const payoutDisputeRows =
      await payoutDisputeObservation.measurement.evaluate((measurement) => {
        measurement.read("settled");
        measurement.observer.disconnect();
        return measurement.rows;
      });
    await test
      .info()
      .attach("focus-payoutDispute", {
        body: JSON.stringify(payoutDisputeRows),
        contentType: "application/json",
      });
    await payoutDisputeObservation.measurement.dispose();
    await payoutDisputeObservation.source.dispose();

    const resolution = page.getByRole("form", { name: p.resolve_dispute });
    await resolution.getByLabel(p.outcome).selectOption("owner_won");
    await resolution
      .getByLabel(p.reason, { exact: true })
      .fill("PRIVATE decision");
    const payoutResolveControl = resolution.getByRole("button", {
      name: p.resolve_dispute,
      exact: true,
    });
    await payoutResolveControl.focus();
    await expect(payoutResolveControl).toBeFocused();
    const payoutResolveSource = await payoutResolveControl.elementHandle();
    if (!payoutResolveSource)
      throw new Error("Focus measurement source is missing");
    const payoutResolveMeasurement = await payoutResolveSource.evaluateHandle(
      (source, labels) => {
        const rows: Record<string, string | boolean | null>[] = [];
        const read = (phase: string) =>
          rows.push({
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
          });
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
        return { read, observer, rows };
      },
      { family: "booking-management-controls", action: "resolve_dispute" },
    );
    await payoutResolveControl.press("Enter");
    await expect(page.getByText(p.resolved, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: p.title, exact: true }),
    ).toBeFocused();
    const payoutResolveRows = await payoutResolveMeasurement.evaluate(
      (measurement) => {
        measurement.read("settled");
        measurement.observer.disconnect();
        return measurement.rows;
      },
    );
    await test
      .info()
      .attach("focus-payoutResolve", {
        body: JSON.stringify(payoutResolveRows),
        contentType: "application/json",
      });
    await payoutResolveMeasurement.dispose();
    await payoutResolveSource.dispose();

    await expect(page.getByText(p.held, { exact: true })).toBeVisible();
    const payoutBlockedObservation = await command(
      "settle",
      "Held settlement check",
    );
    await expect(
      page.getByRole("form", { name: p.settle }).getByRole("alert"),
    ).toContainText(p.blocked);
    await expect(
      page.getByRole("form", { name: p.settle }).getByRole("button", {
        name: p.settle,
        exact: true,
      }),
    ).toBeFocused();
    const payoutBlockedRows =
      await payoutBlockedObservation.measurement.evaluate((measurement) => {
        measurement.read("settled");
        measurement.observer.disconnect();
        return measurement.rows;
      });
    await test
      .info()
      .attach("focus-payoutBlocked", {
        body: JSON.stringify(payoutBlockedRows),
        contentType: "application/json",
      });
    await payoutBlockedObservation.measurement.dispose();
    await payoutBlockedObservation.source.dispose();

    expect(
      harness.runSql(
        `select count(*) from public.payment_provider_operations where operation_kind='settlement'`,
      ),
    ).toBe("0");
    await assertResponsiveDetails(page, "platform_administrator");
    await page.goto(`/en/administrator/payments/${reference}`);
    const payoutReleaseObservation = await command(
      "release_hold",
      "PRIVATE review complete",
    );
    await expect(page.getByText(p.clear, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: p.title, exact: true }),
    ).toBeFocused();
    const payoutReleaseRows =
      await payoutReleaseObservation.measurement.evaluate((measurement) => {
        measurement.read("settled");
        measurement.observer.disconnect();
        return measurement.rows;
      });
    await test
      .info()
      .attach("focus-payoutRelease", {
        body: JSON.stringify(payoutReleaseRows),
        contentType: "application/json",
      });
    await payoutReleaseObservation.measurement.dispose();
    await payoutReleaseObservation.source.dispose();

    const payoutSettleObservation = await command(
      "settle",
      "PRIVATE settlement approval",
    );
    await expect(
      page
        .getByTestId("settlement-recovery")
        .locator("p")
        .filter({ hasText: payoutMessages.en.paidAmount }),
    ).toHaveText(`${payoutMessages.en.paidAmount}: IQD 99,000`);
    await expect(page.getByTestId("settlement-recovery")).toContainText(
      p.noDebit,
    );
    await expect(
      page.getByRole("heading", { name: p.title, exact: true }),
    ).toBeFocused();
    const payoutSettleRows = await payoutSettleObservation.measurement.evaluate(
      (measurement) => {
        measurement.read("settled");
        measurement.observer.disconnect();
        return measurement.rows;
      },
    );
    await test
      .info()
      .attach("focus-payoutSettle", {
        body: JSON.stringify(payoutSettleRows),
        contentType: "application/json",
      });
    await payoutSettleObservation.measurement.dispose();
    await payoutSettleObservation.source.dispose();

    const settlementViewport = page.viewportSize()!;
    const settlementObservations: {
      locale: string;
      viewport: string;
      values: string[][];
    }[] = [];
    for (const locale of ["en", "ar", "ckb"] as const) {
      await page.goto(`/${locale}/administrator/payments/${reference}`);
      const payout = page.getByRole("region", {
        name: payoutMessages[locale].title,
        exact: true,
      });
      await expect(
        payout.getByText(payoutMessages[locale].succeeded, { exact: true }),
      ).toBeVisible();
      const metadata = payout
        .locator(":scope > div")
        .first()
        .locator("p")
        .filter({ hasText: activeAdministratorId! });
      const captures = await captureMetadataViewports(
        page,
        payout,
        `settlement-${locale}`,
        async () => {
          await expect
            .poll(() =>
              metadata
                .locator(":scope > bdi")
                .nth(1)
                .evaluate((timestamp) => timestamp.getClientRects().length),
            )
            .toBe(1);
          return [await metadata.locator("bdi").allTextContents()];
        },
      );
      settlementObservations.push(
        ...captures.map((capture) => ({ locale, ...capture })),
      );
    }
    for (const observation of settlementObservations) {
      expect(
        observation.values,
        `${observation.locale} ${observation.viewport} settlement boundaries`,
      ).toEqual([[activeAdministratorId, expect.stringMatching(/\S.*[:：]/)]]);
    }
    await page.setViewportSize(settlementViewport);
    await page.goto(`/en/administrator/payments/${reference}`);
    await assertResponsiveDetails(page, "platform_administrator");
    const ownerContext = await browser.newContext({
      baseURL,
      viewport: page.viewportSize() ?? undefined,
    });
    try {
      await participant(ownerContext, owner, baseURL);
      const ownerPage = await ownerContext.newPage();
      await ownerPage.goto(`/en/bookings?workspace=owner`);
      const summary = ownerPage.getByRole("region", {
        name: earningsMessages.en.summaryTitle,
      });
      await expectAmount(summary, earningsMessages.en.paidTotal, "IQD 99,000");
      await expectAmount(summary, earningsMessages.en.expectedTotal, "IQD 0");
      await ownerPage.reload();
      await expectAmount(summary, earningsMessages.en.paidTotal, "IQD 99,000");
      await ownerPage.goto(`/en/owner/booking-requests/${reference}`);
      await expectAmount(
        ownerPage.getByRole("region", { name: earningsMessages.en.title }),
        earningsMessages.en.paid,
        "IQD 99,000",
      );
      await expect(
        ownerPage.getByText("PRIVATE payout review", { exact: true }),
      ).toHaveCount(0);
      await expect(
        ownerPage.getByRole("region", { name: p.title }),
      ).toHaveCount(0);
      await expect(ownerPage.getByTestId("settlement-recovery")).toHaveCount(0);
      await assertResponsiveDetails(ownerPage, "cottage_owner");
    } finally {
      await ownerContext.close();
    }
    const totals = administratorTotalsMessages.en;
    await page.goto("/en/administrator/totals");
    await expect(
      page.getByRole("heading", { name: totals.title, level: 1 }),
    ).toBeVisible();
    const bookingRow = (await findQueueRow(page)).locator(
      "xpath=ancestor::li[1]",
    );
    const money = bookingRow.locator("details");
    await money.getByText(totals.bookingMoney, { exact: true }).click();
    const figures = money.locator("dl").first();
    for (const [label, amount] of [
      [totals.bookingPrice, "IQD 110,000"],
      [totals.bookingServiceFees, "IQD 5,000"],
      [totals.customerTotal, "IQD 115,000"],
      [totals.commissionAtCapture, "IQD 11,000"],
      [totals.commissionAfterRefunds, "IQD 11,000"],
      [totals.ownerShareAtCapture, "IQD 99,000"],
      [totals.ownerShareAfterRefunds, "IQD 99,000"],
      [totals.paidPayouts, "IQD 99,000"],
      [totals.unpaidPayouts, "IQD 0"],
    ])
      await expect(
        figures
          .getByText(label, { exact: true })
          .locator("xpath=following-sibling::dd[1]"),
      ).toHaveText(amount);
    await bookingRow
      .getByRole("link", { name: reference, exact: true })
      .click();
    await expect(page).toHaveURL(`/en/administrator/payments/${reference}`);
    await expect(
      page.getByRole("region", { name: payoutMessages.en.title, exact: true }),
    ).toBeVisible();
    for (const locale of ["ar", "ckb"] as const) {
      await page.goto(`/${locale}/administrator/totals`);
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await expect(
        page.getByRole("heading", {
          name: administratorTotalsMessages[locale].title,
          level: 1,
        }),
      ).toBeVisible();
    }
  });
  test("customer cancels with the disclosed rule and returns through retained history", async ({
    page,
    baseURL,
  }) => {
    await participant(page.context(), customer, baseURL);
    await page.goto(`/en/booking-requests/${reference}`);
    await expect(
      page.getByRole("heading", { name: "Confirmed booking", exact: true }),
    ).toBeVisible();
    const bookingViewport = page.viewportSize()!;
    const periodLabels = {
      en: "Booking period",
      ar: "فترة الحجز",
      ckb: "ماوەی حجز",
    };
    const periodObservations: {
      locale: string;
      viewport: string;
      values: string[][];
    }[] = [];
    for (const locale of ["en", "ar", "ckb"] as const) {
      await page.goto(`/${locale}/booking-requests/${reference}`);
      const confirmed = page.getByRole("region", {
        name: bookingLifecycleMessages[locale].confirmed,
        exact: true,
      });
      await expect(confirmed).toContainText(browserQuote.cottageName);
      await expect(confirmed).toHaveCSS("border-top-style", "solid");
      const period = confirmed.locator("dl > div").filter({
        has: page.getByText(periodLabels[locale], { exact: true }),
      });
      const captures = await captureMetadataViewports(
        page,
        confirmed,
        `confirmed-booking-${locale}`,
        async () => {
          await expect
            .poll(() =>
              period.locator("dd > span").evaluateAll((entries) =>
                entries.flatMap((entry) =>
                  Array.from(entry.querySelectorAll(":scope > bdi"))
                    .slice(1)
                    .map((timestamp) => timestamp.getClientRects().length),
                ),
              ),
            )
            .toEqual([1, 1, 1, 1, 1, 1]);
          return period
            .locator("dd > span")
            .evaluateAll((entries) =>
              entries.map((entry) =>
                Array.from(
                  entry.querySelectorAll(":scope > bdi"),
                  (value) => value.textContent ?? "",
                ),
              ),
            );
        },
      );
      periodObservations.push(
        ...captures.map((capture) => ({ locale, ...capture })),
      );
    }
    for (const observation of periodObservations) {
      expect(
        observation.values,
        `${observation.locale} ${observation.viewport} booking period boundaries`,
      ).toEqual(
        ["Morning", "Night", "Full day"].map((name) => [
          name,
          expect.stringMatching(/\S.*[:：]/),
          expect.stringMatching(/\S.*[:：]/),
        ]),
      );
    }
    await page.setViewportSize(bookingViewport);
    await page.goto(`/en/booking-requests/${reference}`);
    const form = page.getByRole("form", { name: messages.en.cancel });
    await expect(form).toContainText("48 hours");
    await form.getByRole("checkbox").focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("Tab");
    const cancelCustomerControl = form.getByRole("button", {
      name: messages.en.cancel,
      exact: true,
    });
    await cancelCustomerControl.focus();
    await expect(cancelCustomerControl).toBeFocused();
    const cancelCustomerSource = await cancelCustomerControl.elementHandle();
    if (!cancelCustomerSource)
      throw new Error("Focus measurement source is missing");
    const cancelCustomerMeasurement = await cancelCustomerSource.evaluateHandle(
      (source, labels) => {
        const rows: Record<string, string | boolean | null>[] = [];
        const read = (phase: string) =>
          rows.push({
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
          });
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
        return { read, observer, rows };
      },
      { family: "booking-management-controls", action: "Customer cancel" },
    );
    await cancelCustomerControl.press("Enter");
    await expect(
      page.getByRole("heading", { name: "Cancelled booking", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: messages.en.cancelled, exact: true }),
    ).toBeFocused();
    const cancelCustomerRows = await cancelCustomerMeasurement.evaluate(
      (measurement) => {
        measurement.read("settled");
        measurement.observer.disconnect();
        return measurement.rows;
      },
    );
    await test
      .info()
      .attach("focus-cancelCustomer", {
        body: JSON.stringify(cancelCustomerRows),
        contentType: "application/json",
      });
    await cancelCustomerMeasurement.dispose();
    await cancelCustomerSource.dispose();

    await expect(
      page.getByRole("heading", { name: "Full refund required", exact: true }),
    ).toBeVisible();
    await expectAmount(
      page.getByTestId("verified-refund"),
      messages.en.total,
      "IQD 0",
    );
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
    await expect(
      page.getByRole("listitem").filter({ has: retainedBooking }),
    ).toContainText("Cancelled booking");
    await expect(retainedBooking).toHaveAttribute(
      "href",
      `/en/booking-requests/${reference}`,
    );
    await retainedBooking.click();
    await expect(
      page.getByRole("heading", { name: "Cancelled booking", exact: true }),
    ).toBeVisible();
    await assertResponsiveDetails(page, "customer");
    expect((await triggerScheduled(baseURL, "/__scheduled")).ok).toBe(true);
    await page.goto(`/en/booking-requests/${reference}`);
    await expectAmount(
      page.getByTestId("verified-refund"),
      messages.en.total,
      "IQD 115,000",
    );
    await expect(
      page.getByText("Private address", { exact: true }),
    ).toHaveCount(0);
  });
  test("owner must supply a reason and retains the no-payout cancellation outcome", async ({
    page,
    baseURL,
  }) => {
    await participant(page.context(), owner, baseURL);
    await page.goto(`/ar/owner/booking-requests/${reference}`);
    const form = page.getByRole("form", { name: messages.ar.cancel });
    await form.getByRole("checkbox").check();
    await form
      .getByRole("button", { name: messages.ar.cancel, exact: true })
      .click();
    await expect(form.getByRole("textbox")).toBeFocused();
    await form.getByRole("textbox").fill("PRIVATE owner operational reason");
    const cancelOwnerControl = form.getByRole("button", {
      name: messages.ar.cancel,
      exact: true,
    });
    await cancelOwnerControl.focus();
    await expect(cancelOwnerControl).toBeFocused();
    const cancelOwnerSource = await cancelOwnerControl.elementHandle();
    if (!cancelOwnerSource)
      throw new Error("Focus measurement source is missing");
    const cancelOwnerMeasurement = await cancelOwnerSource.evaluateHandle(
      (source, labels) => {
        const rows: Record<string, string | boolean | null>[] = [];
        const read = (phase: string) =>
          rows.push({
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
          });
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
        return { read, observer, rows };
      },
      { family: "booking-management-controls", action: "Owner cancel Arabic" },
    );
    await cancelOwnerControl.press("Enter");
    await expect(
      page.getByRole("heading", { name: messages.ar.cancelled, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: messages.ar.cancelled, exact: true }),
    ).toBeFocused();
    const cancelOwnerRows = await cancelOwnerMeasurement.evaluate(
      (measurement) => {
        measurement.read("settled");
        measurement.observer.disconnect();
        return measurement.rows;
      },
    );
    await test
      .info()
      .attach("focus-cancelOwner", {
        body: JSON.stringify(cancelOwnerRows),
        contentType: "application/json",
      });
    await cancelOwnerMeasurement.dispose();
    await cancelOwnerSource.dispose();

    await expect(
      page.getByText(messages.ar.noPayout, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("PRIVATE owner operational reason", { exact: true }),
    ).toHaveCount(0);
    await assertResponsiveDetails(page, "cottage_owner");
  });
  test("administrator approves exact partial exceptions then cancels with a privileged reason", async ({
    page,
    browser,
    baseURL,
  }) => {
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
      const exceptionFirstControl = form.getByRole("button", {
        name: messages.en.approve,
      });
      await exceptionFirstControl.focus();
      await expect(exceptionFirstControl).toBeFocused();
      const exceptionFirstSource = await exceptionFirstControl.elementHandle();
      if (!exceptionFirstSource)
        throw new Error("Focus measurement source is missing");
      const exceptionFirstMeasurement =
        await exceptionFirstSource.evaluateHandle(
          (source, labels) => {
            const rows: Record<string, string | boolean | null>[] = [];
            const read = (phase: string) =>
              rows.push({
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
              });
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
            return { read, observer, rows };
          },
          {
            family: "booking-management-controls",
            action: "Approve price and fee exception",
          },
        );
      await exceptionFirstControl.press("Enter");
      await expectAmount(
        page.getByRole("list", { name: messages.en.approved }),
        messages.en.total,
        "IQD 20,000.001",
      );
      await expect(form.locator('input[name="commandId"]')).not.toHaveValue(
        initialId,
      );
      await expect(form.getByLabel(messages.en.reason)).toHaveValue("");
      await expect(
        page.getByRole("heading", { name: messages.en.title, exact: true }),
      ).toBeFocused();
      const exceptionFirstRows = await exceptionFirstMeasurement.evaluate(
        (measurement) => {
          measurement.read("settled");
          measurement.observer.disconnect();
          return measurement.rows;
        },
      );
      await test
        .info()
        .attach("focus-exceptionFirst", {
          body: JSON.stringify(exceptionFirstRows),
          contentType: "application/json",
        });
      await exceptionFirstMeasurement.dispose();
      await exceptionFirstSource.dispose();

      await participant(ownerContext, owner, baseURL);
      const ownerPage = await ownerContext.newPage();
      await ownerPage.goto(`${baseURL}/en/owner/booking-requests/${reference}`);
      await expectAmount(
        ownerPage.getByRole("region", { name: earningsMessages.en.title }),
        earningsMessages.en.currentNet,
        "IQD 99,000",
      );
      await expect(
        ownerPage.getByText(earningsMessages.en.causes["refund-pending"], {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        ownerPage.getByText("PRIVATE first compensation", { exact: true }),
      ).toHaveCount(0);
      expect((await triggerScheduled(baseURL, "/__scheduled")).ok).toBe(true);
      await ownerPage.reload();
      await expectAmount(
        ownerPage.getByRole("region", { name: earningsMessages.en.title }),
        earningsMessages.en.currentNet,
        "IQD 81,000",
      );
      await expectAmount(
        ownerPage.getByTestId("verified-refund"),
        messages.en.total,
        "IQD 20,000.001",
      );
      await assertResponsiveDetails(ownerPage, "cottage_owner");
      await page.reload();
      form = page.getByRole("form", { name: messages.en.exception });
      await form
        .getByLabel(messages.en.reason)
        .fill("PRIVATE fee-only compensation");
      await form.getByLabel(messages.en.feeInput).fill("0.002");
      const exceptionFeeControl = form.getByRole("button", {
        name: messages.en.approve,
      });
      await exceptionFeeControl.focus();
      await expect(exceptionFeeControl).toBeFocused();
      const exceptionFeeSource = await exceptionFeeControl.elementHandle();
      if (!exceptionFeeSource)
        throw new Error("Focus measurement source is missing");
      const exceptionFeeMeasurement = await exceptionFeeSource.evaluateHandle(
        (source, labels) => {
          const rows: Record<string, string | boolean | null>[] = [];
          const read = (phase: string) =>
            rows.push({
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
            });
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
          return { read, observer, rows };
        },
        {
          family: "booking-management-controls",
          action: "Approve fee-only exception",
        },
      );
      await exceptionFeeControl.press("Enter");
      await expect(
        page.getByRole("list", { name: messages.en.approved }).locator("li"),
      ).toHaveCount(2);
      await expect(
        page.getByRole("heading", { name: messages.en.title, exact: true }),
      ).toBeFocused();
      const exceptionFeeRows = await exceptionFeeMeasurement.evaluate(
        (measurement) => {
          measurement.read("settled");
          measurement.observer.disconnect();
          return measurement.rows;
        },
      );
      await test
        .info()
        .attach("focus-exceptionFee", {
          body: JSON.stringify(exceptionFeeRows),
          contentType: "application/json",
        });
      await exceptionFeeMeasurement.dispose();
      await exceptionFeeSource.dispose();

      expect((await triggerScheduled(baseURL, "/__scheduled")).ok).toBe(true);
      await ownerPage.goto(`${baseURL}/en/owner/booking-requests/${reference}`);
      await expectAmount(
        ownerPage.getByRole("region", { name: earningsMessages.en.title }),
        earningsMessages.en.currentNet,
        "IQD 81,000",
      );
      await expectAmount(
        ownerPage.getByTestId("verified-refund"),
        messages.en.total,
        "IQD 20,000.003",
      );
      await page.goto(`/ckb/administrator/payments/${reference}`);
      const cancel = page.getByRole("form", { name: messages.ckb.cancel });
      await cancel.getByLabel(messages.ckb.category).selectOption("safety");
      await cancel
        .getByLabel(messages.ckb.reason, { exact: true })
        .fill("PRIVATE administrator safety reason");
      await cancel.getByRole("checkbox").check();
      const cancelAdministratorControl = cancel.getByRole("button", {
        name: messages.ckb.cancel,
        exact: true,
      });
      await cancelAdministratorControl.focus();
      await expect(cancelAdministratorControl).toBeFocused();
      const cancelAdministratorSource =
        await cancelAdministratorControl.elementHandle();
      if (!cancelAdministratorSource)
        throw new Error("Focus measurement source is missing");
      const cancelAdministratorMeasurement =
        await cancelAdministratorSource.evaluateHandle(
          (source, labels) => {
            const rows: Record<string, string | boolean | null>[] = [];
            const read = (phase: string) =>
              rows.push({
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
              });
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
            return { read, observer, rows };
          },
          {
            family: "booking-management-controls",
            action: "Administrator privileged cancel Sorani",
          },
        );
      await cancelAdministratorControl.press("Enter");
      await expect(
        page.getByRole("heading", {
          name: messages.ckb.cancelled,
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: messages.ckb.cancelled, exact: true }),
      ).toBeFocused();
      const cancelAdministratorRows =
        await cancelAdministratorMeasurement.evaluate((measurement) => {
          measurement.read("settled");
          measurement.observer.disconnect();
          return measurement.rows;
        });
      await test
        .info()
        .attach("focus-cancelAdministrator", {
          body: JSON.stringify(cancelAdministratorRows),
          contentType: "application/json",
        });
      await cancelAdministratorMeasurement.dispose();
      await cancelAdministratorSource.dispose();

      await expect(
        page.getByText(messages.ckb.noPayout, { exact: true }),
      ).toBeVisible();
      await assertResponsiveDetails(page, "platform_administrator");
      await ownerPage.goto(`${baseURL}/en/owner/booking-requests/${reference}`);
      await expect(
        ownerPage.getByText("PRIVATE administrator safety reason", {
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(
        ownerPage.getByText("Private address", { exact: true }),
      ).toHaveCount(0);
      const queues = administratorQueuesMessages.en;
      const expectRow = async (label: string, locale: Locale = "en") =>
        expect(
          page
            .getByRole("listitem")
            .filter({ has: await findQueueRow(page, locale) })
            .filter({ hasText: label })
            .first(),
        ).toBeVisible();
      await page.goto("/en/administrator/queues?queue=bookings");
      await expectRow(bookingLifecycleMessages.en.cancelled);
      await expect(page.locator("body")).not.toContainText("PRIVATE");
      await page
        .getByLabel(administratorRecordsMessages.en.status)
        .selectOption("cancelled");
      await page
        .getByLabel(administratorRecordsMessages.en.from)
        .fill(baghdadDate(Date.now() - 86_400_000));
      await page
        .getByLabel(administratorRecordsMessages.en.through)
        .fill(baghdadDate(Date.now()));
      await page.getByRole("button", { name: queues.apply }).click();
      await expect(page).toHaveURL(/state=cancelled/);
      await expect(page).toHaveURL(/from=\d{4}-\d{2}-\d{2}/);
      await expect(page).toHaveURL(/through=\d{4}-\d{2}-\d{2}/);
      await expectRow(bookingLifecycleMessages.en.cancelled);
      await captureQueueFilters(page, "en", "queues-bookings-filtered");
      await page.goto("/en/administrator/queues?queue=refunds");
      await expectRow(messages.en.approved);
      await expect(page.locator("body")).not.toContainText("PRIVATE");
      await page.goto("/en/administrator/queues?queue=incidents");
      await expectRow(bookingLifecycleMessages.en.cancellationSource);
      await expect(page.locator("body")).not.toContainText("PRIVATE");
      for (const locale of ["ar", "ckb"] as const) {
        await page.goto(`/${locale}/administrator/queues?queue=bookings`);
        await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
        await expect(
          page.getByRole("heading", {
            name: administratorQueuesMessages[locale].title,
            level: 1,
          }),
        ).toBeVisible();
        await page
          .getByLabel(administratorRecordsMessages[locale].status)
          .selectOption("cancelled");
        await page
          .getByRole("button", {
            name: administratorQueuesMessages[locale].apply,
            exact: true,
          })
          .click();
        await expect(page).toHaveURL(/state=cancelled/);
        await expectRow(bookingLifecycleMessages[locale].cancelled, locale);
        await captureQueueFilters(page, locale, "queues-bookings-filtered");
      }
      await page.goto("/en/administrator/queues?queue=incidents");
      await (await findQueueRow(page)).click();
      await expect(page).toHaveURL(
        new RegExp(`/en/administrator/payments/${reference}$`),
      );
      await expect(
        page.getByRole("heading", {
          name: administratorPaymentHistoryMessages.en.title,
        }),
      ).toBeVisible();
    } finally {
      await ownerContext.close();
    }
  });
});
