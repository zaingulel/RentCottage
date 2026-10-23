import { expect, test, type Page, type BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { build, type Plugin } from "esbuild";
import {
  Miniflare,
  Response as NativeResponse,
  type MiniflareOptions,
} from "miniflare";
import type { NotificationDeliveryResult } from "../src/notification/notification-delivery";
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
    | "owner"
    | "customer"
    | "third"
    | "administrator"
    | "request"
    | "reference"
    | "snapshot"
    | "commitment"
    | "claim"
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
    completion?: boolean;
    settlement?: boolean;
    terminalRequest?: boolean;
  }): string;
};
const harness = createLocalSupabaseConcurrencyHarness();
let identity: ReturnType<typeof browserBookingFixtureIdentity>;
let request: string, reference: string, owner: string, customer: string;
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
const fixtureSource =
  "begin; " +
  bookingFixtureSource(source, {
    start: "-- BEGIN PAYMENT EVIDENCE FIXTURE",
    end: "-- END PAYMENT EVIDENCE FIXTURE",
  }) +
  bookingFixtureSource(source, {
    start: "-- BEGIN COMPLETION FIXTURE",
    end: "-- END COMPLETION FIXTURE",
    required: [
      "00000000100",
      "964750000100",
      "CONFIRMATION-HOLD-1",
      "Confirmation Cottage",
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
    .replaceAll("CONFIRMATION-HOLD-1", `COMPLETION-HOLD-${identity.stem}`)
    .replaceAll("Confirmation Cottage", `completion ${identity.stem} Cottage`)
    .replaceAll("10000000-0000-4000-8000-000000003801", identity.administrator)
    .replaceAll(
      "cancellation-admin@example.test",
      `completion-${identity.stem}@example.test`,
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
    )
    .replace(
      "fixture:=replace(fixture,'2101-01-02'",
      "fixture:=replace(fixture,'2101-01-03',(start_day+2)::text); fixture:=replace(fixture,'2101-01-02'",
    );
let activeAdministratorId: string | null = null;

const clear = () => {
  const cleanup = confirmedBookingCleanup({
    stem: identity.stem,
    administrator: identity.administrator,
    completion: true,
  });
  harness.guardDisposableLocalDatabase();
  harness.runSql(
    `delete from auth.sessions where user_id in ('${owner}','${customer}','${identity.third}');delete from auth.identities where user_id in ('${owner}','${customer}','${identity.third}');${cleanup}`,
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
function observe() {
  return JSON.parse(
    harness.runSql(`select jsonb_build_object(
    'outcomes',(select coalesce(jsonb_agg(to_jsonb(o) order by id),'[]') from public.booking_lifecycle_outcomes o where booking_request_id='${request}'),
    'maturity',(select coalesce(jsonb_agg(to_jsonb(m) order by booking_request_id),'[]') from public.booking_completion_maturity m where booking_request_id='${request}'),
    'incidents',(select coalesce(jsonb_agg(to_jsonb(i) order by id),'[]') from public.booking_incidents i where booking_request_id='${request}'),
    'end',(select upper(range_merge(access_ranges)) from public.cottage_booking_period_commitments where id='${identity.commitment}'),
    'original',jsonb_build_object(
      'snapshot',(select to_jsonb(s) from public.booking_snapshots s where id='${identity.snapshot}'),
      'confirmation',(select to_jsonb(c) from public.booking_confirmations c where booking_request_id='${request}'),
      'receipts',(select jsonb_agg(to_jsonb(r) order by id) from public.booking_receipts r where booking_confirmation_id in (select id from public.booking_confirmations where booking_request_id='${request}')),
      'commitment',(select to_jsonb(c) from public.cottage_booking_period_commitments c where id='${identity.commitment}'),
      'operations',(select jsonb_agg(to_jsonb(o) order by id) from public.payment_provider_operations o where claim_id='${identity.claim}'),
      'observations',(select jsonb_agg(to_jsonb(o) order by id) from public.payment_provider_observations o where operation_id in (select id from public.payment_provider_operations where claim_id='${identity.claim}')),
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
async function assertLifecycleViews(
  page: Page,
  role: "customer" | "cottage_owner" | "platform_administrator",
  status: "completed" | "incident_pending" | "no_show",
) {
  for (const viewport of [
    { width: 393, height: 851 },
    { width: 1440, height: 1000 },
  ]) {
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
    }
  }
}
const wrangler = JSON.parse(
  readFileSync("wrangler.jsonc", "utf8").replace(/,\s*([}\]])/g, "$1"),
);
const hostedBindings = {
  APP_ENVIRONMENT: "preview",
  HOSTED_DEMO: "true",
  SUPABASE_PROJECT_REF: "yvibcyqtyihpzpmomnzg",
  SUPABASE_URL: "https://yvibcyqtyihpzpmomnzg.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "native-fixture-publishable",
  SUPABASE_SECRET_KEY: "native-fixture-secret",
  PRIVILEGED_AUDIT_HMAC_KEY:
    "native-fixture-audit-key-with-at-least-32-characters",
  DEPLOYMENT_COMMIT: "a".repeat(40),
};

async function bundleHostedDemo(extraPlugins: Plugin[] = []): Promise<string> {
  const bundled = await build({
    entryPoints: [wrangler.env.demo.main],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    external: ["node:*", "cloudflare:*"],
    plugins: [
      {
        name: "native-schedule-opennext-boundary",
        setup(builder) {
          builder.onResolve({ filter: /\.open-next\/worker\.js$/ }, () => ({
            path: "opennext",
            namespace: "native-opennext-fixture",
          }));
          builder.onLoad(
            { filter: /.*/, namespace: "native-opennext-fixture" },
            () => ({
              contents:
                'export default { fetch() { return new Response("OpenNext boundary"); } };',
              loader: "js",
            }),
          );
        },
      },
      ...extraPlugins,
    ],
  });
  return bundled.outputFiles[0].text;
}
function hostedWorkerConfig(
  name: string,
  contents: string,
  bindings: Record<string, string>,
) {
  return {
    name,
    compatibilityDate: wrangler.compatibility_date,
    compatibilityFlags: wrangler.compatibility_flags,
    manifest: {
      mainModule: "worker.js",
      modules: { "worker.js": { type: "esm" as const, contents } },
    },
    env: Object.fromEntries(
      Object.entries(bindings).map(([name, value]) => [
        name,
        { type: "text" as const, value },
      ]),
    ),
  } satisfies MiniflareOptions["workers"][number]["config"];
}
test("hosted native schedule admits only the exact demo and awaits all five drains", async () => {
  const schedules = {
    "booking-request-expiry-schedule": [
      "expiry",
      "runScheduledBookingRequestExpiry",
    ],
    "booking-request-capture-schedule": [
      "capture",
      "runScheduledBookingRequestCapture",
    ],
    "booking-refund-schedule": ["refunds", "runScheduledBookingRefunds"],
    "booking-completion-schedule": [
      "completion",
      "runScheduledBookingCompletion",
    ],
    "notification-schedule": [
      "notifications",
      "runScheduledBookingNotifications",
    ],
  };
  const services = [
    "capture",
    "completion",
    "expiry",
    "notifications",
    "refunds",
  ];
  const bundled = await bundleHostedDemo([
    {
      name: "native-schedule-composition-boundaries",
      setup(builder) {
        builder.onResolve(
          {
            filter:
              /\/(booking-request-expiry-schedule|booking-request-capture-schedule|booking-refund-schedule|booking-completion-schedule|notification-schedule)$/,
          },
          ({ path }) => ({
            path: path.slice(path.lastIndexOf("/") + 1),
            namespace: "native-schedule-fixture",
          }),
        );
        builder.onLoad(
          { filter: /.*/, namespace: "native-schedule-fixture" },
          ({ path }) => {
            const [service, exported] =
              schedules[path as keyof typeof schedules];
            return {
              contents: `export async function ${exported}() {
              const response = await fetch("https://schedule-observation.test/started/${service}");
              if (!response.ok) throw new Error("PRIVATE controlled drain rejection");
              const result = await response.json();
              await fetch("https://schedule-observation.test/finished/${service}");
              return result;
            }`,
              loader: "js",
            };
          },
        );
      },
    },
  ]);
  const started: string[] = [];
  const events: string[] = [];
  const diagnostics: string[] = [];
  let notificationResults: readonly NotificationDeliveryResult[] = [];
  let rejected: string | undefined;
  let held: string | undefined;
  let releaseHeld: (() => void) | undefined;
  let allStarted: (() => void) | undefined;
  const options = (
    values: Record<string, string> = hostedBindings,
  ): MiniflareOptions => {
    const config = hostedWorkerConfig(
      "hosted-native-composition-fixture",
      bundled,
      values,
    );
    return {
      host: "127.0.0.1",
      unsafeTriggerHandlers: true,
      telemetry: { enabled: false },
      workers: [
        {
          config: {
            ...config,
            manifest: {
              ...config.manifest,
              mainModule: "observer.js",
              modules: {
                ...config.manifest.modules,
                "observer.js": {
                  type: "esm",
                  contents: `import worker from "./worker.js";
export default {
  fetch(request, environment, context) {
    return worker.fetch(request, environment, context);
  },
  async scheduled(controller, environment, context) {
    try {
      return await worker.scheduled(controller, environment, context);
    } catch (error) {
      await fetch("https://schedule-observation.test/failure", {
        method: "POST",
        body: error.message,
      });
      throw error;
    }
  },
};`,
                },
              },
            },
          },
          dev: {
            outboundService: {
              type: "fetcher",
              async handler(request) {
                const url = new URL(request.url);
                if (url.origin !== "https://schedule-observation.test")
                  throw new Error("Unexpected native composition egress");
                if (url.pathname === "/failure" && request.method === "POST") {
                  diagnostics.push(await request.text());
                  return new NativeResponse("Observed");
                }
                const [, stage, service] = url.pathname.split("/");
                if (
                  !["started", "finished"].includes(stage) ||
                  !services.includes(service)
                )
                  throw new Error("Unexpected native composition observation");
                events.push(`${stage}:${service}`);
                if (stage === "finished") return new NativeResponse("Observed");
                started.push(service);
                if (started.length === services.length) allStarted?.();
                if (service === held)
                  await new Promise<void>((resolve) => {
                    releaseHeld = resolve;
                  });
                if (service === rejected)
                  return new NativeResponse("Rejected", { status: 503 });
                return NativeResponse.json(
                  service === "notifications" ? notificationResults : [],
                );
              },
            },
          },
        },
      ],
    };
  };
  // Miniflare's published Fetcher type imports a dev-only workers-types package.
  // The installed getWorker implementation returns the native fetcher proxy.
  type NativeUserWorker = { fetch(url: string): Promise<NativeResponse> };
  let runtime: Miniflare | undefined;
  const cron = "* * * * *";
  const invoke = (value = cron) =>
    runtime!.dispatchFetch(
      `http://localhost/cdn-cgi/local/scheduled?format=json&cron=${encodeURIComponent(value)}`,
    );
  const assertOutcome = async (
    response: Awaited<ReturnType<typeof invoke>>,
    status: number,
  ) => {
    expect(response.status).toBe(status);
    const result = (await response.json()) as { outcome: string };
    if (status === 200) expect(result.outcome).toBe("ok");
    else expect(result.outcome).not.toBe("ok");
  };
  try {
    runtime = new Miniflare(options());
    for (const [results, status] of [
      [[], 200],
      [[{ status: "delivered", historical: false }], 200],
      [[{ status: "delivered", historical: true }], 200],
      [[{ status: "stale" }], 200],
      [[{ status: "suppressed" }], 200],
      [[{ status: "unavailable" }], 200],
      [[{ status: "uncertain" }], 500],
      [[{ status: "retryable" }], 500],
    ] as const) {
      started.length = 0;
      events.length = 0;
      notificationResults = results;
      await assertOutcome(await invoke(), status);
      expect(started.toSorted()).toEqual(services);
      expect(
        events.filter((event) => event.startsWith("finished:")).toSorted(),
      ).toEqual(services.map((service) => `finished:${service}`));
    }
    started.length = 0;
    for (const path of ["/__scheduled", "/cdn-cgi/local/scheduled"]) {
      const worker = (await runtime.getWorker()) as unknown as NativeUserWorker;
      const response = await worker.fetch(`https://demo.halabeekom.com${path}`);
      expect(response.status).toBe(403);
    }
    expect(started).toEqual([]);
    await assertOutcome(await invoke("0 * * * *"), 500);
    expect(started).toEqual([]);
    for (const patch of [
      { HOSTED_DEMO: undefined },
      { HOSTED_DEMO: "TRUE" },
      { APP_ENVIRONMENT: "production" },
      {
        APP_ENVIRONMENT: "test",
        SUPABASE_PROJECT_REF: "local-test",
        SUPABASE_URL: "http://127.0.0.1:54321",
        HOSTED_DEMO: undefined,
      },
      {
        SUPABASE_PROJECT_REF: "other-project",
        SUPABASE_URL: "https://other-project.supabase.co",
      },
      { SUPABASE_URL: hostedBindings.SUPABASE_URL + "/path" },
      { SUPABASE_URL: hostedBindings.SUPABASE_URL + "?query=1" },
      {
        SUPABASE_URL: "https://user:password@yvibcyqtyihpzpmomnzg.supabase.co",
      },
      { SUPABASE_PUBLISHABLE_KEY: undefined },
      { SUPABASE_SECRET_KEY: undefined },
      { PRIVILEGED_AUDIT_HMAC_KEY: "too-short" },
      { DEPLOYMENT_COMMIT: "invalid" },
    ]) {
      const values = Object.fromEntries(
        Object.entries({ ...hostedBindings, ...patch }).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      );
      await runtime.setOptions(options(values));
      await assertOutcome(await invoke(), 500);
      expect(started).toEqual([]);
    }
    await runtime.setOptions(options());
    notificationResults = [];
    for (const failure of [undefined, "expiry"]) {
      const diagnosticOffset = diagnostics.length;
      started.length = 0;
      events.length = 0;
      rejected = failure;
      held = "completion";
      const attempted = new Promise<void>((resolve) => {
        allStarted = resolve;
      });
      let settled = false;
      const invocation = invoke().then((response) => {
        settled = true;
        events.push("native:finished");
        return response;
      });
      await attempted;
      expect(started.toSorted()).toEqual(services);
      // A separate native request crosses the isolate while completion is held.
      const worker = (await runtime.getWorker()) as unknown as NativeUserWorker;
      expect(
        (await worker.fetch("https://demo.halabeekom.com/__scheduled")).status,
      ).toBe(403);
      expect(settled).toBe(false);
      expect(releaseHeld).toBeDefined();
      releaseHeld!();
      await assertOutcome(await invocation, failure ? 500 : 200);
      expect(diagnostics.slice(diagnosticOffset)).toEqual(
        failure
          ? ["Hosted demo scheduled processing is incomplete: expiry"]
          : [],
      );
      expect(events.indexOf("finished:completion")).toBeLessThan(
        events.indexOf("native:finished"),
      );
      expect(
        events.filter((event) => event.startsWith("finished:")).toSorted(),
      ).toEqual(
        services
          .filter((service) => service !== failure)
          .map((service) => `finished:${service}`),
      );
      held = undefined;
      releaseHeld = undefined;
    }
  } finally {
    releaseHeld?.();
    await runtime?.dispose();
  }
});

test.describe("scheduled completion and restricted lifecycle journeys", () => {
  test.use({ actionTimeout: 10000 });
  test.beforeEach(async ({}, testInfo) => {
    identity = browserBookingFixtureIdentity(
      "completion",
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
    harness.runSql(
      `${fixture()} select pg_temp.seed_completion_booking((clock_timestamp() at time zone 'Asia/Baghdad')::date-3); commit;`,
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
  test("hosted native scheduling preserves completion and notices across overlap and interrupted acknowledgement", async () => {
    // beforeEach seeds an owned historical SQL boundary fixture using the database Iraq date,
    // not a booking graph created through the hosted product journey.
    const before = observe();
    expect(before.outcomes).toEqual([]);
    expect(before.maturity).toEqual([]);
    const { url: localOrigin, key, publishable } = connection();
    const bundled = await bundleHostedDemo();
    const bindings = {
      ...hostedBindings,
      SUPABASE_PUBLISHABLE_KEY: publishable,
      SUPABASE_SECRET_KEY: key,
    };
    type NoticeSource = { id: string; recipient: string; role: string };
    type NoticeWork = {
      notification_id: string;
      receipt_id: string;
      event_id: string | null;
      recipient_user_id: string;
      recipient_role: string;
      state: string;
      logical_id: string;
      payload: { fictional: boolean };
      supplier_delivery_reference: string | null;
    };
    type NoticeEffect = Pick<
      NoticeWork,
      | "notification_id"
      | "receipt_id"
      | "recipient_user_id"
      | "recipient_role"
      | "logical_id"
      | "payload"
      | "supplier_delivery_reference"
    > & { environment: string; supplier: string };
    const notices = (): {
      receipts: NoticeSource[];
      reminders: NoticeSource[];
      work: NoticeWork[];
      effects: NoticeEffect[];
    } =>
      JSON.parse(
        harness.runSql(`select jsonb_build_object(
      'receipts',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'recipient',r.recipient_user_id,'role',r.recipient_role) order by r.id),'[]'::jsonb)
        from public.booking_receipts r join public.booking_confirmations c on c.id=r.booking_confirmation_id where c.booking_request_id='${request}'),
      'reminders',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'recipient',e.recipient_user_id,'role',e.recipient_role) order by e.id),'[]'::jsonb)
        from public.booking_notification_events e where e.booking_request_id='${request}' and e.event_kind='preparation_reminder'),
      'work',(select coalesce(jsonb_agg(to_jsonb(w) order by w.notification_id),'[]'::jsonb)
        from public.booking_confirmation_notification_work w where w.booking_request_id='${request}'),
      'effects',(select coalesce(jsonb_agg(to_jsonb(e) order by e.notification_id),'[]'::jsonb)
        from public.fictional_booking_confirmation_notification_effects e where e.booking_request_id='${request}'));`),
      );
    // Validate observer cardinality at the disposable seam before driving native work.
    const initialNotices = notices();
    expect(initialNotices.receipts).toHaveLength(2);
    expect(initialNotices.reminders).toHaveLength(2);
    expect(
      initialNotices.receipts
        .map((receipt) => [receipt.role, receipt.recipient])
        .toSorted(),
    ).toEqual([
      ["cottage_owner", owner],
      ["customer", customer],
    ]);
    expect(initialNotices.work).toEqual([]);
    expect(initialNotices.effects).toEqual([]);
    let malformed = true;
    let malformedLists = 0;
    let completionWrites = 0;
    let faultAcknowledgement = true;
    let interruptedAcknowledgements = 0;
    let committed: (() => void) | undefined;
    let releaseAcknowledgement: (() => void) | undefined;
    const acknowledgement = new Promise<void>((resolve) => {
      releaseAcknowledgement = resolve;
    });
    const realCommit = new Promise<void>((resolve) => {
      committed = resolve;
    });
    const createWorker = () =>
      new Miniflare({
        host: "127.0.0.1",
        unsafeTriggerHandlers: true,
        telemetry: { enabled: false },
        workers: [
          {
            config: hostedWorkerConfig(
              "hosted-native-completion-fixture",
              bundled,
              bindings,
            ),
            dev: {
              outboundService: {
                type: "fetcher",
                async handler(outbound) {
                  const url = new URL(outbound.url);
                  if (
                    url.origin !== "https://yvibcyqtyihpzpmomnzg.supabase.co" ||
                    !url.pathname.startsWith("/rest/v1/rpc/")
                  )
                    throw new Error(
                      "Unexpected native completion fixture egress",
                    );
                  if (
                    malformed &&
                    url.pathname === "/rest/v1/rpc/list_due_booking_completions"
                  ) {
                    malformedLists += 1;
                    return NativeResponse.json({
                      malformed: "not a candidate array",
                    });
                  }
                  const body = await outbound.arrayBuffer();
                  let interrupt = false;
                  if (
                    url.pathname === "/rest/v1/rpc/commit_booking_completion"
                  ) {
                    completionWrites += 1;
                    const input = JSON.parse(
                      Buffer.from(body).toString("utf8"),
                    ) as { target_booking_request_id: string };
                    if (
                      input.target_booking_request_id === request &&
                      faultAcknowledgement
                    ) {
                      faultAcknowledgement = false;
                      interrupt = true;
                    }
                  }
                  const response = await fetch(
                    new URL(url.pathname + url.search, localOrigin),
                    {
                      method: outbound.method,
                      headers: Object.fromEntries(outbound.headers),
                      body,
                      redirect: "error",
                    },
                  );
                  if (interrupt) {
                    if (!response.ok)
                      throw new Error(
                        "Controlled real completion commit failed",
                      );
                    await response.arrayBuffer();
                    interruptedAcknowledgements += 1;
                    committed!();
                    await acknowledgement;
                    return NativeResponse.json(
                      {
                        message:
                          "Controlled completion acknowledgement interrupted",
                      },
                      { status: 503 },
                    );
                  }
                  return new NativeResponse(
                    response.body === null
                      ? null
                      : await response.arrayBuffer(),
                    {
                      status: response.status,
                      headers: Object.fromEntries(response.headers),
                    },
                  );
                },
              },
            },
          },
        ],
      });
    const invoke = (worker: Miniflare) =>
      worker.dispatchFetch(
        "http://localhost/cdn-cgi/local/scheduled?format=json&cron=%2A%20%2A%20%2A%20%2A%20%2A",
      );
    let runtime: Miniflare | undefined;
    let fresh: Miniflare | undefined;
    const overlapping: ReturnType<typeof invoke>[] = [];
    try {
      runtime = createWorker();
      const corrupt = await invoke(runtime);
      expect(corrupt.status).toBe(500);
      expect(await corrupt.json()).not.toMatchObject({ outcome: "ok" });
      expect(malformedLists).toBe(1);
      expect(completionWrites).toBe(0);
      expect(observe()).toEqual(before);
      malformed = false;
      let firstSettled = false;
      const first = invoke(runtime).then((response) => {
        firstSettled = true;
        return response;
      });
      overlapping.push(first);
      expect(
        await Promise.race([
          realCommit.then(() => "committed"),
          first.then(() => "finished"),
        ]),
      ).toBe("committed");
      const durable = observe();
      expect(durable.outcomes).toHaveLength(1);
      expect(durable.outcomes[0]).toMatchObject({
        outcome: "completed",
        effective_period_end: before.end,
      });
      expect(durable.original).toEqual(before.original);
      const second = invoke(runtime);
      overlapping.push(second);
      const secondResult = await second;
      expect(secondResult.status).toBe(200);
      expect(await secondResult.json()).toMatchObject({ outcome: "ok" });
      expect(firstSettled).toBe(false);
      releaseAcknowledgement!();
      const interrupted = await first;
      expect(interrupted.status).toBe(500);
      expect(await interrupted.json()).not.toMatchObject({ outcome: "ok" });
      expect(interruptedAcknowledgements).toBe(1);
      const afterOverlap = observe();
      expect(afterOverlap.outcomes).toEqual(durable.outcomes);
      expect(afterOverlap.maturity).toHaveLength(1);
      expect(afterOverlap.maturity[0]).toMatchObject({
        outcome: "completed",
        effective_period_end: before.end,
      });
      expect(afterOverlap.end).toBe(before.end);
      expect(afterOverlap.original).toEqual(before.original);
      const overlapNotices = notices();
      await runtime.dispose();
      runtime = undefined;
      fresh = createWorker();
      const recovered = await invoke(fresh);
      expect(recovered.status).toBe(200);
      expect(await recovered.json()).toMatchObject({ outcome: "ok" });
      expect(observe()).toEqual(afterOverlap);
      const finalNotices = notices();
      expect(finalNotices).toEqual(overlapNotices);
      expect(finalNotices.receipts).toEqual(initialNotices.receipts);
      expect(finalNotices.reminders).toEqual(initialNotices.reminders);
      expect(finalNotices.work).toHaveLength(4);
      expect(finalNotices.effects).toHaveLength(2);
      for (const receipt of initialNotices.receipts) {
        const delivered = finalNotices.work.filter(
          (work) => work.notification_id === receipt.id,
        );
        const effects = finalNotices.effects.filter(
          (effect) => effect.notification_id === receipt.id,
        );
        expect(delivered).toHaveLength(1);
        expect(effects).toHaveLength(1);
        expect(delivered[0]).toMatchObject({
          receipt_id: receipt.id,
          event_id: null,
          recipient_user_id: receipt.recipient,
          recipient_role: receipt.role,
          logical_id: `paid-confirmation:${receipt.id}`,
          state: "delivered",
          payload: { fictional: true },
          supplier_delivery_reference: effects[0].supplier_delivery_reference,
        });
        expect(effects[0]).toMatchObject({
          supplier: "fictional-notifications",
          environment: "hosted-demo-yvibcyqtyihpzpmomnzg",
          receipt_id: receipt.id,
          recipient_user_id: receipt.recipient,
          recipient_role: receipt.role,
          logical_id: `paid-confirmation:${receipt.id}`,
          payload: delivered[0].payload,
        });
      }
      for (const reminder of initialNotices.reminders) {
        const suppressed = finalNotices.work.filter(
          (work) => work.notification_id === reminder.id,
        );
        expect(suppressed).toHaveLength(1);
        expect(suppressed[0]).toMatchObject({
          event_id: reminder.id,
          state: "suppressed",
          recipient_user_id: reminder.recipient,
          recipient_role: reminder.role,
          logical_id: `booking-event:${reminder.id}`,
          supplier_delivery_reference: null,
        });
        expect(
          finalNotices.effects.filter(
            (effect) => effect.notification_id === reminder.id,
          ),
        ).toEqual([]);
      }
    } finally {
      releaseAcknowledgement?.();
      await Promise.allSettled(overlapping);
      await runtime?.dispose();
      await fresh?.dispose();
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
      page
        .getByLabel("Booking lifecycle")
        .getByText(lifecycle.en.reviewOpen, { exact: false }),
    ).toBeVisible();
    await page.goto("/en/bookings");
    await expect(
      page
        .getByRole("listitem")
        .filter({ has: page.getByRole("link", { name: /Preserved Cottage/ }) }),
    ).toContainText(lifecycle.en.completed);
    await assertLifecycleViews(page, "customer", "completed");
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
    await assertLifecycleViews(page, "cottage_owner", "incident_pending");
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
    await assertLifecycleViews(page, "platform_administrator", "no_show");
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
