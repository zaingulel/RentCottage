import { observeRecordHeading } from "./fixtures/record-heading";
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
import { writeFile } from "node:fs/promises";
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
import { administratorBookingMoneyExportMessages } from "../src/i18n/administrator-booking-money-export-messages";
import { administratorTotalsMessages } from "../src/i18n/administrator-totals-messages";
import { bookingManagementMessages as messages } from "../src/i18n/booking-management-messages";
import { accessMessages } from "../src/i18n/access-messages";
import { bookingLifecycleMessages } from "../src/i18n/booking-lifecycle-messages";
import { ownerBookingEarningsMessages as earningsMessages } from "../src/i18n/owner-booking-earnings-messages";
import { ownerBookingEarnings } from "../src/booking-request/owner-booking-earnings";
import { messagingMessages } from "../src/i18n/messaging-messages";
import { customerReviewMessages } from "../src/i18n/customer-review-messages";
import { formatInteger } from "../src/i18n/format";
import type { Locale } from "../src/i18n/routing";
const { createLocalSupabaseConcurrencyHarness } = createRequire(
  import.meta.url,
)("../scripts/local-supabase-concurrency-harness.mjs") as {
  createLocalSupabaseConcurrencyHarness(): {
    guardDisposableLocalDatabase(): void;
    runSql(sql: string): string;
  };
};
const {
  confirmedBookingCleanup,
  browserBookingFixtureIdentity,
  bookingFixtureSource,
} = createRequire(import.meta.url)("../scripts/lib/booking-fixture.mjs") as {
  browserBookingFixtureIdentity(
    file: string,
    project: string,
  ): Record<
    | "stem"
    | "profile"
    | "attempt"
    | "owner"
    | "customer"
    | "third"
    | "administrator"
    | "request"
    | "reference"
    | "ownerPhone"
    | "customerPhone"
    | "thirdPhone"
    | "captureFingerprint",
    string
  >;
  bookingFixtureSource(
    source: string,
    options: { start?: string; end: string; required?: string[] },
  ): string;
  confirmedBookingCleanup(options?: {
    stem?: string;
    administrator?: string;
    exportAdministrator?: string | null;
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
let identity: ReturnType<typeof browserBookingFixtureIdentity>;
let request: string, reference: string, owner: string, customer: string;
const source = readFileSync(
  "supabase/tests/database/booking_cancellation.test.sql",
  "utf8",
);
const browserQuote = {
  cottageName: "Fictional Preserved Cottage",
  houseRules: "Fictional preserved house rules",
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
const fixtureSource = bookingFixtureSource(source, {
  end: "-- END CANCELLATION FIXTURE",
  required: [
    "00000000100",
    "964750000100",
    "CONFIRMATION-HOLD-1",
    "Confirmation Cottage",
    "Karrada",
    "Private address",
    "Fixture description",
    "Fixture rules",
    "confirmation-auth-",
    "10000000-0000-4000-8000-000000003801",
    "cancellation-admin@example.test",
    "RC-REQ-0000000000001001",
    "6f86ac037886a0823766736c1c1ffb409cd9c98be93f038e0cfe5219c2a4a99d",
  ],
});
const fixture = () =>
  fixtureSource
    .replaceAll("00000000100", `00000000${identity.stem}`)
    .replaceAll("964750000100", `964750000${identity.stem}`)
    .replaceAll("confirmation-auth-", `confirmation-auth-${identity.stem}-`)
    .replaceAll("CONFIRMATION-HOLD-1", `CANCELLATION-HOLD-${identity.stem}`)
    .replaceAll(
      "Confirmation Cottage",
      `Fictional cancellation ${identity.stem} Cottage`,
    )
    .replaceAll("Karrada", "Fictional approximate area")
    .replaceAll("Private address", "Fictional private address")
    .replaceAll("Fixture description", "Fictional cottage description")
    .replaceAll("Fixture rules", "Fictional cottage rules")
    .replaceAll("10000000-0000-4000-8000-000000003801", identity.administrator)
    .replaceAll(
      "cancellation-admin@example.test",
      `cancellation-${identity.stem}@example.test`,
    )
    .replaceAll(
      "6f86ac037886a0823766736c1c1ffb409cd9c98be93f038e0cfe5219c2a4a99d",
      identity.captureFingerprint,
    )
    .replace(
      /insert into auth.users \(id, aud, role, phone, phone_confirmed_at\) values[\s\S]*?;/,
      "",
    )
    .replace(
      /'\{"cottageName":"Preserved Cottage"[^\n]+?'::jsonb/g,
      `'${JSON.stringify(browserQuote)}'::jsonb`,
    );
let activeAdministratorId: string | null = null;

const connectedStaySql = () => `select jsonb_build_object(
  'requests',(select jsonb_agg(jsonb_build_object('id',r.id,'customer',r.customer_user_id,'owner',r.owner_user_id,'profile',r.profile_id)) from public.booking_requests r where r.id='${request}'),
  'snapshots',(select jsonb_agg(to_jsonb(s)) from public.booking_snapshots s join public.booking_requests r on r.booking_snapshot_id=s.id where r.id='${request}'),
  'ranges',(select jsonb_agg(c.access_ranges::text) from public.cottage_booking_period_commitments c join public.booking_requests r on r.booking_period_commitment_id=c.id where r.id='${request}'),
  'captures',(select jsonb_agg(to_jsonb(o)) from public.payment_provider_operations o join public.booking_confirmations c on c.capture_operation_id=o.id where c.booking_request_id='${request}'),
  'attempts',(select jsonb_agg(jsonb_build_object('id',a.id,'request',a.booking_request_id,'conversation',a.conversation_id)) from public.booking_request_submission_attempts a where a.booking_request_id='${request}'),
  'links',(select coalesce(jsonb_agg(to_jsonb(l)),'[]'::jsonb) from public.messaging_conversation_booking_requests l where l.booking_request_id='${request}'),
  'conversations',(select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) from public.messaging_conversations c where c.id in (select l.conversation_id from public.messaging_conversation_booking_requests l where l.booking_request_id='${request}')),
  'messages',(select coalesce(jsonb_agg(to_jsonb(m) order by m.position),'[]'::jsonb) from public.messaging_messages m where m.conversation_id in (select l.conversation_id from public.messaging_conversation_booking_requests l where l.booking_request_id='${request}')),
  'refunds',(select coalesce(jsonb_agg(to_jsonb(o) order by o.id),'[]'::jsonb) from public.payment_provider_operations o where o.operation_kind='refund' and o.claim_id in (select c.id from public.booking_request_authorization_claims c join public.booking_request_submission_attempts a on a.id=c.attempt_id where a.booking_request_id='${request}')),
  'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by e.operation_id),'[]'::jsonb) from public.simulated_payment_effects e join public.payment_provider_operations o on o.id=e.operation_id where o.operation_kind='refund' and o.claim_id in (select c.id from public.booking_request_authorization_claims c join public.booking_request_submission_attempts a on a.id=c.attempt_id where a.booking_request_id='${request}')),
  'deliveredNotices',(select count(*) from public.booking_confirmation_notification_work w where w.booking_request_id='${request}' and w.state='delivered'),
  'notificationEffects',(select count(*) from public.fictional_booking_confirmation_notification_effects e where e.booking_request_id='${request}')
);`;
const observeConnectedStay = () =>
  JSON.parse(harness.runSql(connectedStaySql()));

const clear = () => {
  const exportAdministrator = activeAdministratorId;
  const cleanup = confirmedBookingCleanup({
    stem: identity.stem,
    administrator: identity.administrator,
    exportAdministrator,
    completion: true,
    settlement: true,
  });
  harness.guardDisposableLocalDatabase();
  const conversations = harness.runSql(
    `select coalesce(jsonb_agg(l.conversation_id),'[]'::jsonb) from public.messaging_conversation_booking_requests l where l.booking_request_id='${request}';`,
  );
  harness.runSql(
    `delete from auth.sessions where user_id in ('${owner}','${customer}','${identity.third}');delete from auth.identities where user_id in ('${owner}','${customer}','${identity.third}');${cleanup}`,
  );
  expect(
    JSON.parse(
      harness.runSql(`with owned as (select value::uuid id from jsonb_array_elements_text('${conversations}'::jsonb)) select jsonb_build_object(
    'requests',(select count(*) from public.booking_requests r where r.id='${request}'),
    'links',(select count(*) from public.messaging_conversation_booking_requests l where l.booking_request_id='${request}' or l.conversation_id in (select id from owned)),
    'conversations',(select count(*) from public.messaging_conversations c where c.id in (select id from owned)),
    'messages',(select count(*) from public.messaging_messages m where m.conversation_id in (select id from owned)),
    'exportAudits',(select count(*) from private.administrator_booking_money_exports where administrator_user_id='${identity.administrator}' or administrator_user_id=${exportAdministrator ? `'${exportAdministrator}'::uuid` : "null::uuid"}),
    'sendAttempts',(select count(*) from public.messaging_send_attempts a where a.conversation_id in (select id from owned))
  );`),
    ),
  ).toEqual({
    requests: 0,
    links: 0,
    conversations: 0,
    messages: 0,
    sendAttempts: 0,
    exportAudits: 0,
  });
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
    phone: userId === owner ? identity.ownerPhone : identity.customerPhone,
    password,
  });
  if (error) throw error;
  const named = await client.rpc("save_account_name", {
    account_first_name: userId === owner ? "Avan" : "Lana",
  });
  if (named.error) throw named.error;
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
  harness.runSql(
    `insert into public.account_names (user_id, first_name) values ('${data.user.id}', 'Sara') on conflict (user_id) do update set first_name = excluded.first_name;`,
  );
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
  role: "cottage_owner" | "platform_administrator",
) {
  for (const locale of ["en", "ar", "ckb"] as const) {
    const route =
      role === "cottage_owner"
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
  test.beforeEach(async ({}, testInfo) => {
    identity = browserBookingFixtureIdentity(
      "cancellation",
      testInfo.project.name,
    );
    ({ request, reference, owner, customer } = identity);
    clear();
    const { admin } = connection();
    for (const [id, phone] of [
      [owner, identity.ownerPhone],
      [customer, identity.customerPhone],
      [identity.third, identity.thirdPhone],
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
    const datedFixture = fixture().replace(
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
  }, testInfo) => {
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
      await payoutCommandControl.press("Enter");
    };
    await command("place_hold", "PRIVATE payout review");
    await expect(page.getByText(p.held, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: p.title, exact: true }),
    ).toBeFocused();

    await command("open_dispute", "PRIVATE dispute review");
    await expect(page.getByText(p.open, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: p.title, exact: true }),
    ).toBeFocused();

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
    await payoutResolveControl.press("Enter");
    await expect(page.getByText(p.resolved, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: p.title, exact: true }),
    ).toBeFocused();

    await expect(page.getByText(p.held, { exact: true })).toBeVisible();
    await command("settle", "Held settlement check");
    await expect(
      page.getByRole("form", { name: p.settle }).getByRole("alert"),
    ).toContainText(p.blocked);
    await expect(
      page.getByRole("form", { name: p.settle }).getByRole("button", {
        name: p.settle,
        exact: true,
      }),
    ).toBeFocused();

    expect(
      harness.runSql(
        `select count(*) from public.payment_provider_operations where operation_kind='settlement'`,
      ),
    ).toBe("0");
    await assertResponsiveDetails(page, "platform_administrator");
    await page.goto(`/en/administrator/payments/${reference}`);
    await command("release_hold", "PRIVATE review complete");
    await expect(page.getByText(p.clear, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: p.title, exact: true }),
    ).toBeFocused();

    await command("settle", "PRIVATE settlement approval");
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
      await ownerPage.goto(`/en/owner/earnings`);
      const summary = ownerPage.getByRole("region", {
        name: earningsMessages.en.summaryTitle,
      });
      await expectAmount(summary, earningsMessages.en.paidTotal, "IQD 99,000");
      await expectAmount(summary, earningsMessages.en.expectedTotal, "IQD 0");
      await ownerPage.reload();
      await expectAmount(summary, earningsMessages.en.paidTotal, "IQD 99,000");
      const earningsViewport = ownerPage.viewportSize();
      if (!earningsViewport)
        throw new Error("Earnings capture requires a configured viewport");
      const earningsMeasurements = [];
      for (const locale of ["en", "ar"] as const) {
        for (const [view, viewport] of [
          ["desktop", { width: 1440, height: 1000 }],
          ["phone", { width: 390, height: 844 }],
        ] as const) {
          await ownerPage.setViewportSize(viewport);
          await ownerPage.goto(`/${locale}/bookings?workspace=owner`);
          await expect(
            ownerPage.getByRole("heading", {
              level: 1,
              name: accessMessages[locale].ownerBookings,
            }),
          ).toBeVisible();
          const navigation = ownerPage
            .getByRole("navigation")
            .filter({ has: ownerPage.locator(".backoffice-navigation-links") });
          const bookings = navigation.getByRole("link", {
            name: accessMessages[locale].ownerBookingsTab,
            exact: false,
          });
          await expect(bookings).toHaveAttribute(
            "href",
            `/${locale}/bookings?workspace=owner`,
          );
          const earnings = navigation.getByRole("link", {
            name: accessMessages[locale].ownerEarningsTab,
            exact: true,
          });
          await expect(bookings).toHaveAttribute("aria-current", "page");
          await bookings.focus();
          await ownerPage.keyboard.press("Tab");
          await expect(earnings).toBeFocused();
          const measureFocus = () =>
            earnings.evaluate((tab) => {
              const row = tab.parentElement!;
              const box = tab.getBoundingClientRect();
              const rowBox = row.getBoundingClientRect();
              const style = getComputedStyle(tab);
              const rowStyle = getComputedStyle(row);
              const extent =
                parseFloat(style.outlineWidth) +
                parseFloat(style.outlineOffset);
              return {
                visible:
                  tab.matches(":focus-visible") &&
                  style.outlineStyle === "solid" &&
                  parseFloat(style.outlineWidth) >= 2,
                contained:
                  box.left - extent >= Math.max(0, rowBox.left) &&
                  box.right + extent <= Math.min(innerWidth, rowBox.right) &&
                  box.top - extent >= rowBox.top &&
                  box.bottom + extent <= rowBox.bottom,
                target: box.width >= 24 && box.height >= 24,
                scrollsInRow: rowStyle.overflowX === "auto",
              };
            });
          await expect.poll(measureFocus).toEqual({
            visible: true,
            contained: true,
            target: true,
            scrollsInRow: true,
          });
          const focus = await earnings.evaluate((tab) => {
            const style = getComputedStyle(tab);
            const row = tab.parentElement!;
            const backgrounds = [];
            for (
              let element: Element | null = tab;
              element;
              element = element.parentElement
            ) {
              const background = getComputedStyle(element);
              backgrounds.push({
                tag: element.tagName,
                className: element.className,
                color: background.backgroundColor,
                image: background.backgroundImage,
                borderImage: background.borderImageSource,
              });
            }
            return {
              rectangle: tab.getBoundingClientRect().toJSON(),
              row: row.getBoundingClientRect().toJSON(),
              scrollWidth: row.scrollWidth,
              clientWidth: row.clientWidth,
              scrollLeft: row.scrollLeft,
              direction: style.direction,
              color: style.color,
              background: style.backgroundColor,
              outlineColor: style.outlineColor,
              outlineWidth: style.outlineWidth,
              outlineOffset: style.outlineOffset,
              outlineStyle: style.outlineStyle,
              boxShadow: style.boxShadow,
              backgrounds,
            };
          });
          await ownerPage.keyboard.press("Enter");
          await expect(ownerPage).toHaveURL(
            new RegExp(`/${locale}/owner/earnings$`),
          );
          const title = ownerPage.getByRole("heading", {
            level: 1,
            name: accessMessages[locale].ownerEarningsTab,
          });
          await expect(title).toBeVisible();
          await expect(earnings).toHaveAttribute("aria-current", "page");
          await expect(bookings).not.toHaveAttribute("aria-current");
          await ownerPage.evaluate(async () => {
            await document.fonts.ready;
          });
          const measureLayout = () =>
            ownerPage.locator("main").evaluate((main, rtl) => {
              const heading = main.querySelector("h1")!;
              const section = main.querySelector(".owner-earnings")!;
              const titleBox = heading.getBoundingClientRect();
              const sectionBox = section.getBoundingClientRect();
              const edge = rtl ? "right" : "left";
              const blocks = Array.from(
                section.querySelectorAll("h2, h3, p, dt, dd, a"),
              );
              return {
                direction: getComputedStyle(main).direction,
                startAligned: Math.abs(titleBox[edge] - sectionBox[edge]) < 1,
                wraps: blocks.every(
                  (block) => block.scrollWidth <= block.clientWidth + 1,
                ),
                overflow: document.documentElement.scrollWidth > innerWidth + 1,
              };
            }, locale === "ar");
          await expect.poll(measureLayout).toEqual({
            direction: locale === "ar" ? "rtl" : "ltr",
            startAligned: true,
            wraps: true,
            overflow: false,
          });
          const layout = await measureLayout();
          const current = await earnings.evaluate((tab) => {
            const style = getComputedStyle(tab);
            const row = tab.parentElement!;
            return {
              rectangle: tab.getBoundingClientRect().toJSON(),
              row: row.getBoundingClientRect().toJSON(),
              scrollWidth: row.scrollWidth,
              clientWidth: row.clientWidth,
              scrollLeft: row.scrollLeft,
              current: tab.getAttribute("aria-current"),
              color: style.color,
              background: style.backgroundColor,
              indicatorColor: style.borderBlockEndColor,
              indicatorWidth: style.borderBlockEndWidth,
              indicatorStyle: style.borderBlockEndStyle,
            };
          });
          expect(current.indicatorStyle).toBe("solid");
          expect(parseFloat(current.indicatorWidth)).toBeGreaterThanOrEqual(2);
          expect(current.indicatorColor).not.toBe("rgba(0, 0, 0, 0)");
          expect(current.rectangle.left).toBeGreaterThanOrEqual(
            Math.max(0, current.row.left),
          );
          expect(current.rectangle.right).toBeLessThanOrEqual(
            Math.min(viewport.width, current.row.right),
          );
          earningsMeasurements.push({
            locale,
            view,
            viewport,
            focus,
            current,
            layout,
          });
          await title.click();
          await expect(earnings).not.toBeFocused();
          const imageName = `owner-earnings-${locale}-${view}.png`;
          const imagePath = testInfo.outputPath(imageName);
          await ownerPage.screenshot({
            path: imagePath,
            fullPage: true,
            scale: "css",
          });
          await testInfo.attach(imageName, {
            path: imagePath,
            contentType: "image/png",
          });
        }
      }
      const earningsMeasurementsPath = testInfo.outputPath(
        "owner-earnings-measurements.json",
      );
      await writeFile(
        earningsMeasurementsPath,
        JSON.stringify(earningsMeasurements, null, 2),
      );
      await testInfo.attach("owner-earnings-measurements", {
        path: earningsMeasurementsPath,
        contentType: "application/json",
      });
      await ownerPage.setViewportSize(earningsViewport);
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
    for (const [locale, viewport] of [
      ["en", { width: 1440, height: 1000 }],
      ["ar", { width: 390, height: 844 }],
      ["ckb", { width: 320, height: 844 }],
    ] as const) {
      const copy = administratorTotalsMessages[locale];
      const direction = locale === "en" ? "ltr" : "rtl";
      await page.setViewportSize(viewport);
      await page.goto(`/${locale}/administrator/totals`);
      await expect(page.locator("html")).toHaveAttribute("dir", direction);
      await expect(
        page.getByRole("heading", { name: copy.title, level: 1 }),
      ).toBeVisible();
      const count = page.getByText(`${copy.bookingCount}:`);
      await expect(count).toBeVisible();
      await expect(count.locator("strong")).toHaveText(/\S/);
      const countText = await count.locator("strong").innerText();
      await expect(count).toHaveText(`${copy.bookingCount}: ${countText}`);
      const apply = page.getByRole("button", { name: copy.apply, exact: true });
      await expect(apply).toBeVisible();
      await page
        .getByRole("link", {
          name: administratorRecordsMessages[locale].reset,
          exact: true,
        })
        .focus();
      await page.keyboard.press("Shift+Tab");
      await expect(apply).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(
        `/${locale}/administrator/totals?state=&from=&through=`,
      );
      await expect(count).toBeVisible();
      await expect(count).toHaveText(`${copy.bookingCount}: ${countText}`);
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      await expect
        .poll(() =>
          count.evaluate((paragraph) => {
            const box = paragraph.getBoundingClientRect();
            return {
              noOverflow: document.documentElement.scrollWidth <= innerWidth,
              contained: box.left >= 0 && box.right <= innerWidth,
            };
          }),
        )
        .toEqual({ noOverflow: true, contained: true });
      const exporting = administratorBookingMoneyExportMessages[locale];
      if (
        locale === "en" &&
        (await page
          .getByRole("button", { name: exporting.export, exact: true })
          .count()) === 0
      )
        await page.screenshot({
          path: testInfo.outputPath("totals-before-export.png"),
          fullPage: true,
        });
      const exportButton = page.getByRole("button", {
        name: exporting.export,
        exact: true,
      });
      await expect(exportButton).toBeVisible();
      await expect(exportButton).toHaveAccessibleDescription(
        `${exporting.help} ${exporting.applyHelp}`,
      );
      harness.guardDisposableLocalDatabase();
      const confirmation = JSON.parse(
        harness.runSql(
          `select jsonb_build_object('at',to_char(confirmed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"'),'day',(confirmed_at at time zone 'Asia/Baghdad')::date) from public.booking_confirmations where booking_request_id='${request}';`,
        ),
      ) as { at: string; day: string };
      expect(confirmation.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const uuidPattern =
        "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
      const canonicalUuid = new RegExp(`^${uuidPattern}$`);
      const selection: unknown = JSON.parse(
        harness.runSql(`
          select coalesce(jsonb_agg(jsonb_build_object(
            'id',requests.id,'reference',requests.booking_request_reference
          ) order by requests.id),'[]'::jsonb)
          from public.booking_requests requests
          join public.booking_confirmations confirmations on confirmations.booking_request_id=requests.id
          where (confirmations.confirmed_at at time zone 'Asia/Baghdad')::date='${confirmation.day}'::date
            and not exists(select 1 from public.booking_request_confirmation_invalidations invalidation where invalidation.booking_request_id=requests.id)
            and not exists(select 1 from public.booking_request_payment_required_expiry_work expiry where expiry.booking_request_id=requests.id and expiry.state='quarantined')
            and (
              (exists(select 1 from public.booking_lifecycle_outcomes outcome where outcome.booking_request_id=requests.id and outcome.outcome='completed')
                and (public.booking_request_payment_status(requests)='paid-confirmed'
                  or exists(select 1 from public.booking_cancellations cancellation where cancellation.booking_request_id=requests.id)))
              or (not exists(select 1 from public.booking_cancellations cancellation where cancellation.booking_request_id=requests.id)
                and public.booking_request_payment_status(requests) is distinct from 'paid-confirmed')
            );
        `),
      );
      if (!Array.isArray(selection))
        throw new Error("Expected a complete booking selection array");
      const expectedBookings = selection.map((row: unknown) => {
        if (
          typeof row !== "object" ||
          row === null ||
          !("id" in row) ||
          typeof row.id !== "string" ||
          !canonicalUuid.test(row.id) ||
          !("reference" in row) ||
          typeof row.reference !== "string" ||
          !/^RC-REQ-[A-F0-9]{16}$/.test(row.reference)
        )
          throw new Error("Invalid booking selection identity");
        return { id: row.id, reference: row.reference };
      });
      const expectedBookingIds = expectedBookings.map((booking) => booking.id);
      expect(expectedBookings.length).toBeGreaterThan(0);
      expect(expectedBookings.length).toBeLessThanOrEqual(500);
      expect(new Set(expectedBookingIds).size).toBe(expectedBookings.length);
      expect(
        new Set(expectedBookings.map((booking) => booking.reference)).size,
      ).toBe(expectedBookings.length);
      expect(expectedBookings).toContainEqual({ id: request, reference });
      await page
        .locator('form[method="get"] select[name="state"]')
        .selectOption("completed");
      await page
        .locator('form[method="get"] input[name="from"]')
        .fill(confirmation.day);
      await page
        .locator('form[method="get"] input[name="through"]')
        .fill(confirmation.day);
      await apply.click();
      await expect(page).toHaveURL(
        new RegExp(
          `state=completed&from=${confirmation.day}&through=${confirmation.day}$`,
        ),
      );
      await expect(count.locator("strong")).toHaveText(
        formatInteger(expectedBookingIds.length, locale),
      );
      const appliedUrl = page.url();
      await page
        .locator('form[method="get"] input[name="from"]')
        .fill("2101-12-31");
      const downloadSelection = async () => {
        await exportButton.focus();
        const pending = page.waitForEvent("download");
        await page.keyboard.press("Enter");
        const download = await pending;
        expect(download.suggestedFilename()).toMatch(
          /^rentcottage-money-[0-9a-f-]{36}\.csv$/,
        );
        const saved = await download.path();
        expect(saved).not.toBeNull();
        const bytes = readFileSync(saved!);
        expect([...bytes.subarray(0, 3)]).toEqual([239, 187, 191]);
        const csv = bytes.toString("utf8");
        expect(csv).toContain(`"${exporting.exportRecordId}"`);
        expect(csv).toContain(`"${copy.bookingPrice} - ${exporting.currency}"`);
        expect(csv).toContain(`"${reference}"`);
        expect(csv).toContain(`"${request}"`);
        for (const privateValue of [
          owner,
          customer,
          activeAdministratorId!,
          identity.ownerPhone,
          identity.customerPhone,
          browserQuote.houseRules,
          browserQuote.cottageName,
        ])
          expect(csv).not.toContain(privateValue);
        const exportId = download
          .suggestedFilename()
          .slice("rentcottage-money-".length, -4);
        const audit = JSON.parse(
          harness.runSql(
            `select jsonb_build_object('actor',administrator_user_id,'state',filter_state,'from',filter_from,'through',filter_through,'ids',booking_request_ids,'at',to_char(recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"')) from private.administrator_booking_money_exports where id='${exportId}';`,
          ),
        );
        expect(audit).toEqual({
          actor: activeAdministratorId,
          state: "completed",
          from: confirmation.day,
          through: confirmation.day,
          ids: expectedBookingIds,
          at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        });
        expect(csv).toContain(`"${exportId}","${audit.at}"`);
        const lines = csv.slice(1).split("\r\n");
        expect(lines.pop()).toBe("");
        const headerPrefix =
          [
            exporting.exportRecordId,
            exporting.recordedAt,
            exporting.recordType,
            exporting.reference,
            exporting.bookingRequestId,
          ]
            .map((label) => `"${label}"`)
            .join(",") + ",";
        expect(lines.shift()?.startsWith(headerPrefix)).toBe(true);
        const metadataPrefix = new RegExp(
          `^"(${uuidPattern})","(\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{6}\\+00:00)","(${exporting.booking}|${exporting.refund})","(RC-REQ-[A-F0-9]{16})","(${uuidPattern})",`,
        );
        const records = lines.map((line) => {
          const metadata = metadataPrefix.exec(line);
          if (!metadata) throw new Error("Unrecognized export row identity");
          expect(metadata[1]).toBe(exportId);
          expect(metadata[2]).toBe(audit.at);
          return {
            line,
            type: metadata[3],
            reference: metadata[4],
            id: metadata[5],
          };
        });
        const csvBookingIds = [...new Set(records.map((row) => row.id))].sort();
        expect(csvBookingIds).toEqual(expectedBookingIds);
        expect(csvBookingIds).toEqual(audit.ids);
        const bookingRecords = records.filter(
          (row) => row.type === exporting.booking,
        );
        expect(bookingRecords).toHaveLength(expectedBookings.length);
        for (const booking of expectedBookings)
          expect(
            bookingRecords.filter(
              (row) =>
                row.id === booking.id && row.reference === booking.reference,
            ),
          ).toHaveLength(1);
        const targetBookingRecords = bookingRecords.filter(
          (row) => row.id === request,
        );
        expect(targetBookingRecords).toHaveLength(1);
        expect(targetBookingRecords[0].line).toContain(
          '"110000","5000","115000","11000"',
        );
        expect(targetBookingRecords[0].line).toContain('"99000","0","0"');
        await writeFile(
          testInfo.outputPath(`export-audit-${locale}-${exportId}.json`),
          JSON.stringify(
            { ...audit, expectedBookingIds, csvBookingIds },
            null,
            2,
          ),
        );
        expect(
          Number(
            harness.runSql(
              `select count(*) from private.administrator_booking_money_exports where administrator_user_id='${activeAdministratorId}';`,
            ),
          ),
        ).toBeGreaterThan(0);
        await expect(exportButton).toBeFocused();
      };
      await downloadSelection();
      expect(page.url()).toBe(appliedUrl);
      await expect(
        page.locator('form[method="get"] input[name="from"]'),
      ).toHaveValue("2101-12-31");
      for (const evidenceViewport of locale === "en"
        ? [viewport, { width: 390, height: 844 }]
        : [viewport]) {
        await page.setViewportSize(evidenceViewport);
        await exportButton.focus();
        const measurement = await exportButton.evaluate((button) => {
          const box = button.getBoundingClientRect();
          const css = getComputedStyle(button);
          let ancestor: Element | null = button;
          let background = css.backgroundColor;
          while (background === "rgba(0, 0, 0, 0)" && ancestor?.parentElement) {
            ancestor = ancestor.parentElement;
            background = getComputedStyle(ancestor).backgroundColor;
          }
          const luminance = (color: string) => {
            const channels = color
              .match(/[\d.]+/g)!
              .slice(0, 3)
              .map(Number)
              .map((value) => {
                const unit = value / 255;
                return unit <= 0.04045
                  ? unit / 12.92
                  : ((unit + 0.055) / 1.055) ** 2.4;
              });
            return (
              channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
            );
          };
          const contrast = (foreground: string) => {
            const a = luminance(foreground),
              b = luminance(background);
            return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
          };
          return {
            textContrast: contrast(css.color),
            focusContrast: Math.max(
              contrast(css.outlineColor),
              ...(css.boxShadow.match(/rgba?\([^)]+\)/g) ?? []).map(contrast),
            ),
            boxShadow: css.boxShadow,
            focusVisible: button.matches(":focus-visible"),
            description: (button.getAttribute("aria-describedby") ?? "")
              .split(" ")
              .map((id) => document.getElementById(id)?.textContent)
              .join(" "),
            effectiveBackground: background,
            name: button.textContent?.trim(),
            width: box.width,
            height: box.height,
            noOverflow: document.documentElement.scrollWidth <= innerWidth,
            contained: box.left >= 0 && box.right <= innerWidth,
            focused: document.activeElement === button,
            color: css.color,
            background: css.backgroundColor,
            outlineColor: css.outlineColor,
            outlineStyle: css.outlineStyle,
            outlineWidth: css.outlineWidth,
            direction: document.documentElement.dir,
          };
        });
        await writeFile(
          testInfo.outputPath(
            `totals-export-${locale}-${evidenceViewport.width}.json`,
          ),
          JSON.stringify(measurement, null, 2),
        );
        expect(measurement.height).toBeGreaterThanOrEqual(44);
        expect(measurement.textContrast).toBeGreaterThanOrEqual(4.5);
        expect(measurement.focusContrast).toBeGreaterThanOrEqual(3);
        expect(measurement.outlineStyle).not.toBe("none");
        expect(measurement).toMatchObject({
          noOverflow: true,
          contained: true,
          focused: true,
          focusVisible: true,
          direction,
          name: exporting.export,
          description: `${exporting.help} ${exporting.applyHelp}`,
        });
        await page.screenshot({
          path: testInfo.outputPath(
            `totals-export-${locale}-${evidenceViewport.width}.png`,
          ),
          fullPage: true,
        });
      }
      const continuation = new URL(appliedUrl);
      continuation.searchParams.set("afterAt", confirmation.at);
      continuation.searchParams.set("afterId", request);
      await page.goto(continuation.toString());
      await expect(
        page.getByRole("link", { name: reference, exact: true }),
      ).toHaveCount(0);
      await expect(count.locator("strong")).toHaveText(
        formatInteger(expectedBookingIds.length, locale),
      );
      await downloadSelection();
      if (locale === "ar") {
        await page
          .locator('form[method="post"] input[name="state"]')
          .evaluate((input) => {
            (input as HTMLInputElement).value = "invalid";
          });
        await exportButton.click();
        await expect(page).toHaveURL(/exportError=invalid$/);
        await expect(page.locator("main").getByRole("alert")).toContainText(
          exporting.invalid,
        );
        await page.screenshot({
          path: testInfo.outputPath("totals-export-ar-invalid.png"),
          fullPage: true,
        });
      }
    }
  });
  for (const locale of ["en", "ar", "ckb"] as const) {
    test(`${locale} connected cancellation stay`, async ({
      page,
      baseURL,
    }, testInfo) => {
      testInfo.annotations.push({
        type: "fictional-supplier-outcomes",
        description:
          "SQL capture succeeds with fictional-provider provenance. preparePaymentOperations and DurablePaymentSimulator supply succeeded scheduled refunds. Scheduled notices have fictional local-test effects. Local Auth confirms synthetic identities without SMS. Messaging translations are deterministic fictional fixtures; unsupported content keeps the original. No map requests, real payment acceptance, phone delivery or launch readiness are claimed.",
      });
      const copy = messages[locale];
      const lifecycle = bookingLifecycleMessages[locale];
      const messaging = messagingMessages[locale];
      const statusWords = {
        en: { confirmed: "Confirmed booking", cancelled: "Cancelled booking" },
        ar: { confirmed: "حجز مؤكد", cancelled: "حجز ملغى" },
        ckb: { confirmed: "حجزی پشتڕاستکراو", cancelled: "حجزی هەڵوەشاوە" },
      }[locale];
      const refundAmounts = {
        en: {
          none: "IQD 0",
          total: "IQD 115,000",
          price: "IQD 110,000",
          fee: "IQD 5,000",
        },
        ar: {
          none: "IQD 0",
          total: "IQD 115,000",
          price: "IQD 110,000",
          fee: "IQD 5,000",
        },
        ckb: {
          none: "IQD ٠",
          total: "IQD ١١٥٬٠٠٠",
          price: "IQD ١١٠٬٠٠٠",
          fee: "IQD ٥٬٠٠٠",
        },
      }[locale];
      const assertMobile = async () => {
        await expect(page.locator("html")).toHaveAttribute(
          "dir",
          locale === "en" ? "ltr" : "rtl",
        );
        await expect
          .poll(() =>
            page.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth,
            ),
          )
          .toBe(true);
      };
      const screenshot = async (name: string) => {
        const path = testInfo.outputPath(`${name}-${locale}.png`);
        await page.screenshot({ path, fullPage: true });
        await testInfo.attach(`${name}-${locale}`, {
          path,
          contentType: "image/png",
        });
      };
      await page.setViewportSize({ width: 393, height: 851 });
      await participant(page.context(), customer, baseURL);
      await page.goto(`/${locale}/booking-requests/${reference}`);
      const bookingUrl = page.url();
      const confirmed = page.getByRole("region", {
        name: lifecycle.confirmed,
        exact: true,
      });
      await expect(confirmed).toContainText(browserQuote.cottageName);
      await expect(confirmed.locator(".confirmed-booking-record")).toHaveCSS(
        "border-top-style",
        "solid",
      );
      await assertMobile();
      const before = observeConnectedStay();
      for (const key of [
        "requests",
        "snapshots",
        "ranges",
        "captures",
        "attempts",
      ])
        expect(before[key]).toHaveLength(1);
      expect(before.requests[0]).toEqual({
        id: request,
        customer,
        owner,
        profile: identity.profile,
      });
      expect(before.attempts).toEqual([
        { id: identity.attempt, request, conversation: null },
      ]);
      expect(before.captures[0]).toMatchObject({
        amount_fils: 115000000,
        current_outcome: "succeeded",
      });
      for (const key of [
        "links",
        "conversations",
        "messages",
        "refunds",
        "effects",
      ])
        expect(before[key]).toEqual([]);
      if (locale === "en") {
        const period = confirmed
          .locator("dl > div")
          .filter({ has: page.getByText("Booking period", { exact: true }) });
        const observations = await captureMetadataViewports(
          page,
          confirmed,
          "confirmed-booking-en",
          async () => {
            await expect
              .poll(() =>
                period.locator("dd > span").evaluateAll((entries) =>
                  entries.flatMap((entry) =>
                    Array.from(entry.querySelectorAll("bdi"))
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
                    entry.querySelectorAll("bdi"),
                    (value) => value.textContent ?? "",
                  ),
                ),
              );
          },
        );
        for (const observation of observations)
          expect(
            observation.values,
            `${observation.viewport} booking period boundaries`,
          ).toEqual(
            ["Morning", "Night", "Full day"].map((name) => [
              name,
              expect.stringMatching(/\S.*[:：]/),
              expect.stringMatching(/\S.*[:：]/),
            ]),
          );
      }
      const open = page.getByRole("button", {
        name: messaging.open,
        exact: true,
      });
      await open.focus();
      await expect(open).toBeFocused();
      await open.press("Enter");
      await expect(page).toHaveURL(
        new RegExp(`/${locale}/messages/[0-9a-f-]{36}`),
      );
      const conversationId = new URL(page.url()).pathname.split("/").at(-1)!;
      await expect(
        page.getByText(`${reference} · ${statusWords.confirmed}`, {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", {
          name: browserQuote.cottageName,
          level: 1,
        }),
      ).toBeFocused();
      await expect(
        page
          .getByRole("list", { name: messaging.messages, exact: true })
          .getByRole("listitem"),
      ).toHaveCount(0);
      const hostileMessage =
        'Fictional stay example <img data-fictional-injection="message" src=x onerror="alert(1)">';
      await page
        .getByLabel(messaging.languageLabel)
        .selectOption(locale === "en" ? "ar" : "en");
      await page
        .getByLabel(messaging.messageLabel, { exact: true })
        .fill(hostileMessage);
      const send = page.getByRole("button", {
        name: messaging.send,
        exact: true,
      });
      await send.focus();
      await expect(send).toBeFocused();
      await send.press("Enter");
      const message = page
        .getByRole("list", { name: messaging.messages, exact: true })
        .getByRole("listitem");
      await expect(message).toHaveCount(1);
      await expect(
        message.getByText(hostileMessage, { exact: true }),
      ).toBeVisible();
      await expect(
        page.locator('[data-fictional-injection="message"]'),
      ).toHaveCount(0);
      await expect(send).toBeFocused();
      await message
        .getByRole("button", {
          name: messaging.automaticTranslation,
          exact: true,
        })
        .click();
      await expect(message).toContainText(messaging.translationUnavailable);
      await expect(
        message.getByText(hostileMessage, { exact: true }),
      ).toBeVisible();
      await assertMobile();
      await screenshot("connected-messaging-mobile");
      const linked = observeConnectedStay();
      for (const key of ["attempts", "links", "conversations", "messages"])
        expect(linked[key]).toHaveLength(1);
      expect(linked.attempts).toEqual([
        { ...before.attempts[0], conversation: conversationId },
      ]);
      expect(linked.links[0]).toMatchObject({
        conversation_id: conversationId,
        booking_request_id: request,
        submission_attempt_id: before.attempts[0].id,
      });
      expect(linked.conversations[0]).toMatchObject({
        id: conversationId,
        customer_user_id: customer,
        owner_user_id: owner,
        profile_id: before.requests[0].profile,
      });
      expect(linked.messages[0]).toMatchObject({
        conversation_id: conversationId,
        sender_user_id: customer,
        original_body: hostileMessage,
      });
      await page.goBack();
      await expect(page).toHaveURL(bookingUrl);
      expect(new URL(page.url()).pathname).toBe(
        `/${locale}/booking-requests/${reference}`,
      );
      await expect(confirmed).toContainText(
        `CANCELLATION-HOLD-${identity.stem}`,
      );
      await expect(confirmed).toBeVisible();
      const form = page.getByRole("form", { name: copy.cancel });
      await expect(form).toContainText(copy.policy);
      await form.getByRole("checkbox").focus();
      await page.keyboard.press("Space");
      await page.keyboard.press("Tab");
      const cancel = form.getByRole("button", {
        name: copy.cancel,
        exact: true,
      });
      await cancel.focus();
      await expect(cancel).toBeFocused();
      await cancel.press("Enter");
      await expect(
        page.getByRole("heading", { name: copy.cancelled, exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: copy.cancelled, exact: true }),
      ).toBeFocused();
      await expect(
        page.getByRole("heading", { name: copy.fullRequired, exact: true }),
      ).toBeVisible();
      await expectAmount(
        page.getByTestId("verified-refund"),
        copy.total,
        refundAmounts.none,
      );
      await assertMobile();
      await screenshot("connected-refund-pending-mobile");
      expect((await triggerScheduled(baseURL, "/__scheduled")).ok).toBe(true);
      await page.reload();
      await expectAmount(
        page.getByTestId("verified-refund"),
        copy.total,
        refundAmounts.total,
      );
      await expectAmount(
        page.getByTestId("verified-refund"),
        copy.price,
        refundAmounts.price,
      );
      await expectAmount(
        page.getByTestId("verified-refund"),
        copy.fee,
        refundAmounts.fee,
      );
      const refunded = observeConnectedStay();
      expect(refunded.refunds).toHaveLength(1);
      expect(refunded.refunds[0]).toMatchObject({
        amount_fils: 115000000,
        current_outcome: "succeeded",
        payment_lifecycle_id: before.captures[0].payment_lifecycle_id,
      });
      expect(refunded.effects).toHaveLength(1);
      expect(refunded.effects[0]).toMatchObject({
        operation_id: refunded.refunds[0].id,
        physical_execution_count: 1,
      });
      expect((await triggerScheduled(baseURL, "/__scheduled")).ok).toBe(true);
      const delivered = observeConnectedStay();
      expect(delivered.refunds).toEqual(refunded.refunds);
      expect(delivered.effects).toEqual(refunded.effects);
      // Cancellation, refund requested and refund returned each notify Customer and Cottage Owner.
      expect(delivered.deliveredNotices).toBe(6);
      expect(delivered.notificationEffects).toBe(6);
      expect((await triggerScheduled(baseURL, "/__scheduled")).ok).toBe(true);
      const replayed = observeConnectedStay();
      expect(replayed.refunds).toEqual(delivered.refunds);
      expect(replayed.effects).toEqual(delivered.effects);
      expect(replayed.deliveredNotices).toBe(delivered.deliveredNotices);
      expect(replayed.notificationEffects).toBe(delivered.notificationEffects);
      for (const key of ["requests", "snapshots", "ranges", "captures"])
        expect(replayed[key]).toEqual(before[key]);
      for (const key of ["attempts", "links", "conversations", "messages"])
        expect(replayed[key]).toEqual(linked[key]);
      await page
        .getByRole("link", {
          name: accessMessages[locale].backToBookings,
          exact: true,
        })
        .click();
      await expect(page).toHaveURL(`/${locale}/bookings`);
      const retainedBooking = page.getByRole("link", {
        name: new RegExp(browserQuote.cottageName),
      });
      await expect(
        page.getByRole("listitem").filter({ has: retainedBooking }),
      ).toContainText(lifecycle.cancelled);
      await expect(retainedBooking).toHaveAttribute(
        "href",
        `/${locale}/booking-requests/${reference}`,
      );
      await retainedBooking.click();
      await expect(
        page.getByRole("heading", { name: copy.cancelled, exact: true }),
      ).toBeVisible();
      const cancelledHeadingViewport = page.viewportSize()!;
      try {
        if (locale === "ar")
          await page.setViewportSize({ width: 390, height: 844 });
        await observeRecordHeading(
          page,
          testInfo,
          accessMessages[locale].backToBookings,
          `/${locale}/bookings`,
          `heading-cancelled-${locale}-a11y`,
        );
        const heading = page.getByRole("main").locator("header.page-heading");
        await expect
          .poll(() =>
            heading.evaluate((header) => {
              const next = header.nextElementSibling;
              if (!next)
                throw new Error("Cancelled heading has no following content");
              return (
                next.getBoundingClientRect().top -
                header.getBoundingClientRect().bottom
              );
            }),
          )
          .toBeCloseTo(24, 1);
        const gapPath = testInfo.outputPath(
          `heading-cancelled-${locale}-gap.json`,
        );
        await writeFile(
          gapPath,
          JSON.stringify(
            await heading.evaluate((header) => {
              const next = header.nextElementSibling;
              const parent = header.parentElement;
              if (!next || !parent)
                throw new Error("Cancelled heading layout is missing");
              const headerRectangle = header.getBoundingClientRect();
              const nextRectangle = next.getBoundingClientRect();
              return {
                gap: nextRectangle.top - headerRectangle.bottom,
                header: headerRectangle.toJSON(),
                next: nextRectangle.toJSON(),
                parent: parent.getBoundingClientRect().toJSON(),
                panelHtml: parent.outerHTML,
                language: document.documentElement.lang,
                direction: document.documentElement.dir,
                stylesheetHrefs: Array.from(
                  document.querySelectorAll<HTMLLinkElement>(
                    'link[rel~="stylesheet"][href]',
                  ),
                  (link) => link.href,
                ),
              };
            }),
            null,
            2,
          ),
        );
        await testInfo.attach(`heading-cancelled-${locale}-gap`, {
          path: gapPath,
          contentType: "application/json",
        });
        if (locale === "ar")
          await page.screenshot({
            path: testInfo.outputPath("heading-cancelled-ar.png"),
          });
      } finally {
        if (locale === "ar")
          await page.setViewportSize(cancelledHeadingViewport);
      }
      await expect(
        page.getByText("Fictional private address", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByText(identity.ownerPhone, { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("form", { name: customerReviewMessages[locale].title }),
      ).toHaveCount(0);
      await expect(
        page
          .getByRole("region", {
            name: lifecycle.title,
            exact: true,
          })
          .getByText(lifecycle.reviewClosed, {
            exact: true,
          }),
      ).toBeVisible();
      await assertMobile();
      await screenshot("connected-refund-returned-mobile");
      if (locale === "en") {
        await page.setViewportSize({ width: 1440, height: 1000 });
        const cancelledMain = page.locator("#customer-booking-request-detail");
        await page.keyboard.press("Tab");
        await cancelledMain.focus();
        await expect(cancelledMain).toBeFocused();
        await expect(cancelledMain).toHaveCSS("outline-offset", "-3px");
        await expect
          .poll(() =>
            page.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth,
            ),
          )
          .toBe(true);
        await screenshot("cancelled-full-width-main-focus-desktop");
        await page.setViewportSize({ width: 393, height: 851 });
      }
      await page
        .getByRole("button", { name: messaging.open, exact: true })
        .click();
      await expect(page).toHaveURL(`/${locale}/messages/${conversationId}`);
      await expect(
        page.getByText(`${reference} · ${statusWords.cancelled}`, {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page
          .getByRole("list", { name: messaging.messages, exact: true })
          .getByText(hostileMessage, { exact: true }),
      ).toBeVisible();
      await expect(
        page.locator('[data-fictional-injection="message"]'),
      ).toHaveCount(0);
      await expect(
        page.getByText(messaging.contactAllowed, { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Fictional private address", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByText(identity.ownerPhone, { exact: true }),
      ).toHaveCount(0);
      await assertMobile();
      await screenshot("connected-retained-messaging-mobile");
      const inbox = page.getByRole("link", {
        name: messaging.inbox,
        exact: true,
      });
      await inbox.focus();
      await expect(inbox).toBeFocused();
      await inbox.press("Enter");
      await expect(page).toHaveURL(new RegExp(`/${locale}/messages(?:\\?|$)`));
      const inboxRow = page.getByRole("listitem").filter({
        has: page.locator(`a[href="/${locale}/messages/${conversationId}"]`),
      });
      await expect(inboxRow).toHaveCount(1);
      await expect(
        inboxRow.getByText(statusWords.cancelled, { exact: true }),
      ).toBeVisible();
      await expect(
        inboxRow.getByText(statusWords.cancelled, { exact: true }),
      ).toHaveClass("status-badge");
      await assertMobile();
      await screenshot("connected-cancelled-inbox-mobile");

      const retained = observeConnectedStay();
      for (const key of ["attempts", "links", "conversations", "messages"])
        expect(retained[key]).toEqual(linked[key]);
    });
  }
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
    await cancelOwnerControl.press("Enter");
    await expect(
      page.getByRole("heading", { name: messages.ar.cancelled, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: messages.ar.cancelled, exact: true }),
    ).toBeFocused();

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
      await exceptionFeeControl.press("Enter");
      await expect(
        page.getByRole("list", { name: messages.en.approved }).locator("li"),
      ).toHaveCount(2);
      await expect(
        page.getByRole("heading", { name: messages.en.title, exact: true }),
      ).toBeFocused();

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
      await cancelAdministratorControl.press("Enter");
      await expect(
        page.getByRole("heading", {
          name: messages.ckb.cancelled,
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", {
          name: messages.ckb.cancelled,
          exact: true,
        }),
      ).toBeFocused();

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
        ownerPage.getByText("Fictional private address", { exact: true }),
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
