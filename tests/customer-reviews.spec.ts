import { writeFile } from "node:fs/promises";
import { observeRecordHeading } from "./fixtures/record-heading";
import {
  expect,
  test,
  type Locator,
  type Page,
  type Response,
} from "@playwright/test";
import { accessMessages } from "../src/i18n/access-messages";
import { openHeaderPanel } from "./fixtures/site-header";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import * as OTPAuth from "otpauth";
import { administratorQueuesMessages } from "../src/i18n/administrator-queues-messages";
import { administratorRecordsMessages } from "../src/i18n/administrator-records-messages";
import { messagingMessages } from "../src/i18n/messaging-messages";
import { bookingLifecycleMessages } from "../src/i18n/booking-lifecycle-messages";
import { customerReviewMessages } from "../src/i18n/customer-review-messages";
import type { Locale } from "../src/i18n/routing";

type ReviewFixture = {
  sql: string;
  ids: {
    administratorUserId: string;
    bookingReference: string;
    customerUserId: string;
    otherCustomerUserId: string;
    ownerUserId: string;
    profileId: string;
    requestId: string;
  };
  publicSlug: string;
};

type CustomerReviewFixtureModule = {
  customerReviewFixture(input: {
    namespace: string;
    startDaySql: string;
    complete: boolean;
    confirm?: boolean;
    publish: boolean;
    sharedCottage?: {
      namespace: string;
      ownerUserId: string;
      profileId: string;
      publicSlug: string;
    };
  }): ReviewFixture;
};
const customerReviewFixtureModule: Promise<CustomerReviewFixtureModule> =
  import(
    // @ts-expect-error The repository fixture is an ESM JavaScript module without declarations.
    "../scripts/lib/customer-review-fixture.mjs"
  );
const { createLocalSupabaseConcurrencyHarness } = createRequire(
  import.meta.url,
)("../scripts/local-supabase-concurrency-harness.mjs") as {
  createLocalSupabaseConcurrencyHarness(): {
    guardDisposableLocalDatabase(): void;
    runSql(sql: string): string;
  };
};
type AccessFixtureUser = { id: string; phone?: string | null };
const { findAccessFixtureUser, listAllAccessFixtureUsers } = createRequire(
  import.meta.url,
)("../scripts/lib/access-fixture-users.mjs") as {
  findAccessFixtureUser(
    users: AccessFixtureUser[],
    phone: string,
  ): AccessFixtureUser | undefined;
  listAllAccessFixtureUsers(admin: unknown): Promise<AccessFixtureUser[]>;
};
const { customerReviewCleanup } = createRequire(import.meta.url)(
  "../scripts/lib/booking-fixture.mjs",
) as {
  customerReviewCleanup(
    namespace: string,
    options?: { reusedAuthUsers?: readonly string[] },
  ): string;
};

const namespaces = {
  mobile: ["61", "64"],
  desktop: ["62", "65"],
  worker: ["63", "66"],
} as const;
const paginationNamespaces = {
  mobile: [
    ...Array.from({ length: 9 }, (_, index) =>
      String(index + 1).padStart(2, "0"),
    ),
    "69",
    "70",
    ...Array.from({ length: 8 }, (_, index) => String(index + 12)),
  ],
  desktop: [
    ...Array.from({ length: 14 }, (_, index) => String(index + 21)),
    "71",
    "36",
    "37",
    "67",
    "68",
  ],
  worker: [
    "72",
    ...Array.from({ length: 18 }, (_, index) => String(index + 42)),
  ],
} as const;
const upcomingNamespaces = {
  mobile: "20",
  desktop: "40",
  worker: "60",
} as const;
const administratorReturnNamespaces = {
  mobile: "73",
  desktop: "74",
  worker: "75",
} as const;
const replyNamespaces = { mobile: "76", desktop: "77", worker: "78" } as const;
const ownerReviewsNamespaces = {
  mobile: ["79", "80", "81"],
  desktop: ["82", "83", "84"],
  worker: ["85", "86", "87"],
} as const;
const password = "Local-test-password-2026";

const administratorReturnLocales = [
  {
    locale: "en",
    languageName: "English",
    direction: "ltr",
    accessTitle: "Platform Administrator access",
    email: "Email",
    password: "Password",
    continue: "Continue",
    phone: "Iraqi phone number",
    mfaCode: "Authenticator app code",
    verify: "Verify",
    invalidCode: "The verification code could not be confirmed.",
    queueTitle: "Customer review moderation",
    accessRequired: "Authenticator-verified administrator access is required.",
    accessAction: "Complete administrator access",
  },
  {
    locale: "ar",
    languageName: "العربية",
    direction: "rtl",
    accessTitle: "دخول مسؤول المنصة",
    email: "البريد الإلكتروني",
    password: "كلمة المرور",
    continue: "متابعة",
    phone: "رقم الهاتف العراقي",
    mfaCode: "رمز تطبيق المصادقة",
    verify: "تحقق",
    invalidCode: "تعذر التحقق من الرمز.",
    queueTitle: "إدارة تقييمات العملاء",
    accessRequired: "يلزم دخول مسؤول موثّق بتطبيق المصادقة.",
    accessAction: "إكمال دخول المسؤول",
  },
  {
    locale: "ckb",
    languageName: "کوردی",
    direction: "rtl",
    accessTitle: "چوونەژوورەوەی بەڕێوەبەری پلاتفۆرم",
    email: "ئیمەیڵ",
    password: "وشەی نهێنی",
    continue: "بەردەوام بە",
    phone: "ژمارە تەلەفۆنی عێراقی",
    mfaCode: "کۆدی ئەپی پشتڕاستکەرەوە",
    verify: "پشتڕاست بکەرەوە",
    invalidCode: "کۆدەکە پشتڕاست نەکرایەوە.",
    queueTitle: "بەڕێوەبردنی هەڵسەنگاندنی کڕیاران",
    accessRequired:
      "دەستگەیشتنی بەڕێوەبەر کە بە ئەپی پشتڕاستکەرەوە پشتڕاست کراوەتەوە پێویستە.",
    accessAction: "چوونەژوورەوەی بەڕێوەبەر تەواو بکە",
  },
] as const;

function requireLocalDatabase() {
  const target = new URL(process.env.SUPABASE_URL ?? "invalid:");
  if (
    process.env.APP_ENVIRONMENT !== "test" ||
    target.protocol !== "http:" ||
    target.hostname !== "127.0.0.1"
  ) {
    throw new Error(
      "Customer review journey requires the guarded local database",
    );
  }
}

function reviewFixtureCleanup(
  namespace: string,
  identities: { owner?: string; customer?: string; other?: string },
) {
  const reusedAuthUsers = Object.values(identities).filter(
    (user): user is string => user !== undefined,
  );
  if (
    reusedAuthUsers.some(
      (user) =>
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          user,
        ),
    )
  )
    throw new Error("Customer review cleanup auth identity is invalid");
  return customerReviewCleanup(namespace, { reusedAuthUsers });
}

async function seedFixture(
  namespace: string,
  options: {
    clearFirst?: boolean;
    complete?: boolean;
    confirm?: boolean;
    sharedCottage?: {
      namespace: string;
      ownerUserId: string;
      profileId: string;
      publicSlug: string;
    };
    startDaySql?: string;
  } = {},
) {
  const { customerReviewFixture } = await customerReviewFixtureModule;
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret)
    throw new Error("Customer review fixture credentials are missing");
  const privileged = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const ensurePhoneUser = async (phone: string) => {
    const users = await listAllAccessFixtureUsers(privileged.auth.admin);
    const existing = findAccessFixtureUser(users, phone);
    if (existing) {
      const updated = await privileged.auth.admin.updateUserById(existing.id, {
        password,
        phone_confirm: true,
      });
      if (updated.error) throw updated.error;
      return existing.id;
    }
    const created = await privileged.auth.admin.createUser({
      phone,
      password,
      phone_confirm: true,
    });
    if (created.error) throw created.error;
    return created.data.user.id;
  };
  const fixture = customerReviewFixture({
    namespace,
    startDaySql:
      options.startDaySql ??
      `((clock_timestamp() at time zone 'Asia/Baghdad')::date-${options.sharedCottage ? 5 : 3})`,
    complete: options.complete ?? true,
    confirm: options.confirm,
    publish: !options.sharedCottage,
    sharedCottage: options.sharedCottage,
  });
  const phones = {
    owner: `+964757000${namespace}01`,
    customer: `+964757000${namespace}02`,
    other: `+964757000${namespace}03`,
  };
  const identities = {
    owner:
      options.sharedCottage?.ownerUserId ??
      (await ensurePhoneUser(phones.owner)),
    customer: await ensurePhoneUser(phones.customer),
    other: await ensurePhoneUser(phones.other),
  };
  const authBlock =
    /insert into auth\.users \(id, aud, role, phone, phone_confirmed_at\) values[\s\S]*?;\ninsert into public\.account_contexts/;
  const legacyItems =
    '"items":[{"serviceDay":"2101-01-01","kind":"shift","position":1,"startsAt":"2101-01-01T08:00:00+03:00"},{"serviceDay":"2101-01-01","kind":"shift","position":3},{"serviceDay":"2101-01-02","kind":"full_day_bundle"}]';
  const renderedItems =
    '"items":[{"serviceDay":"2101-01-01","kind":"shift","position":1,"displayName":"Morning","startsAt":"2101-01-01T08:00:00+03:00","endsAt":"2101-01-01T12:00:00+03:00","crossesMidnight":false,"priceIqd":30000},{"serviceDay":"2101-01-01","kind":"shift","position":3,"displayName":"Night","startsAt":"2101-01-01T20:00:00+03:00","endsAt":"2101-01-02T02:00:00+03:00","crossesMidnight":true,"priceIqd":30000},{"serviceDay":"2101-01-02","kind":"full-day","displayName":"Full day","startsAt":"2101-01-02T08:00:00+03:00","endsAt":"2101-01-03T02:00:00+03:00","crossesMidnight":true,"priceIqd":50000}]';
  let sql = fixture.sql
    .replace(authBlock, "insert into public.account_contexts")
    .replaceAll(
      '"cottageName":"Preserved Cottage","bookingPriceIqd"',
      '"cottageName":"Fictional Preserved Cottage","houseRules":"Fictional house rules","bookingPriceIqd"',
    )
    .replaceAll(legacyItems, renderedItems);
  const thirdDateAnchor = "fixture:=replace(fixture,'2101-01-02'";
  if (sql.split(thirdDateAnchor).length - 1 !== 1)
    throw new Error("Customer review third-date substitution fixture changed");
  sql = sql.replace(
    thirdDateAnchor,
    "fixture:=replace(fixture,'2101-01-03',(start_day+2)::text); " +
      thirdDateAnchor,
  );
  for (const [original, fictional] of [
    ["Confirmation Cottage", "Fictional Confirmation Cottage"],
    ["Review Cottage", "Fictional Review Cottage"],
    ["Karrada", "Fictional approximate location"],
    ["Private address", "Fictional private address"],
    ["Fixture description", "Fictional fixture description"],
    ["Fixture rules", "Fictional fixture rules"],
    ["Review fixture description", "Fictional review fixture description"],
    ["Review fixture rules", "Fictional review fixture rules"],
    ["English description", "Fictional English description"],
    ["English rules", "Fictional English rules"],
    ["وصف عربي", "وصف عربي خيالي"],
    ["قواعد عربية", "قواعد عربية خيالية"],
    ["وەسفی کوردی", "وەسفی کوردی خەیاڵی"],
    ["یاساکانی کوردی", "یاساکانی کوردی خەیاڵی"],
  ]) {
    if (!options.sharedCottage && !sql.includes(original))
      throw new Error(
        `Customer review fictional fixture anchor missing: ${original}`,
      );
    sql = sql.replaceAll(original, fictional);
  }
  if (sql === fixture.sql)
    throw new Error("Customer review auth fixture block changed");
  if (!sql.includes(renderedItems) || sql.includes(legacyItems)) {
    throw new Error("Customer review booking presentation fixture changed");
  }
  sql = sql
    .replaceAll(
      fixture.ids.ownerUserId,
      options.sharedCottage?.ownerUserId ?? identities.owner,
    )
    .replaceAll(fixture.ids.customerUserId, identities.customer)
    .replaceAll(fixture.ids.otherCustomerUserId, identities.other);
  const harness = createLocalSupabaseConcurrencyHarness();
  harness.guardDisposableLocalDatabase();
  if (options.clearFirst)
    harness.runSql(reviewFixtureCleanup(namespace, identities));
  harness.runSql(sql);
  const sourceProof = harness.runSql(`select jsonb_build_object(
    'requestCount',(select count(*) from public.booking_requests counted
      where counted.id=requests.id),
    'endpointMatches',(snapshots.quote_payload#>>'{items,2,endsAt}')::timestamptz
      =upper(range_merge(commitments.access_ranges)),
    'endNextDay',((snapshots.quote_payload#>>'{items,2,endsAt}')::timestamptz
      at time zone 'Asia/Baghdad')::date
      =(snapshots.quote_payload#>>'{items,2,serviceDay}')::date+1,
    'crossesMidnight',(snapshots.quote_payload#>>'{items,2,crossesMidnight}')::boolean,
    'payment',public.booking_request_payment_status(requests),
    'completion',(public.booking_completion_eligibility_at(requests.id,clock_timestamp())->>'status'),
    'discoverable',public.is_cottage_publicly_discoverable(requests.profile_id)
  ) from public.booking_requests requests
  join public.booking_snapshots snapshots on snapshots.id=requests.booking_snapshot_id
  join public.cottage_booking_period_commitments commitments
    on commitments.id=requests.booking_period_commitment_id
  where requests.booking_request_reference='${fixture.ids.bookingReference}';`);
  expect(JSON.parse(sourceProof)).toEqual({
    requestCount: 1,
    endpointMatches: true,
    endNextDay: true,
    crossesMidnight: true,
    payment: "paid-confirmed",
    completion: options.complete === false ? "unavailable" : "completed",
    discoverable: true,
  });
  return { ...fixture, identities, phones, harness };
}

async function signInPhone(page: Page, phone: string, returnTo: string) {
  const client = createClient(
    process.env.SUPABASE_URL ?? "",
    process.env.SUPABASE_PUBLISHABLE_KEY ?? "",
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const signedIn = await client.auth.signInWithPassword({ phone, password });
  if (signedIn.error || !signedIn.data.session) {
    throw signedIn.error ?? new Error("Customer review session is missing");
  }
  const named = await client.rpc("save_account_name", {
    account_first_name: "Lana",
  });
  if (named.error) throw named.error;
  const origin =
    process.env.PLAYWRIGHT_SERVER === "worker"
      ? `http://127.0.0.1:${process.env.PLAYWRIGHT_WORKER_PORT ?? "8788"}`
      : `http://127.0.0.1:${process.env.PLAYWRIGHT_NEXT_PORT ?? "3000"}`;
  await page.context().addCookies([
    {
      name: "rentcottage-auth",
      value: `base64-${Buffer.from(JSON.stringify(signedIn.data.session)).toString("base64url")}`,
      url: origin,
      httpOnly: false,
      sameSite: "Lax",
    },
  ]);
  await page.goto(returnTo);
  await expect(page).toHaveURL(returnTo);
}

async function provisionAdministrator(purpose: string) {
  requireLocalDatabase();
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret)
    throw new Error("Customer review administrator credentials are missing");
  const administratorClient = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `${purpose}-${randomUUID()}@rentcottage.test`;
  const { data, error: createError } =
    await administratorClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
  if (createError || !data.user) {
    throw new Error("Customer review administrator fixture creation failed", {
      cause: createError,
    });
  }
  const { error: provisionError } = await administratorClient.rpc(
    "provision_platform_administrator",
    { target_user_id: data.user.id },
  );
  if (provisionError) {
    throw new Error(
      "Customer review administrator fixture provisioning failed",
      { cause: provisionError },
    );
  }
  createLocalSupabaseConcurrencyHarness().runSql(
    `insert into public.account_names (user_id, first_name) values ('${data.user.id}', 'Sara') on conflict (user_id) do update set first_name = excluded.first_name;`,
  );
  return { email, userId: data.user.id };
}

async function beginAdministratorMfa(
  page: Page,
  email: string,
  copy: (typeof administratorReturnLocales)[number],
) {
  await page.getByLabel(copy.email).fill(email);
  await page.getByLabel(copy.password).fill(password);
  await page.getByRole("button", { name: copy.continue }).press("Enter");
  const secret = await page.getByTestId("mfa-secret").textContent();
  if (!secret)
    throw new Error("Customer review administrator MFA returned no secret");
  return secret;
}

async function expectAdministratorEmailAccess(
  page: Page,
  copy: (typeof administratorReturnLocales)[number],
) {
  await expect(
    page.getByRole("heading", { name: copy.accessTitle }),
  ).toBeVisible();
  await expect(page.getByLabel(copy.email)).toBeVisible();
  await expect(page.getByLabel(copy.phone)).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("dir", copy.direction);
}

async function signedInPhoneClient(phone: string) {
  const client = createClient(
    process.env.SUPABASE_URL ?? "",
    process.env.SUPABASE_PUBLISHABLE_KEY ?? "",
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const signedIn = await client.auth.signInWithPassword({ phone, password });
  if (signedIn.error) throw signedIn.error;
  return client;
}

async function expectIdentityDenied(phone: string, bookingReference: string) {
  const client = await signedInPhoneClient(phone);
  const response = await client.rpc("get_customer_review", {
    target_reference: bookingReference,
  });
  expect(response.error?.code).toBe("42501");
}

async function expectOwnerReviewDenied(
  phone: string,
  bookingReference: string,
) {
  const client = await signedInPhoneClient(phone);
  const read = await client.rpc("get_owner_customer_review", {
    target_reference: bookingReference,
  });
  expect(read.error?.code).toBe("42501");
  const reply = await client.rpc("submit_customer_review_reply", {
    target_reference: bookingReference,
    target_original_language: "en",
    target_original_body: "Denied reply",
  });
  expect(reply.error?.code).toBe("42501");
}

async function openAdministratorReview(
  page: Page,
  bookingReference: string,
  locale: Locale = "en",
) {
  const visitedAdministratorPages = new Set<string>();
  let targetAdministratorPage: string | undefined;
  while (true) {
    expect(visitedAdministratorPages.has(page.url())).toBe(false);
    visitedAdministratorPages.add(page.url());
    if (
      (await page
        .getByRole("article")
        .filter({ hasText: bookingReference })
        .count()) === 1
    ) {
      targetAdministratorPage = page.url();
    }
    const next = page.getByRole("link", {
      name: customerReviewMessages[locale].next,
    });
    if ((await next.count()) === 0) break;
    const nextHref = await next.getAttribute("href");
    if (!nextHref)
      throw new Error("Administrator review pagination returned no href");
    const nextUrl = new URL(nextHref, page.url()).href;
    await next.click();
    await expect(page).toHaveURL(nextUrl);
  }
  expect(targetAdministratorPage).toBeDefined();
  await page.goto(targetAdministratorPage!);
  return page.getByRole("article").filter({ hasText: bookingReference });
}

// WCAG 2.2 Success Criterion 2.5.8 sets the 24 by 24 CSS pixel minimum.
async function captureReviewFilters(page: Page, locale: Locale) {
  const records = administratorRecordsMessages[locale];
  const controls = [
    page.getByLabel(records.status),
    page.getByLabel(records.from),
    page.getByLabel(records.through),
    page.getByRole("button", {
      name: administratorQueuesMessages[locale].apply,
      exact: true,
    }),
    page.getByRole("link", { name: records.reset, exact: true }),
  ];
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
        .outputPath(`reviews-filtered-${locale}-${viewport}.png`),
    });
  }
  await page.setViewportSize(original!);
}

function anchoredServiceDay(anchor: string, offset: number) {
  expect(anchor).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  const operator = offset < 0 ? "-" : "+";
  return `'${anchor}'::date${operator}${Math.abs(offset)}`;
}

test("connected completed stay from messaging to review", async ({
  page,
  browser,
}, testInfo) => {
  requireLocalDatabase();
  testInfo.annotations.push({
    type: "fixed suppliers",
    description:
      "SQL capture succeeds with fictional-payments/local-test provenance; local Auth confirms synthetic identities without SMS; messaging translations are deterministic fictional fixtures and unsupported text retains its original. No notification delivery or external map request is claimed.",
  });
  const namespace = { mobile: "90", desktop: "91", worker: "92" }[
    testInfo.project.name
  ];
  if (!namespace) throw new Error("Connected completion project is unmapped");
  const requestId = `60000000-0000-4000-8000-00000000${namespace}01`;
  const attemptId = `70000000-0000-4000-8000-00000000${namespace}01`;
  const harness = createLocalSupabaseConcurrencyHarness();
  harness.guardDisposableLocalDatabase();
  const privileged = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const cleanup = async () => {
    const conversationIds = JSON.parse(
      harness.runSql(`select coalesce(jsonb_agg(links.conversation_id),'[]'::jsonb)
      from public.messaging_conversation_booking_requests links
      where links.booking_request_id='${requestId}';`),
    ) as string[];
    for (const id of conversationIds) expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const users = await listAllAccessFixtureUsers(privileged.auth.admin);
    harness.runSql(
      reviewFixtureCleanup(namespace, {
        owner: findAccessFixtureUser(users, `+964757000${namespace}01`)?.id,
        customer: findAccessFixtureUser(users, `+964757000${namespace}02`)?.id,
        other: findAccessFixtureUser(users, `+964757000${namespace}03`)?.id,
      }),
    );
    const ids = conversationIds.map((id) => `'${id}'`).join(",");
    const removed = JSON.parse(
      harness.runSql(`select jsonb_build_object(
      'requests',(select count(*) from public.booking_requests where id='${requestId}'),
      'reviews',(select count(*) from public.customer_reviews where booking_request_id='${requestId}'),
      'maturity',(select count(*) from public.booking_completion_maturity where booking_request_id='${requestId}'),
      'outcomes',(select count(*) from public.booking_lifecycle_outcomes where booking_request_id='${requestId}'),
      'attempts',(select count(*) from public.booking_request_submission_attempts where id='${attemptId}'),
      'links',(select count(*) from public.messaging_conversation_booking_requests where booking_request_id='${requestId}'),
      'conversations',(select count(*) from public.messaging_conversations where id=any(array[${ids}]::uuid[])),
      'messages',(select count(*) from public.messaging_messages where conversation_id=any(array[${ids}]::uuid[])),
      'sendAttempts',(select count(*) from public.messaging_send_attempts where conversation_id=any(array[${ids}]::uuid[]))
    );`),
    );
    expect(removed).toEqual({
      requests: 0,
      reviews: 0,
      maturity: 0,
      outcomes: 0,
      attempts: 0,
      links: 0,
      conversations: 0,
      messages: 0,
      sendAttempts: 0,
    });
  };
  const readBooking = () => {
    const rows = JSON.parse(
      harness.runSql(`select jsonb_agg(jsonb_build_object(
      'requestId',requests.id,'profileId',requests.profile_id,'customerId',requests.customer_user_id,
      'confirmationId',confirmations.id,
      'snapshot',to_jsonb(snapshots),'ranges',commitments.access_ranges::text,
      'periodEnd',upper(range_merge(commitments.access_ranges)),
      'payment',public.booking_request_payment_status(requests),
      'eligibility',public.booking_completion_eligibility_at(requests.id,clock_timestamp()),
      'maturityCount',(select count(*) from public.booking_completion_maturity where booking_request_id=requests.id),
      'outcomeCount',(select count(*) from public.booking_lifecycle_outcomes where booking_request_id=requests.id),
      'reviewCount',(select count(*) from public.customer_reviews where booking_request_id=requests.id)
    )) from public.booking_requests requests
    join public.booking_snapshots snapshots on snapshots.id=requests.booking_snapshot_id
    join public.booking_confirmations confirmations on confirmations.booking_request_id=requests.id
    join public.cottage_booking_period_commitments commitments on commitments.id=requests.booking_period_commitment_id
    where requests.id='${requestId}';`),
    );
    expect(rows).toHaveLength(1);
    return rows[0];
  };
  const readConversation = (conversationId: string) => {
    const rows = JSON.parse(
      harness.runSql(`select jsonb_agg(jsonb_build_object(
      'conversation',to_jsonb(conversations),'link',to_jsonb(links),
      'attemptConversationId',attempts.conversation_id,
      'messages',(select jsonb_agg(to_jsonb(messages) order by messages.position)
        from public.messaging_messages messages where messages.conversation_id=conversations.id),
      'sendCount',(select count(*) from public.messaging_send_attempts where conversation_id=conversations.id)
    )) from public.messaging_conversations conversations
    join public.messaging_conversation_booking_requests links on links.conversation_id=conversations.id
    join public.booking_request_submission_attempts attempts on attempts.id=links.submission_attempt_id
    where conversations.id='${conversationId}' and links.booking_request_id='${requestId}';`),
    );
    expect(rows).toHaveLength(1);
    return rows[0];
  };
  for (const locale of ["en", "ar", "ckb"] as const) {
    await cleanup();
    let visitorContext:
      | Awaited<ReturnType<typeof browser.newContext>>
      | undefined;
    try {
      // The database's Baghdad date supplies a delayed-completion fixture, with no clock override.
      const anchor = harness.runSql(
        "select (clock_timestamp() at time zone 'Asia/Baghdad')::date;",
      );
      const fixture = await seedFixture(namespace, {
        complete: false,
        confirm: true,
        startDaySql: anchoredServiceDay(anchor, -3),
      });
      expect(fixture.ids.requestId).toBe(requestId);
      const before = readBooking();
      expect(before).toMatchObject({
        requestId,
        profileId: fixture.ids.profileId,
        customerId: fixture.identities.customer,
        payment: "paid-confirmed",
        maturityCount: 0,
        outcomeCount: 0,
        reviewCount: 0,
        eligibility: { status: "unavailable", reviewAvailable: false },
      });
      expect(before.snapshot.quote_payload.cottageName).toBe(
        "Fictional Preserved Cottage",
      );
      const customerClient = await signedInPhoneClient(fixture.phones.customer);
      const reviewBefore = await customerClient.rpc("get_customer_review", {
        target_reference: fixture.ids.bookingReference,
      });
      expect(reviewBefore.error).toBeNull();
      expect(reviewBefore.data).toEqual({ status: "ineligible" });
      const copy = customerReviewMessages[locale];
      const messaging = messagingMessages[locale];
      const lifecycle = bookingLifecycleMessages[locale];
      const statusWords = {
        en: { confirmed: "Confirmed booking", completed: "Completed booking" },
        ar: { confirmed: "حجز مؤكد", completed: "حجز مكتمل" },
        ckb: { confirmed: "حجزی پشتڕاستکراو", completed: "حجزی تەواوکراو" },
      }[locale];
      const direction = locale === "en" ? "ltr" : "rtl";
      const bookingPath = `/${locale}/booking-requests/${fixture.ids.bookingReference}`;
      await signInPhone(page, fixture.phones.customer, bookingPath);
      await expect(page.locator("html")).toHaveAttribute("dir", direction);
      const lifecycleRegion = page.getByRole("region", {
        name: lifecycle.title,
      });
      await expect(
        lifecycleRegion.getByText(lifecycle.confirmed, { exact: true }),
      ).toBeVisible();
      const reviewRegion = page.getByRole("region", { name: copy.title });
      await expect(reviewRegion).toContainText(copy.ineligible);
      await expect(
        reviewRegion.getByRole("button", { name: copy.submit }),
      ).toHaveCount(0);
      const open = page.getByRole("button", { name: messaging.open });
      await open.focus();
      await expect(open).toBeFocused();
      await open.press("Enter");
      await expect(page).toHaveURL(
        new RegExp(`/${locale}/messages/[0-9a-f-]{36}`),
      );
      const conversationUrl = page.url();
      const conversationId = new URL(conversationUrl).pathname
        .split("/")
        .at(-1)!;
      expect(conversationId).toMatch(/^[0-9a-f-]{36}$/);
      await expect(
        page.getByText(
          `${fixture.ids.bookingReference} · ${statusWords.confirmed}`,
          { exact: true },
        ),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", {
          name: "Fictional Preserved Cottage",
          level: 1,
        }),
      ).toBeFocused();
      const messages = page.getByRole("list", { name: messaging.messages });
      await expect(messages.getByRole("listitem")).toHaveCount(0);
      const sourceLanguage = locale === "en" ? "ar" : "en";
      const original =
        sourceLanguage === "ar"
          ? "مثال خيالي <dialog open data-connected-message>نص خيالي</dialog> & <em>حرفي</em>"
          : "Fictional example <dialog open data-connected-message>fictional text</dialog> & <em>literal</em>";
      await page
        .getByLabel(messaging.languageLabel)
        .selectOption(sourceLanguage);
      await page
        .getByLabel(messaging.messageLabel, { exact: true })
        .fill(original);
      const send = page.getByRole("button", {
        name: messaging.send,
        exact: true,
      });
      await send.focus();
      await expect(send).toBeFocused();
      await send.press("Enter");
      await expect(messages.getByRole("listitem")).toHaveCount(1);
      const message = messages.getByRole("listitem");
      await expect(message.getByText(original, { exact: true })).toBeVisible();
      await expect(
        message.locator("dialog,em,[data-connected-message]"),
      ).toHaveCount(0);
      await message
        .getByRole("button", {
          name: messaging.automaticTranslation,
          exact: true,
        })
        .click();
      await expect(message).toContainText(messaging.translationUnavailable);
      await expect(message.getByText(original, { exact: true })).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("dir", direction);
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        )
        .toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(
          `connected-messaging-${locale}-${testInfo.project.name}.png`,
        ),
        fullPage: true,
      });
      const conversationBefore = readConversation(conversationId);
      expect(conversationBefore).toMatchObject({
        conversation: {
          id: conversationId,
          customer_user_id: fixture.identities.customer,
          owner_user_id: fixture.identities.owner,
          profile_id: fixture.ids.profileId,
        },
        link: {
          conversation_id: conversationId,
          booking_request_id: requestId,
          submission_attempt_id: attemptId,
        },
        attemptConversationId: conversationId,
        sendCount: 1,
      });
      expect(conversationBefore.messages).toHaveLength(1);
      expect(conversationBefore.messages[0]).toMatchObject({
        conversation_id: conversationId,
        original_body: original,
        original_language: sourceLanguage,
      });
      const candidates = JSON.parse(
        harness.runSql(`begin; set local role service_role;
        select coalesce(jsonb_agg(candidate),'[]'::jsonb) from public.list_due_booking_completions(50) candidate
        where candidate->>'bookingRequestId'='${requestId}'; commit;`),
      );
      expect(candidates).toHaveLength(1);
      expect(candidates[0]).toMatchObject({
        bookingRequestId: requestId,
        action: "complete",
        effectivePeriodEnd: before.periodEnd,
      });
      expect(candidates[0].revision).toMatch(/^[0-9a-f]{32}$/);
      const completed = JSON.parse(
        harness.runSql(`begin; set local role service_role;
        select public.commit_booking_completion('${requestId}','${candidates[0].revision}'); commit;`),
      );
      expect(completed).toMatchObject({
        status: "completed",
        bookingRequestId: requestId,
        effectivePeriodEnd: before.periodEnd,
      });
      const after = readBooking();
      expect(after).toMatchObject({
        requestId,
        profileId: before.profileId,
        customerId: before.customerId,
        snapshot: before.snapshot,
        ranges: before.ranges,
        periodEnd: before.periodEnd,
        payment: "paid-confirmed",
        maturityCount: 1,
        outcomeCount: 1,
        reviewCount: 0,
        eligibility: {
          status: "completed",
          reviewAvailable: true,
          effectivePeriodEnd: before.periodEnd,
        },
      });
      expect(
        Date.parse(after.eligibility.reviewExpiresAt) -
          Date.parse(before.periodEnd),
      ).toBe(14 * 24 * 60 * 60 * 1000);
      const reviewAfter = await customerClient.rpc("get_customer_review", {
        target_reference: fixture.ids.bookingReference,
      });
      expect(reviewAfter.error).toBeNull();
      expect(reviewAfter.data).toEqual({
        status: "eligible",
        reviewExpiresAt: after.eligibility.reviewExpiresAt,
      });
      await page.goto(bookingPath);
      await expect(
        lifecycleRegion.getByText(lifecycle.completed, { exact: true }),
      ).toBeVisible();
      await expect(reviewRegion).toContainText(copy.eligibleUntil);
      const reviewBody = `Fictional ${locale} review <dialog open data-connected-review>fictional example</dialog> & <em>literal</em>`;
      const rating = reviewRegion.getByRole("radio", {
        name: `5 ${copy.ratingValue}`,
        exact: true,
      });
      await rating.focus();
      await expect(rating).toBeFocused();
      await rating.press("Space");
      await expect(rating).toBeChecked();
      await page.getByLabel(copy.body).fill(reviewBody);
      await page.getByLabel(copy.language).selectOption(sourceLanguage);
      const publish = page.getByRole("button", {
        name: copy.submit,
        exact: true,
      });
      await publish.focus();
      await expect(publish).toBeFocused();
      await publish.press("Enter");
      await expect(
        page.getByRole("status").filter({ hasText: copy.published }),
      ).toBeVisible();
      await page.reload();
      const authorReview = page.getByRole("region", { name: copy.submitted });
      await expect(
        authorReview.getByText(reviewBody, { exact: true }),
      ).toBeVisible();
      await expect(
        authorReview.locator("dialog,em,[data-connected-review]"),
      ).toHaveCount(0);
      await expect(page.locator("html")).toHaveAttribute("dir", direction);
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        )
        .toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(
          `connected-completed-${locale}-${testInfo.project.name}.png`,
        ),
        fullPage: true,
      });
      const reviews = JSON.parse(
        harness.runSql(`select jsonb_agg(to_jsonb(reviews)) from public.customer_reviews reviews
        where reviews.booking_request_id='${requestId}';`),
      );
      expect(reviews).toHaveLength(1);
      expect(reviews[0]).toMatchObject({
        booking_request_id: requestId,
        booking_confirmation_id: before.confirmationId,
        profile_id: fixture.ids.profileId,
        author_user_id: fixture.identities.customer,
        rating: 5,
        original_language: sourceLanguage,
        original_body: reviewBody,
      });
      const submitted = await customerClient.rpc("get_customer_review", {
        target_reference: fixture.ids.bookingReference,
      });
      expect(submitted.error).toBeNull();
      expect(submitted.data).toMatchObject({
        status: "submitted",
        reviewId: reviews[0].id,
        originalBody: reviewBody,
      });
      visitorContext = await browser.newContext({
        baseURL: new URL(page.url()).origin,
        viewport: page.viewportSize()!,
      });
      const visitor = await visitorContext.newPage();
      await visitor.goto(`/${locale}/cottages/${fixture.publicSlug}/reviews`);
      await visitor.reload();
      await expect(
        visitor.getByRole("heading", { name: copy.publicTitle, exact: true }),
      ).toBeVisible();
      const publicReview = visitor
        .getByRole("article")
        .filter({ hasText: reviewBody });
      await expect(publicReview).toHaveCount(1);
      await expect(
        publicReview.getByText(reviewBody, { exact: true }),
      ).toBeVisible();
      await expect(
        publicReview.locator("dialog,em,[data-connected-review]"),
      ).toHaveCount(0);
      await expect(
        visitor.getByRole("link", { name: copy.backToCottage }),
      ).toHaveAttribute("href", `/${locale}/cottages/${fixture.publicSlug}`);
      await expect(
        visitor.getByText("Fictional private address", { exact: false }),
      ).toHaveCount(0);
      await expect(visitor.locator("html")).toHaveAttribute("dir", direction);
      await expect
        .poll(() =>
          visitor.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        )
        .toBe(true);
      await visitor.screenshot({
        path: testInfo.outputPath(
          `connected-public-review-${locale}-${testInfo.project.name}.png`,
        ),
        fullPage: true,
      });
      await page.goto(conversationUrl);
      await expect(
        page.getByText(
          `${fixture.ids.bookingReference} · ${statusWords.completed}`,
          { exact: true },
        ),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", {
          name: "Fictional Preserved Cottage",
          level: 1,
        }),
      ).toBeVisible();
      await expect(messages.getByRole("listitem")).toHaveCount(1);
      await expect(message.getByText(original, { exact: true })).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("dir", direction);
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        )
        .toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(
          `connected-retained-messaging-${locale}-${testInfo.project.name}.png`,
        ),
        fullPage: true,
      });
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
        inboxRow.getByText(statusWords.completed, { exact: true }),
      ).toBeVisible();
      await expect(
        inboxRow.getByText(statusWords.completed, { exact: true }),
      ).toHaveClass("status-badge");
      await expect(page.locator("html")).toHaveAttribute("dir", direction);
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        )
        .toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(
          `connected-completed-inbox-${locale}-${testInfo.project.name}.png`,
        ),
        fullPage: true,
      });

      expect(readConversation(conversationId)).toEqual(conversationBefore);
      expect(readBooking()).toMatchObject({
        snapshot: before.snapshot,
        ranges: before.ranges,
        reviewCount: 1,
      });
    } finally {
      await visitorContext?.close();
      await cleanup();
    }
  }
});

test("Customer review publishes, paginates, survives moderation audit, and disappears publicly", async ({
  page,
  browser,
}, testInfo) => {
  // Hosted CI peaked at 23.9s; 60s leaves 36.1s of headroom.
  test.setTimeout(60_000);
  requireLocalDatabase();
  const allocatedNamespaces = [
    ...Object.values(namespaces).flat(),
    ...Object.values(paginationNamespaces).flat(),
    ...Object.values(upcomingNamespaces),
  ];
  expect(allocatedNamespaces).toHaveLength(66);
  expect(new Set(allocatedNamespaces).size).toBe(66);
  const reservedNamespaces = new Set(["00", "10", "11", "35", "38", "41"]);
  expect(
    allocatedNamespaces.filter((namespace) =>
      reservedNamespaces.has(namespace),
    ),
  ).toEqual([]);
  const projectName = testInfo.project.name as keyof typeof namespaces;
  const pair = namespaces[projectName];
  if (!pair) throw new Error("Customer review browser project is unmapped");
  const fixtureHarness = createLocalSupabaseConcurrencyHarness();
  fixtureHarness.guardDisposableLocalDatabase();
  const ownedNamespaces = [
    ...paginationNamespaces[projectName],
    upcomingNamespaces[projectName],
    pair[1],
    pair[0],
  ];
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret)
    throw new Error("Customer review fixture credentials are missing");
  const privileged = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const cleanupOwnedFixtures = async () => {
    const users = await listAllAccessFixtureUsers(privileged.auth.admin);
    const owner = findAccessFixtureUser(users, `+964757000${pair[0]}01`)?.id;
    const identities = ownedNamespaces.map((namespace) => ({
      owner,
      customer: findAccessFixtureUser(users, `+964757000${namespace}02`)?.id,
      other: findAccessFixtureUser(users, `+964757000${namespace}03`)?.id,
    }));
    const cleanupSql = ownedNamespaces
      .map((namespace, index) =>
        reviewFixtureCleanup(namespace, identities[index]),
      )
      .join("");
    const reusedAuthUsers = [
      ...new Set(
        identities.flatMap((identity) =>
          Object.values(identity).filter(
            (user): user is string => user !== undefined,
          ),
        ),
      ),
    ];
    fixtureHarness.runSql(cleanupSql);
    const requestIds = ownedNamespaces
      .map((namespace) => `'60000000-0000-4000-8000-00000000${namespace}01'`)
      .join(",");
    const preservedUsers = reusedAuthUsers.map((user) => `'${user}'`).join(",");
    const cleanupProof = fixtureHarness.runSql(`select jsonb_build_object(
      'bookingRequests',(select count(*) from public.booking_requests requests
        where requests.id in (${requestIds})),
      'customerReviews',(select count(*) from public.customer_reviews reviews
        where reviews.booking_request_id in (${requestIds})),
      'authUsers',(select count(*) from auth.users users
        where users.id=any(array[${preservedUsers}]::uuid[]))
    );`);
    expect(JSON.parse(cleanupProof)).toEqual({
      bookingRequests: 0,
      customerReviews: 0,
      authUsers: reusedAuthUsers.length,
    });
  };
  await cleanupOwnedFixtures();
  try {
    const serviceDateAnchor = fixtureHarness.runSql(
      "select (clock_timestamp() at time zone 'Asia/Baghdad')::date;",
    );
    expect(serviceDateAnchor).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const primary = await seedFixture(pair[0], {
      startDaySql: anchoredServiceDay(serviceDateAnchor, -3),
    });
    const sharedCottage = {
      namespace: pair[0],
      ownerUserId: primary.identities.owner,
      profileId: primary.ids.profileId,
      publicSlug: primary.publicSlug,
    };
    const ratingOnly = await seedFixture(pair[1], {
      sharedCottage,
      startDaySql: anchoredServiceDay(serviceDateAnchor, -5),
    });

    const bookingPath = `/en/booking-requests/${primary.ids.bookingReference}`;
    await page.goto(bookingPath);
    await expect(
      page.getByRole("heading", { name: "Sign in or create an account" }),
    ).toBeVisible();
    await expectIdentityDenied(
      primary.phones.other,
      primary.ids.bookingReference,
    );
    await expectIdentityDenied(
      primary.phones.owner,
      primary.ids.bookingReference,
    );

    await signInPhone(page, primary.phones.customer, bookingPath);
    const customerReview = page.getByRole("region", {
      name: "Review this cottage",
    });
    await expect(
      customerReview.getByRole("heading", { name: "Review this cottage" }),
    ).toBeVisible();
    await expect(
      customerReview.getByText("Review window open until", { exact: false }),
    ).toBeVisible();

    const publicPath = `/en/cottages/${primary.publicSlug}/reviews`;
    const visitorContext = await browser.newContext({
      baseURL: new URL(page.url()).origin,
    });
    const visitor = await visitorContext.newPage();
    await visitor.goto(publicPath);
    await expect(visitor.getByText("No reviews yet.")).toBeVisible();

    await page.getByRole("radio", { name: "5 stars" }).check();
    await page.getByLabel("Review text (optional)").fill("Call +9647501234567");
    await page.getByRole("button", { name: "Publish review" }).click();
    await expect(customerReview.getByRole("alert")).toContainText(
      "Remove contact details",
    );
    await visitor.reload();
    await expect(visitor.getByText("No reviews yet.")).toBeVisible();

    const original =
      "Literal <dialog open data-review-probe>unsafe dialog</dialog> & <em>literal emphasis</em> remains unchanged through a long customer review.";
    const primaryRating = page.getByRole("radio", { name: "5 stars" });
    await primaryRating.focus();
    await primaryRating.press("Space");
    await expect(primaryRating).toBeChecked();
    await page.getByLabel("Review text (optional)").fill(original);
    await page.getByLabel("Original language").selectOption("en");
    await page.getByRole("button", { name: "Publish review" }).click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Your review was published." }),
    ).toBeVisible();
    await page.reload();
    const authorReview = page.getByRole("region", { name: "Your review" });
    await expect(authorReview.getByText(original)).toHaveAttribute(
      "lang",
      "en",
    );
    await expect(authorReview.getByText(original)).toHaveAttribute(
      "dir",
      "auto",
    );
    await expect(authorReview.locator("dialog")).toHaveCount(0);
    await expect(authorReview.locator("em")).toHaveCount(0);
    await expect(authorReview.locator("[data-review-probe]")).toHaveCount(0);
    await expect(authorReview.getByText("Rating: 5 / 5 stars")).toBeVisible();

    const ratingContext = await browser.newContext({
      baseURL: new URL(page.url()).origin,
    });
    const ratingPage = await ratingContext.newPage();
    await signInPhone(
      ratingPage,
      ratingOnly.phones.customer,
      `/en/booking-requests/${ratingOnly.ids.bookingReference}`,
    );
    await ratingPage.getByRole("radio", { name: "4 stars" }).check();
    await ratingPage.getByRole("button", { name: "Publish review" }).click();
    await expect(
      ratingPage
        .getByRole("status")
        .filter({ hasText: "Your review was published." }),
    ).toBeVisible();
    await ratingContext.close();

    const interactiveReviews = JSON.parse(
      primary.harness.runSql(`select jsonb_agg(jsonb_build_object(
      'reviewId',reviews.id,
      'bookingRequestId',reviews.booking_request_id,
      'originalBody',reviews.original_body
    ) order by reviews.submitted_at desc,reviews.id desc)
    from public.customer_reviews reviews
    where reviews.booking_request_id in (
      '${primary.ids.requestId}','${ratingOnly.ids.requestId}'
    );`),
    ) as Array<{
      reviewId: string;
      bookingRequestId: string;
      originalBody: string | null;
    }>;
    expect(interactiveReviews).toHaveLength(2);
    const primaryInteractiveReview = interactiveReviews.find(
      (review) => review.bookingRequestId === primary.ids.requestId,
    );
    expect(primaryInteractiveReview).toMatchObject({ originalBody: original });
    expect(
      interactiveReviews.find(
        (review) => review.bookingRequestId === ratingOnly.ids.requestId,
      ),
    ).toMatchObject({ originalBody: null });

    const historicalBodies: string[] = [];
    const historicalReviewIds: string[] = [];
    const sharedScheduleRevisionId = `30000000-0000-4000-8000-00000000${pair[0]}01`;
    for (const [index, namespace] of paginationNamespaces[
      projectName
    ].entries()) {
      const serviceDayOffset = -7 - 2 * index;
      const startDaySql = anchoredServiceDay(
        serviceDateAnchor,
        serviceDayOffset,
      );
      const reservedOccupancies = primary.harness.runSql(`select count(*)
      from public.cottage_booking_period_occupancies occupancies
      where occupancies.schedule_revision_id='${sharedScheduleRevisionId}'
        and occupancies.service_day in (${startDaySql},${startDaySql}+1);`);
      expect(reservedOccupancies).toBe("0");

      const fixture = await seedFixture(namespace, {
        sharedCottage,
        startDaySql,
      });
      const reviewId = `91000000-0000-4000-8000-00000000${namespace}01`;
      const originalBody = `Guarded historical review ${index + 1}`;
      const sourceFacts = JSON.parse(
        primary.harness.runSql(`select jsonb_build_object(
        'namespaceRequestCount',(
          select count(*) from public.booking_requests namespace_requests
          where namespace_requests.id='${fixture.ids.requestId}'
            and namespace_requests.booking_request_reference='${fixture.ids.bookingReference}'
        ),
        'occupancyCount',(
          select count(*) from public.cottage_booking_period_occupancies own
          join public.booking_requests source_request
            on source_request.booking_period_commitment_id=own.booking_period_commitment_id
          where source_request.id='${fixture.ids.requestId}'
        ),
        'foreignOccupancyKeyCount',(
          select count(*) from public.cottage_booking_period_occupancies own
          join public.booking_requests source_request
            on source_request.booking_period_commitment_id=own.booking_period_commitment_id
          join public.cottage_booking_period_occupancies other
            on other.schedule_revision_id=own.schedule_revision_id
            and other.shift_id=own.shift_id
            and other.service_day=own.service_day
            and other.booking_period_commitment_id<>own.booking_period_commitment_id
          where source_request.id='${fixture.ids.requestId}'
        ),
        'payment',public.booking_request_payment_status(requests),
        'commitmentConfirmed',exists(
          select 1 from public.cottage_booking_period_commitments commitments
          where commitments.id=requests.booking_period_commitment_id
            and commitments.status='confirmed_booking'
        ),
        'confirmationBound',exists(
          select 1 from public.booking_confirmations confirmations
          where confirmations.booking_request_id=requests.id
        ),
        'completionBound',exists(
          select 1 from public.booking_completion_maturity maturity
          join public.booking_lifecycle_outcomes outcomes
            on outcomes.id=maturity.lifecycle_outcome_id
            and outcomes.booking_request_id=requests.id
            and outcomes.outcome='completed'
          where maturity.booking_request_id=requests.id
            and maturity.outcome='completed'
        ),
        'bodySafe',public.contact_protection_text_is_safe('${originalBody}'),
        'submittedAt',maturity.effective_period_end+interval '1 day',
        'reviewExpiresAt',maturity.review_expires_at,
        'insideReviewWindow',
          maturity.effective_period_end+interval '1 day'>=maturity.effective_period_end
          and maturity.effective_period_end+interval '1 day'<maturity.review_expires_at
      )
      from public.booking_requests requests
      join public.booking_completion_maturity maturity
        on maturity.booking_request_id=requests.id
      where requests.id='${fixture.ids.requestId}';`),
      ) as {
        namespaceRequestCount: number;
        occupancyCount: number;
        foreignOccupancyKeyCount: number;
        payment: string;
        commitmentConfirmed: boolean;
        confirmationBound: boolean;
        completionBound: boolean;
        bodySafe: boolean;
        submittedAt: string;
        reviewExpiresAt: string;
        insideReviewWindow: boolean;
      };
      expect(sourceFacts).toMatchObject({
        namespaceRequestCount: 1,
        occupancyCount: 5,
        foreignOccupancyKeyCount: 0,
        payment: "paid-confirmed",
        commitmentConfirmed: true,
        confirmationBound: true,
        completionBound: true,
        bodySafe: true,
        insideReviewWindow: true,
      });
      expect(Date.parse(sourceFacts.submittedAt)).toBeLessThan(
        Date.parse(sourceFacts.reviewExpiresAt),
      );

      const inserted = JSON.parse(
        primary.harness.runSql(`with inserted as (
        insert into public.customer_reviews(
          id,booking_request_id,booking_confirmation_id,profile_id,
          author_user_id,rating,original_language,original_body,submitted_at
        )
        select '${reviewId}',requests.id,confirmations.id,requests.profile_id,
          requests.customer_user_id,${(index % 5) + 1},'en','${originalBody}',
          maturity.effective_period_end+interval '1 day'
        from public.booking_requests requests
        join public.booking_confirmations confirmations
          on confirmations.booking_request_id=requests.id
        join public.booking_completion_maturity maturity
          on maturity.booking_request_id=requests.id
          and maturity.outcome='completed'
        where requests.id='${fixture.ids.requestId}'
        returning id,original_body,submitted_at
      ) select jsonb_build_object(
        'reviewId',inserted.id,
        'originalBody',inserted.original_body,
        'submittedAt',inserted.submitted_at
      ) from inserted;`),
      );
      expect(inserted).toEqual({
        reviewId,
        originalBody,
        submittedAt: sourceFacts.submittedAt,
      });
      historicalBodies.push(originalBody);
      historicalReviewIds.push(reviewId);
    }
    expect(historicalBodies).toHaveLength(19);
    expect(historicalReviewIds).toHaveLength(19);

    const upcoming = await seedFixture(upcomingNamespaces[projectName], {
      sharedCottage,
      startDaySql: anchoredServiceDay(serviceDateAnchor, 1),
      complete: false,
      confirm: true,
    });
    const upcomingContext = await browser.newContext({
      baseURL: new URL(page.url()).origin,
    });
    const upcomingPage = await upcomingContext.newPage();
    await signInPhone(
      upcomingPage,
      upcoming.phones.customer,
      `/en/booking-requests/${upcoming.ids.bookingReference}`,
    );
    const upcomingReview = upcomingPage.getByRole("region", {
      name: "Review this cottage",
    });
    await expect(upcomingReview).toContainText(
      "A review is not available for this booking.",
    );
    await expect(
      upcomingReview.getByRole("button", { name: "Publish review" }),
    ).toHaveCount(0);
    await expect(upcomingReview.getByRole("alert")).toHaveCount(0);
    await upcomingContext.close();

    const ratingText = {
      en: "Rating: 5 / 5 stars",
      ar: "التقييم: 5 / 5 نجوم",
      ckb: "هەڵسەنگاندن: 5 / 5 ئەستێرە",
    } as const;
    const ratingOnlyText = {
      en: "Rating only",
      ar: "تقييم رقمي فقط",
      ckb: "تەنها نمرەی ئەستێرەکان",
    } as const;
    const nextReviewText = {
      en: "Next reviews",
      ar: "التقييمات التالية",
      ckb: "هەڵسەنگاندنەکانی دواتر",
    } as const;
    const expectedReviewIds = [
      ...interactiveReviews.map((review) => review.reviewId),
      ...historicalReviewIds,
    ];
    expect(new Set(expectedReviewIds).size).toBe(21);

    const publicClient = createClient(
      process.env.SUPABASE_URL ?? "",
      process.env.SUPABASE_PUBLISHABLE_KEY ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const firstPublicResult = await publicClient.rpc(
      "list_public_customer_reviews",
      {
        target_slug: primary.publicSlug,
        target_before_at: null,
        target_before_id: null,
        target_limit: 20,
      },
    );
    expect(firstPublicResult.error).toBeNull();
    const firstPublicData = firstPublicResult.data as {
      status: string;
      items: Array<{ reviewId: string; originalBody: string | null }>;
      nextCursor: { submittedAt: string; reviewId: string } | null;
    };
    expect(firstPublicData.status).toBe("success");
    expect(firstPublicData.items).toHaveLength(20);
    expect(firstPublicData.nextCursor).not.toBeNull();
    const secondPublicResult = await publicClient.rpc(
      "list_public_customer_reviews",
      {
        target_slug: primary.publicSlug,
        target_before_at: firstPublicData.nextCursor!.submittedAt,
        target_before_id: firstPublicData.nextCursor!.reviewId,
        target_limit: 20,
      },
    );
    expect(secondPublicResult.error).toBeNull();
    const secondPublicData = secondPublicResult.data as {
      status: string;
      items: Array<{ reviewId: string; originalBody: string | null }>;
      nextCursor: null;
    };
    expect(secondPublicData).toMatchObject({
      status: "success",
      nextCursor: null,
    });
    expect(secondPublicData.items).toHaveLength(1);
    expect(
      new Set(
        [...firstPublicData.items, ...secondPublicData.items].map(
          (review) => review.reviewId,
        ),
      ),
    ).toEqual(new Set(expectedReviewIds));
    expect(secondPublicData.items[0]).toMatchObject({
      reviewId: historicalReviewIds.at(-1),
      originalBody: historicalBodies.at(-1),
    });

    for (const locale of ["en", "ar", "ckb"] as const) {
      const response = await visitor.goto(
        `/${locale}/cottages/${primary.publicSlug}/reviews`,
      );
      expect(response?.ok()).toBe(true);
      const firstResponseBody = await response!.text();
      await expect(visitor.getByRole("article")).toHaveCount(20);
      const primaryPublicReview = visitor
        .getByRole("article")
        .filter({ hasText: original });
      await expect(primaryPublicReview).toHaveCount(1);
      await expect(primaryPublicReview.getByText(original)).toHaveAttribute(
        "lang",
        "en",
      );
      await expect(primaryPublicReview.getByText(original)).toHaveAttribute(
        "dir",
        "auto",
      );
      await expect(
        primaryPublicReview.getByText(ratingText[locale]),
      ).toBeVisible();
      await expect(primaryPublicReview.locator("dialog")).toHaveCount(0);
      await expect(primaryPublicReview.locator("em")).toHaveCount(0);
      await expect(
        primaryPublicReview.locator("[data-review-probe]"),
      ).toHaveCount(0);
      const firstPageBodies = await visitor
        .getByRole("article")
        .locator("p[dir=auto]")
        .allTextContents();
      await visitor.getByRole("link", { name: nextReviewText[locale] }).click();
      await expect(visitor.getByRole("article")).toHaveCount(1);
      const secondPageResponse = await visitor.goto(visitor.url());
      expect(secondPageResponse?.ok()).toBe(true);
      const secondResponseBody = await secondPageResponse!.text();
      await expect(visitor.getByRole("article")).toHaveCount(1);
      const secondPageBodies = await visitor
        .getByRole("article")
        .locator("p[dir=auto]")
        .allTextContents();
      expect(secondPageBodies).toEqual([historicalBodies.at(-1)]);
      await expect(
        visitor.getByRole("link", { name: nextReviewText[locale] }),
      ).toHaveCount(0);
      const renderedBodies = [...firstPageBodies, ...secondPageBodies];
      expect(renderedBodies).toHaveLength(21);
      expect(new Set(renderedBodies)).toEqual(
        new Set([original, ratingOnlyText[locale], ...historicalBodies]),
      );
      expect(firstResponseBody).not.toContain(primary.identities.customer);
      expect(firstResponseBody).not.toContain(primary.ids.bookingReference);
      expect(secondResponseBody).not.toContain(primary.identities.customer);
      expect(secondResponseBody).not.toContain(primary.ids.bookingReference);
      await expect(visitor.locator("html")).toHaveAttribute(
        "dir",
        locale === "en" ? "ltr" : "rtl",
      );
    }

    const administrator = await provisionAdministrator(
      `customer-reviews-${testInfo.project.name}`,
    );
    await page.context().clearCookies();
    await page.goto("/en/administrator/reviews");
    await expect(page).toHaveURL(
      "/en/administrator/access?returnTo=%2Fen%2Fadministrator%2Freviews",
    );
    await expectAdministratorEmailAccess(page, administratorReturnLocales[0]);
    await expect(page.getByText(primary.ids.bookingReference)).toHaveCount(0);
    const secret = await beginAdministratorMfa(
      page,
      administrator.email,
      administratorReturnLocales[0],
    );
    const aal1 = await page.context().newPage();
    await aal1.goto("/en/administrator/reviews");
    await expect(
      aal1.getByText(
        "Authenticator-verified administrator access is required.",
      ),
    ).toBeVisible();
    await expect(aal1.getByText(primary.ids.bookingReference)).toHaveCount(0);
    await expect(aal1.getByRole("article")).toHaveCount(0);
    await aal1.close();
    await page.getByLabel("Authenticator app code").fill(
      new OTPAuth.TOTP({
        secret: OTPAuth.Secret.fromBase32(secret),
      }).generate(),
    );
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page).toHaveURL("/en/administrator/reviews");
    await expect(
      page.getByRole("heading", { name: "Customer review moderation" }),
    ).toBeVisible();
    await page.getByLabel("Status").selectOption("unhidden");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === "/en/administrator/reviews" &&
        url.searchParams.get("state") === "unhidden",
    );
    const review = await openAdministratorReview(
      page,
      primary.ids.bookingReference,
    );
    await expect(review).toContainText(primary.ids.bookingReference);
    await expect(review).toContainText(primary.identities.customer);
    await expect(review.getByText("Rating: 5 / 5 stars")).toBeVisible();
    await expect(review.getByText(original)).toHaveAttribute("lang", "en");
    await expect(review.getByText(original)).toHaveAttribute("dir", "auto");
    await expect(review.locator("dialog")).toHaveCount(0);
    await expect(review.locator("em")).toHaveCount(0);
    await expect(review.locator("[data-review-probe]")).toHaveCount(0);
    await review.getByRole("button", { name: "Hide review" }).click();
    await expect(review.getByRole("alert")).toContainText("Enter a reason");
    const reason = "Contact-safety moderation fixture";
    await review.getByLabel("Reason for hiding").fill(reason);
    const hideReviewControl = review.getByRole("button", {
      name: "Hide review",
    });
    await hideReviewControl.focus();
    await expect(hideReviewControl).toBeFocused();
    await hideReviewControl.press("Enter");
    await expect(review).toHaveCount(0);
    await expect(
      page.getByRole("heading", {
        name: "Customer review moderation",
        level: 1,
      }),
    ).toBeFocused();

    const baghdadDate = (at: number) =>
      new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad" }).format(at);
    const from = baghdadDate(Date.now() - 24 * 60 * 60 * 1000);
    const through = baghdadDate(Date.now());
    await page.addInitScript(() => {
      type HydrationFiber = {
        stateNode?: unknown;
        child?: HydrationFiber | null;
        sibling?: HydrationFiber | null;
      };
      Object.assign(window, {
        __reviewFilterHydrated: false,
        __REACT_DEVTOOLS_GLOBAL_HOOK__: {
          supportsFiber: true,
          inject: () => 1,
          onCommitFiberRoot: (
            _rendererId: number,
            root: { current: HydrationFiber },
          ) => {
            // A root-shell commit can precede hydration of the filter's subtree.
            const pending = [root.current];
            while (pending.length) {
              const fiber = pending.pop()!;
              if (
                fiber.stateNode instanceof HTMLSelectElement &&
                fiber.stateNode.name === "state"
              ) {
                Object.assign(window, { __reviewFilterHydrated: true });
                return;
              }
              if (fiber.child) pending.push(fiber.child);
              if (fiber.sibling) pending.push(fiber.sibling);
            }
          },
        },
      });
    });
    for (const locale of ["en", "ar", "ckb"] as const) {
      const records = administratorRecordsMessages[locale];
      let releaseScripts!: () => void;
      const scriptsReleased = new Promise<void>((resolve) => {
        releaseScripts = resolve;
      });
      const staticScript = (url: URL) =>
        url.pathname.startsWith("/_next/static/") &&
        url.pathname.endsWith(".js");
      await page.route(staticScript, async (route) => {
        await scriptsReleased;
        await route.continue();
      });
      try {
        await page.goto(`/${locale}/administrator/reviews`, {
          waitUntil: "commit",
        });
        const status = page.getByLabel(records.status);
        await expect(status).toHaveValue("");
        await status.selectOption("hidden");
        await expect(status).toHaveValue("hidden");
        expect(
          await page.evaluate(
            () =>
              (window as Window & { __reviewFilterHydrated?: boolean })
                .__reviewFilterHydrated,
          ),
        ).toBe(false);
      } finally {
        releaseScripts();
        await page.unrouteAll({ behavior: "wait" });
      }
      await page.waitForFunction(
        () =>
          (window as Window & { __reviewFilterHydrated?: boolean })
            .__reviewFilterHydrated,
      );
      await expect(page.getByLabel(records.status)).toHaveValue("hidden");
      await expect(page.locator("html")).toHaveAttribute(
        "dir",
        locale === "en" ? "ltr" : "rtl",
      );
      if (locale === "en") {
        await page.getByLabel("From date (Baghdad)").fill(from);
        await page.getByLabel("Through date (Baghdad)").fill(through);
      }
      await page
        .getByRole("button", {
          name: administratorQueuesMessages[locale].apply,
          exact: true,
        })
        .click();
      await expect(page).toHaveURL(
        (url) =>
          url.pathname === `/${locale}/administrator/reviews` &&
          url.searchParams.get("state") === "hidden",
      );
      if (locale === "en") {
        await expect(page).toHaveURL(
          `/en/administrator/reviews?state=hidden&from=${from}&through=${through}`,
        );
        await expect(page.getByText("Matching reviews")).toBeVisible();
      }
      const localizedHiddenReview = await openAdministratorReview(
        page,
        primary.ids.bookingReference,
        locale,
      );
      await expect(localizedHiddenReview.getByText(original)).toBeVisible();
      await expect(localizedHiddenReview.getByText(reason)).toBeVisible();
      await captureReviewFilters(page, locale);
    }

    const hiddenAuthorContext = await browser.newContext({
      baseURL: new URL(page.url()).origin,
    });
    const hiddenAuthor = await hiddenAuthorContext.newPage();
    await signInPhone(
      hiddenAuthor,
      primary.phones.customer,
      `/en/booking-requests/${primary.ids.bookingReference}`,
    );
    const hiddenAuthorReview = hiddenAuthor.getByRole("region", {
      name: "Your review",
    });
    await expect(hiddenAuthorReview.getByRole("status")).toHaveText(
      "Hidden by RentCottage",
    );
    await expect(hiddenAuthorReview).not.toContainText(
      "Your review was published.",
    );
    await expect(hiddenAuthorReview).not.toContainText("Visible to visitors");
    await expect(hiddenAuthorReview.getByText(original)).toBeVisible();
    await expect(hiddenAuthorReview.locator("dialog")).toHaveCount(0);
    await expect(hiddenAuthorReview.locator("em")).toHaveCount(0);
    await expect(hiddenAuthorReview.locator("[data-review-probe]")).toHaveCount(
      0,
    );
    await hiddenAuthorContext.close();

    for (const locale of ["en", "ar", "ckb"] as const) {
      const responseBodies: string[] = [];
      const recordReviewResponse = async (response: Response) => {
        if (
          response.url().includes(`/cottages/${primary.publicSlug}/reviews`)
        ) {
          responseBodies.push(await response.text().catch(() => ""));
        }
      };
      visitor.on("response", recordReviewResponse);
      await visitor.goto(`/${locale}/cottages/${primary.publicSlug}/reviews`);
      await expect(visitor.getByRole("article")).toHaveCount(20);
      await expect(visitor.getByText(original)).toHaveCount(0);
      await expect(visitor.locator('a[href*="beforeAt="]')).toHaveCount(0);
      const visibleBodies = await visitor
        .getByRole("article")
        .locator("p[dir=auto]")
        .allTextContents();
      expect(new Set(visibleBodies)).toEqual(
        new Set([ratingOnlyText[locale], ...historicalBodies]),
      );
      const rendered = [await visitor.content(), ...responseBodies].join("\n");
      for (const privateValue of [
        original,
        primaryInteractiveReview!.reviewId,
        primary.ids.bookingReference,
        primary.identities.customer,
        administrator.userId,
        reason,
      ])
        expect(rendered).not.toContain(privateValue);
      visitor.off("response", recordReviewResponse);
    }

    primary.harness.runSql(
      "revoke execute on function public.list_public_customer_reviews(text,timestamptz,uuid,integer) from anon,authenticated;",
    );
    try {
      await visitor.goto(publicPath);
      await expect(
        visitor.getByText("Reviews are unavailable. Refresh and try again.", {
          exact: true,
        }),
      ).toBeVisible();
    } finally {
      primary.harness.runSql(
        "grant execute on function public.list_public_customer_reviews(text,timestamptz,uuid,integer) to anon,authenticated;",
      );
    }
    await visitorContext.close();

    const messagingRows = (requestId: string, conversationId: string) =>
      primary.harness.runSql(`select jsonb_build_object(
        'conversations',(select coalesce(jsonb_agg(to_jsonb(rows) order by rows.id),'[]'::jsonb)
          from public.messaging_conversations rows where rows.id='${conversationId}'),
        'messages',(select coalesce(jsonb_agg(to_jsonb(rows) order by rows.id),'[]'::jsonb)
          from public.messaging_messages rows where rows.conversation_id='${conversationId}'),
        'sendAttempts',(select coalesce(jsonb_agg(to_jsonb(rows) order by rows.id),'[]'::jsonb)
          from public.messaging_send_attempts rows where rows.conversation_id='${conversationId}'),
        'requestLinks',(select coalesce(jsonb_agg(to_jsonb(rows) order by rows.booking_request_id),'[]'::jsonb)
          from public.messaging_conversation_booking_requests rows where rows.conversation_id='${conversationId}'),
        'associations',(select coalesce(jsonb_agg(jsonb_build_object(
          'id',rows.id,'booking_request_id',rows.booking_request_id,'conversation_id',rows.conversation_id
        ) order by rows.id),'[]'::jsonb)
          from public.booking_request_submission_attempts rows where rows.booking_request_id='${requestId}'),
        'translations',(select coalesce(jsonb_agg(to_jsonb(rows) order by rows.id),'[]'::jsonb)
          from public.messaging_translations rows join public.messaging_messages messages on messages.id=rows.message_id
          where messages.conversation_id='${conversationId}'),
        'reports',(select coalesce(jsonb_agg(to_jsonb(rows) order by rows.id),'[]'::jsonb)
          from public.messaging_translation_reports rows join public.messaging_translations translations on translations.id=rows.translation_id
          join public.messaging_messages messages on messages.id=translations.message_id
          where messages.conversation_id='${conversationId}')
      );`);
    const conversations: string[] = [];
    const snapshots: string[] = [];
    for (const [index, fixture] of [primary, ratingOnly].entries()) {
      const opened = JSON.parse(
        fixture.harness.runSql(`begin; set local role service_role;
          select public.open_messaging_conversation_for_booking(
            '${fixture.identities.customer}','${fixture.ids.bookingReference}','${randomUUID()}'
          ); commit;`),
      );
      expect(opened.status).toBe("created");
      expect(opened.conversationId).toMatch(/^[0-9a-f-]{36}$/);
      const admitted = JSON.parse(
        fixture.harness.runSql(`begin; set local role service_role;
          select public.admit_messaging_message(
            '${fixture.identities.customer}','${opened.conversationId}','${randomUUID()}',
            'en','Fictional cleanup observer message ${pair[index]}'
          ); commit;`),
      );
      expect(admitted.status).toBe("sent");
      expect(admitted.messageId).toMatch(/^[0-9a-f-]{36}$/);
      const snapshot = messagingRows(
        fixture.ids.requestId,
        opened.conversationId,
      );
      const rows = JSON.parse(snapshot);
      for (const key of [
        "conversations",
        "messages",
        "sendAttempts",
        "requestLinks",
        "associations",
      ])
        expect(rows[key]).toHaveLength(1);
      expect(rows.conversations[0]).toMatchObject({
        id: opened.conversationId,
        customer_user_id: fixture.identities.customer,
        owner_user_id: primary.identities.owner,
        profile_id: primary.ids.profileId,
      });
      expect(rows.messages[0]).toMatchObject({
        id: admitted.messageId,
        conversation_id: opened.conversationId,
        send_attempt_id: rows.sendAttempts[0].id,
        original_body: `Fictional cleanup observer message ${pair[index]}`,
      });
      const attemptId = `70000000-0000-4000-8000-00000000${pair[index]}01`;
      expect(rows.requestLinks[0]).toMatchObject({
        conversation_id: opened.conversationId,
        booking_request_id: fixture.ids.requestId,
        submission_attempt_id: attemptId,
      });
      expect(rows.associations).toEqual([
        {
          id: attemptId,
          booking_request_id: fixture.ids.requestId,
          conversation_id: opened.conversationId,
        },
      ]);
      conversations.push(opened.conversationId);
      snapshots.push(snapshot);
    }
    expect(primary.ids.requestId).not.toBe(ratingOnly.ids.requestId);
    expect(conversations[0]).not.toBe(conversations[1]);
    primary.harness.runSql(
      reviewFixtureCleanup(pair[1], ratingOnly.identities),
    );
    expect(
      JSON.parse(messagingRows(ratingOnly.ids.requestId, conversations[1])),
    ).toEqual({
      conversations: [],
      messages: [],
      sendAttempts: [],
      requestLinks: [],
      associations: [],
      translations: [],
      reports: [],
    });
    expect(messagingRows(primary.ids.requestId, conversations[0])).toBe(
      snapshots[0],
    );
  } finally {
    await cleanupOwnedFixtures();
  }
});

test("Cottage Owner replies once, visitors read the reply, and an administrator hides it", async ({
  page,
  browser,
}, testInfo) => {
  requireLocalDatabase();
  const namespace =
    replyNamespaces[testInfo.project.name as keyof typeof replyNamespaces];
  if (!namespace)
    throw new Error("Customer review reply browser project is unmapped");
  const fixture = await seedFixture(namespace, { clearFirst: true });
  try {
    const countReviewRows = (
      table:
        | "customer_review_replies"
        | "customer_review_reply_hides"
        | "customer_review_hides",
    ) =>
      fixture.harness.runSql(`select count(*)
        from public.${table} counted
        join public.customer_reviews reviews on reviews.id=counted.review_id
        where reviews.booking_request_id='${fixture.ids.requestId}';`);
    const reviewBody = "A calm stay beside the garden.";
    const replyBody = "Thank you for staying with us.";
    const reason = "Reply moderation fixture";

    const customerClient = await signedInPhoneClient(fixture.phones.customer);
    const submitted = await customerClient.rpc("submit_customer_review", {
      target_reference: fixture.ids.bookingReference,
      target_rating: 5,
      target_original_language: "en",
      target_original_body: reviewBody,
    });
    expect(submitted.error).toBeNull();
    expect(submitted.data).toMatchObject({ status: "submitted" });

    await expectOwnerReviewDenied(
      fixture.phones.customer,
      fixture.ids.bookingReference,
    );
    await expectOwnerReviewDenied(
      fixture.phones.other,
      fixture.ids.bookingReference,
    );
    expect(countReviewRows("customer_review_replies")).toBe("0");

    const ownerPath = (locale: "en" | "ar" | "ckb") =>
      `/${locale}/owner/booking-requests/${fixture.ids.bookingReference}`;
    const observeCompletedRecord = async (locale: Locale) => {
      await test.step("completed booking record has readable groups", async () => {
        const region = page.locator("section.confirmed-booking-details");
        await expect(region.getByRole("heading", { level: 1 })).toBeVisible();
        const identity = region.locator(".confirmed-booking-identity-text");
        await expect(region.locator(".booking-cottage-thumbnail")).toHaveCount(
          0,
        );
        await expect(
          identity.getByText("Fictional Preserved Cottage", { exact: true }),
        ).toBeVisible();
        await expect(identity.locator("bdi")).toHaveText(
          `CUSTOMER-REVIEW-HOLD-${namespace}`,
        );
        const configuredViewport = page.viewportSize();
        if (!configuredViewport)
          throw new Error("Booking record requires a configured viewport");
        const measure = () => {
          const viewport = page.viewportSize();
          if (!viewport)
            throw new Error("Booking record requires a configured viewport");
          return region.evaluate((section, viewport) => {
            const header = section.querySelector("header")!;
            const metadata = header.querySelector(
              ".confirmed-booking-identity-text",
            )!;
            const card = section.querySelector(".confirmed-booking-record")!;
            const groups = Array.from(
              card.querySelectorAll(":scope > .confirmed-booking-group"),
            );
            const period = groups[0].querySelectorAll("dd")[1];
            const entries = Array.from(period.children);
            const bounds = (element: Element) =>
              element.getBoundingClientRect().toJSON();
            const typography = (element: Element) => {
              const style = getComputedStyle(element);
              const backgrounds = [];
              for (
                let ancestor: Element | null = element;
                ancestor;
                ancestor = ancestor.parentElement
              ) {
                const ancestorStyle = getComputedStyle(ancestor);
                backgrounds.push({
                  element: ancestor.tagName,
                  backgroundColor: ancestorStyle.backgroundColor,
                  backgroundImage: ancestorStyle.backgroundImage,
                });
              }
              return {
                text: element.textContent,
                color: style.color,
                fontFamily: style.fontFamily,
                fontSize: style.fontSize,
                fontWeight: style.fontWeight,
                lineHeight: style.lineHeight,
                backgrounds,
              };
            };
            const boxes = [
              section,
              header,
              metadata,
              ...metadata.children,
              card,
              ...groups,
              ...section.querySelectorAll("dt, dd"),
              ...entries,
              ...period.querySelectorAll("bdi"),
            ].map(bounds);
            const periodBounds = entries.map((entry) => ({
              entry: bounds(entry),
              name: bounds(entry.children[0]),
              range: bounds(entry.children[1]),
              timestamps: Array.from(entry.querySelectorAll("bdi"), (item) => ({
                text: item.textContent,
                rectangle: bounds(item),
              })),
            }));
            const summary = card.querySelector("summary")!;
            const summaryStyle = getComputedStyle(summary);
            return {
              locale: document.documentElement.lang,
              viewport,
              actualViewport: { width: innerWidth, height: innerHeight },
              heading: bounds(header),
              metadata: Array.from(metadata.children, bounds),
              card: bounds(card),
              groups: groups.map((group) => ({
                rectangle: bounds(group),
                firstTerm: group.querySelector("dt")!.textContent,
              })),
              periods: periodBounds,
              typography: {
                title: typography(header.querySelector("h1")!),
                metadata: Array.from(metadata.children, typography),
                notice: typography(groups[3].querySelector('[role="status"]')!),
                explanation: typography(groups[3].querySelector("small")!),
                finalMoney: Array.from(
                  groups[1].querySelectorAll(
                    ".confirmed-booking-final-money > *",
                  ),
                  typography,
                ),
              },
              terms: {
                rectangle: bounds(summary),
                focusVisible: summary.matches(":focus-visible"),
                outline: {
                  style: summaryStyle.outlineStyle,
                  width: summaryStyle.outlineWidth,
                  color: summaryStyle.outlineColor,
                  offset: summaryStyle.outlineOffset,
                },
                shadow: summaryStyle.boxShadow,
                typography: typography(summary),
              },
              checks: {
                headingAboveCard:
                  header.getBoundingClientRect().bottom <=
                  card.getBoundingClientRect().top,
                referenceBelowCottage:
                  metadata.children[0].getBoundingClientRect().bottom <=
                  metadata.children[1].getBoundingClientRect().top,
                fourGroups: groups.length === 4,
                groupsInOrder: groups.every(
                  (group, index) =>
                    index === 0 ||
                    groups[index - 1].getBoundingClientRect().bottom <=
                      group.getBoundingClientRect().top,
                ),
                periodsSeparate:
                  entries.length === 3 &&
                  periodBounds.every(
                    (entry, index) =>
                      entry.name.bottom <= entry.range.top &&
                      (index === 0 ||
                        periodBounds[index - 1].entry.bottom <=
                          entry.entry.top),
                  ),
                fitsViewport:
                  innerWidth <= viewport.width + 1 &&
                  document.documentElement.scrollWidth <= viewport.width + 1 &&
                  boxes.every(
                    (box) => box.left >= -1 && box.right <= viewport.width + 1,
                  ),
              },
            };
          }, viewport);
        };
        const expectedChecks = {
          headingAboveCard: true,
          referenceBelowCottage: true,
          fourGroups: true,
          groupsInOrder: true,
          periodsSeparate: true,
          fitsViewport: true,
        };
        await expect
          .poll(async () => (await measure()).checks)
          .toEqual(expectedChecks);
        const expectedFirstTerms = {
          en: [
            "Customer",
            "Original booking price",
            "House Rules",
            "Confirmation notice",
          ],
          ar: ["العميل", "سعر الحجز الأصلي", "قواعد البيت", "إشعار التأكيد"],
          ckb: [
            "کڕیار",
            "نرخی سەرەتایی حجز",
            "یاساکانی کۆتێج",
            "ئاگادارکردنەوەی پشتڕاستکردن",
          ],
        };
        expect(
          (await measure()).groups.map((group) => group.firstTerm),
        ).toEqual(expectedFirstTerms[locale]);
        const disclosure = region.locator("details");
        const summary = disclosure.locator("summary");
        const body = disclosure.locator("p");
        await expect(disclosure).not.toHaveAttribute("open");
        await expect(body).not.toBeVisible();
        await summary.focus();
        await page.keyboard.press("Enter");
        await expect(disclosure).toHaveAttribute("open", "");
        await expect(body).toBeVisible();
        await expect(body).not.toBeEmpty();
        await page.keyboard.press("Enter");
        await expect(disclosure).not.toHaveAttribute("open");
        await expect(body).not.toBeVisible();
        await expect(summary).toBeFocused();
        await expect
          .poll(() =>
            summary.evaluate((element) => element.matches(":focus-visible")),
          )
          .toBe(true);
        const observations = [await measure()];
        if (testInfo.project.name === "mobile") {
          try {
            await page.setViewportSize({
              width: 320,
              height: configuredViewport.height,
            });
            await expect
              .poll(async () => (await measure()).checks)
              .toEqual(expectedChecks);
            await expect(
              region.locator(".booking-cottage-thumbnail"),
            ).toHaveCount(0);
            await expect(
              identity.getByText("Fictional Preserved Cottage", {
                exact: true,
              }),
            ).toBeVisible();
            await expect(identity.locator("bdi")).toHaveText(
              `CUSTOMER-REVIEW-HOLD-${namespace}`,
            );
            observations.push(await measure());
          } finally {
            await page.setViewportSize(configuredViewport);
          }
          await expect
            .poll(async () => (await measure()).checks)
            .toEqual(expectedChecks);
        }
        const observationPath = testInfo.outputPath(
          `completed-booking-record-${locale}.json`,
        );
        await writeFile(observationPath, JSON.stringify(observations, null, 2));
        await testInfo.attach(`completed-booking-record-${locale}`, {
          path: observationPath,
          contentType: "application/json",
        });
        await region.locator("header").getByRole("link").focus();
      });
    };
    await signInPhone(page, fixture.phones.owner, ownerPath("en"));
    {
      const heading = page.getByRole("main").locator("header.page-heading");
      await expect(
        heading.getByRole("heading", {
          level: 1,
          name: bookingLifecycleMessages.en.completed,
        }),
      ).toBeVisible();
      await observeRecordHeading(
        page,
        testInfo,
        accessMessages.en.backToBookings,
        "/en/bookings?workspace=owner",
        "heading-owner-completed-en-a11y",
      );
      await observeCompletedRecord("en");
      if (testInfo.project.name === "desktop") {
        const returnLink = heading.getByRole("link", {
          name: accessMessages.en.backToBookings,
          exact: true,
        });
        await returnLink.evaluate((link) => (link as HTMLElement).blur());
        await expect
          .poll(() =>
            returnLink.evaluate((link) => link.matches(":focus-visible")),
          )
          .toBe(false);
        await page.screenshot({
          path: testInfo.outputPath("heading-owner-completed-en.png"),
        });
      }
    }
    const ownerReview = page.getByRole("region", {
      name: "Customer review",
      exact: true,
    });
    await expect(ownerReview.getByText(reviewBody)).toBeVisible();
    await expect(ownerReview.getByLabel("Public reply")).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("owner-reply-form-en.png"),
      fullPage: true,
    });

    const publishReply = ownerReview.getByRole("button", {
      name: "Publish reply",
    });
    await ownerReview.getByLabel("Public reply").fill("Call +9647501234567");
    await publishReply.click();
    await expect(ownerReview.getByRole("alert")).toContainText(
      "Remove contact details",
    );
    await page.screenshot({
      path: testInfo.outputPath("owner-reply-contact-refused-en.png"),
      fullPage: true,
    });
    expect(countReviewRows("customer_review_replies")).toBe("0");

    await ownerReview.getByLabel("Public reply").fill(replyBody);
    const replyPublishControl = publishReply;
    await replyPublishControl.focus();
    await expect(replyPublishControl).toBeFocused();
    await replyPublishControl.press("Enter");
    const expectPublishedReply = async () => {
      await expect(
        ownerReview.getByRole("heading", { name: "Your reply" }),
      ).toBeVisible();
      await expect(ownerReview.getByRole("status")).toContainText(
        "Your reply was published.",
      );
      await expect(publishReply).toHaveCount(0);
      await expect(ownerReview).not.toContainText("Visible to visitors");
    };
    await expectPublishedReply();
    await expect(
      ownerReview.getByRole("heading", {
        name: "Customer review",
        exact: true,
        level: 2,
      }),
    ).toBeFocused();

    await page.reload();
    await expectPublishedReply();
    const ownerClient = await signedInPhoneClient(fixture.phones.owner);
    const repeated = await ownerClient.rpc("submit_customer_review_reply", {
      target_reference: fixture.ids.bookingReference,
      target_original_language: "en",
      target_original_body: replyBody,
    });
    expect(repeated.error).toBeNull();
    expect(repeated.data).toMatchObject({ status: "duplicate" });
    expect(countReviewRows("customer_review_replies")).toBe("1");

    const origin = new URL(page.url()).origin;
    const visitorContext = await browser.newContext({ baseURL: origin });
    const visitor = await visitorContext.newPage();
    const publicPath = (locale: "en" | "ar" | "ckb") =>
      `/${locale}/cottages/${fixture.publicSlug}/reviews`;
    const publicReview = visitor
      .getByRole("article")
      .filter({ hasText: reviewBody });
    for (const { locale, ownerReply, direction } of [
      { locale: "en", ownerReply: "Cottage Owner reply", direction: "ltr" },
      { locale: "ar", ownerReply: "رد مالك البيت", direction: "rtl" },
      { locale: "ckb", ownerReply: "وەڵامی خاوەن کۆتێج", direction: "rtl" },
    ] as const) {
      await visitor.goto(publicPath(locale));
      await expect(
        publicReview.getByText(ownerReply, { exact: true }),
      ).toBeVisible();
      await expect(publicReview.getByText(replyBody)).toHaveAttribute(
        "lang",
        "en",
      );
      await expect(publicReview.getByText(replyBody)).toHaveAttribute(
        "dir",
        "auto",
      );
      await expect(visitor.locator("html")).toHaveAttribute("dir", direction);
      await visitor.screenshot({
        path: testInfo.outputPath(`public-reply-${locale}.png`),
        fullPage: true,
      });
    }

    // Wording is the copy table of the translated-reviews plan, not the application's own messages.
    const arabic = {
      review: "إقامة هادئة بجانب الحديقة.",
      reply: "شكراً لإقامتكم معنا.",
      label: "ترجمة آلية · ترجمة خيالية للاختبار المحلي",
      translate: "ترجمة",
      viewOriginal: "عرض الأصل",
      viewTranslation: "عرض الترجمة",
      report: "الإبلاغ عن ترجمة ضعيفة",
      reported: "تم الإبلاغ عن الترجمة.",
      replyGroup: "رد مالك البيت",
      signIn: "سجّل الدخول للترجمة أو للإبلاغ عن ترجمة",
    };
    const sorani = {
      review: "مانەوەیەکی ئارام لە تەنیشت باخچەکە.",
      label: "وەرگێڕانی خۆکار · وەرگێڕانی خەیاڵی تاقیکردنەوەی ناوخۆیی",
      translate: "وەرگێڕان",
      unavailable: "وەرگێڕان بەردەست نییە. دەقی ڕەسەن پیشان دەدرێت.",
      replyGroup: "وەڵامی خاوەن کۆتێج",
    };
    const expectText = async (text: Locator, lang: string, dir: string) => {
      await expect(text).toBeVisible();
      await expect(text).toHaveAttribute("lang", lang);
      await expect(text).toHaveAttribute("dir", dir);
    };
    const countReports = () =>
      fixture.harness.runSql(`select count(*)
        from public.customer_review_translation_reports reports
        join public.customer_review_translations stored on stored.id=reports.translation_id
        join public.customer_reviews reviews on reviews.id=stored.review_id
        where reviews.booking_request_id='${fixture.ids.requestId}';`);
    const countReplyTranslations = () =>
      fixture.harness.runSql(`select count(*)
        from public.customer_review_translations stored
        join public.customer_reviews reviews on reviews.id=stored.review_id
        where reviews.booking_request_id='${fixture.ids.requestId}'
          and stored.subject='reply';`);

    await test.step("the signed-in Cottage Owner translates the reply and the review into Arabic, switches to the original and reports the translation once", async () => {
      await page.goto(publicPath("ar"));
      const card = page.getByRole("article");
      await expect(card).toHaveCount(1);
      const reply = card.getByRole("group", { name: arabic.replyGroup });
      // The review's controls come before the reply group in the card.
      const reviewButton = (name: string) =>
        card.getByRole("button", { name, exact: true }).first();
      await expect(card.getByText(arabic.label)).toHaveCount(0);

      const replyTranslateArControl = reply.getByRole("button", {
        name: arabic.translate,
        exact: true,
      });
      await replyTranslateArControl.focus();
      await expect(replyTranslateArControl).toBeFocused();
      await replyTranslateArControl.press("Enter");
      await expect(reply.getByText(arabic.label)).toBeVisible();
      await expectText(reply.getByText(arabic.reply), "ar", "rtl");
      await expect(
        reply.getByRole("button", { name: arabic.viewOriginal, exact: true }),
      ).toBeFocused();

      // Pressing Translate from the keyboard leaves the focus on the same control.
      const reviewTranslateArControl = card.getByRole("button", {
        name: arabic.translate,
        exact: true,
      });
      await reviewTranslateArControl.focus();
      await expect(reviewTranslateArControl).toBeFocused();
      await reviewTranslateArControl.press("Enter");
      await expectText(card.getByText(arabic.review), "ar", "rtl");
      await expect(card.getByText(arabic.label)).toHaveCount(2);
      await expect(reviewButton(arabic.viewOriginal)).toBeFocused();

      await page.screenshot({
        path: testInfo.outputPath("public-translated-ar.png"),
        fullPage: true,
      });
      const viewport = page.viewportSize()!;
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: testInfo.outputPath("public-translated-ar-390.png"),
        fullPage: true,
      });
      await page.setViewportSize(viewport);

      await reviewButton(arabic.viewOriginal).click();
      await expectText(card.getByText(reviewBody), "en", "auto");
      await expect(card.getByText(arabic.review)).toHaveCount(0);
      await expect(card.getByText(arabic.label)).toHaveCount(1);
      await page.screenshot({
        path: testInfo.outputPath("public-original-ar.png"),
        fullPage: true,
      });
      await reviewButton(arabic.viewTranslation).click();
      await expectText(card.getByText(arabic.review), "ar", "rtl");

      // Pressing Report from the keyboard leaves the focus on the block's first control.
      const reviewReportArControl = reviewButton(arabic.report);
      await reviewReportArControl.focus();
      await expect(reviewReportArControl).toBeFocused();
      await reviewReportArControl.press("Enter");
      await expect(card.getByText(arabic.reported)).toBeVisible();

      await expect(reviewButton(arabic.viewOriginal)).toBeFocused();
      await expect(
        card.getByRole("button", { name: arabic.report, exact: true }),
      ).toHaveCount(1);
      expect(countReports()).toBe("1");
      await page.screenshot({
        path: testInfo.outputPath("public-translation-reported-ar.png"),
        fullPage: true,
      });

      await page.reload();
      await expectText(card.getByText(arabic.review), "ar", "rtl");
      await expect(
        card.getByRole("button", { name: arabic.report, exact: true }),
      ).toHaveCount(2);
      await reviewButton(arabic.report).click();
      await expect(card.getByText(arabic.reported)).toBeVisible();
      expect(countReports()).toBe("1");
    });

    await test.step("the signed-out visitor reads the stored Arabic translation with the original one press away, and has no Translate or Report control", async () => {
      await visitor.goto(publicPath("ar"));
      const card = visitor.getByRole("article");
      await expectText(card.getByText(arabic.review), "ar", "rtl");
      await expectText(card.getByText(arabic.reply), "ar", "rtl");
      await expect(card.getByText(arabic.label)).toHaveCount(2);
      await expect(
        visitor.getByRole("link", { name: arabic.signIn }),
      ).toBeVisible();
      for (const name of [arabic.translate, arabic.report])
        await expect(
          visitor.getByRole("button", { name, exact: true }),
        ).toHaveCount(0);
      await visitor.screenshot({
        path: testInfo.outputPath("public-signed-out-ar.png"),
        fullPage: true,
      });
      await card
        .getByRole("button", { name: arabic.viewOriginal, exact: true })
        .first()
        .click();
      await expectText(card.getByText(reviewBody), "en", "auto");
    });

    await test.step("the Sorani page translates the review and falls back to the original reply with the unavailable message", async () => {
      await page.goto(publicPath("ckb"));
      const card = page.getByRole("article");
      const reply = card.getByRole("group", { name: sorani.replyGroup });
      await card
        .getByRole("button", { name: sorani.translate, exact: true })
        .first()
        .click();
      await expectText(card.getByText(sorani.review), "ckb", "rtl");
      await expect(card.getByText(sorani.label)).toHaveCount(1);

      const replyTranslate = reply.getByRole("button", {
        name: sorani.translate,
        exact: true,
      });
      await replyTranslate.click();
      await expect(reply.getByRole("alert")).toContainText(sorani.unavailable);
      await expectText(reply.getByText(replyBody), "en", "auto");
      await expect(replyTranslate).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath("public-reply-fallback-ckb.png"),
        fullPage: true,
      });
    });

    await test.step("the English page offers no translation control", async () => {
      await page.goto(publicPath("en"));
      const card = page.getByRole("article");
      await expectText(card.getByText(reviewBody), "en", "auto");
      await expectText(card.getByText(replyBody), "en", "auto");
      await expect(
        page.getByRole("button", {
          name: /Translate|View original|View translation|Report poor translation/,
        }),
      ).toHaveCount(0);
    });

    for (const { locale, replyTitle } of [
      { locale: "ar", replyTitle: "ردّك" },
      { locale: "ckb", replyTitle: "وەڵامی تۆ" },
    ] as const) {
      await page.goto(ownerPath(locale));
      const heading = page.getByRole("main").locator("header.page-heading");
      await expect(
        heading.getByRole("heading", {
          level: 1,
          name: bookingLifecycleMessages[locale].completed,
        }),
      ).toBeVisible();
      await observeRecordHeading(
        page,
        testInfo,
        accessMessages[locale].backToBookings,
        `/${locale}/bookings?workspace=owner`,
        `heading-owner-completed-${locale}-a11y`,
      );
      await observeCompletedRecord(locale);
      if (testInfo.project.name === "mobile" && locale === "ar") {
        const returnLink = heading.getByRole("link", {
          name: accessMessages[locale].backToBookings,
          exact: true,
        });
        await returnLink.evaluate((link) => (link as HTMLElement).blur());
        await expect
          .poll(() =>
            returnLink.evaluate((link) => link.matches(":focus-visible")),
          )
          .toBe(false);
        await page.screenshot({
          path: testInfo.outputPath("heading-owner-completed-ar.png"),
        });
      }
      await expect(
        page.getByRole("heading", { name: replyTitle }),
      ).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      if (locale === "ar")
        await page.screenshot({
          path: testInfo.outputPath("owner-reply-published-ar.png"),
          fullPage: true,
        });
    }

    const administrator = await provisionAdministrator(
      `customer-review-reply-${testInfo.project.name}`,
    );
    const administratorContext = await browser.newContext({ baseURL: origin });
    const administratorPage = await administratorContext.newPage();

    await administratorPage.goto("/en/administrator/reviews");
    const secret = await beginAdministratorMfa(
      administratorPage,
      administrator.email,
      administratorReturnLocales[0],
    );
    await administratorPage.getByLabel("Authenticator app code").fill(
      new OTPAuth.TOTP({
        secret: OTPAuth.Secret.fromBase32(secret),
      }).generate(),
    );
    await administratorPage.getByRole("button", { name: "Verify" }).click();
    await expect(administratorPage).toHaveURL("/en/administrator/reviews");
    await test.step("the administrator follows Translation reports, reads the reported pair beside its original, and returns to Review moderation", async () => {
      await administratorPage.screenshot({
        path: testInfo.outputPath("administrator-review-moderation-en.png"),
        fullPage: true,
      });
      await administratorPage
        .getByRole("link", { name: "Translation reports", exact: true })
        .click();
      await expect(administratorPage).toHaveURL(
        "/en/administrator/reviews/translation-reports",
      );
      await expect(
        administratorPage.getByRole("heading", {
          name: "Review translation reports",
          level: 1,
        }),
      ).toBeVisible();
      await expect(
        administratorPage.getByRole("link", {
          name: administratorQueuesMessages.en.title,
        }),
      ).toHaveAttribute("aria-current", "true");
      const reported = administratorPage
        .getByRole("article")
        .filter({ hasText: fixture.ids.bookingReference });
      await expect(reported).toHaveCount(1);
      await expect(
        reported.getByRole("heading", { name: "Customer review text" }),
      ).toBeVisible();
      await expectText(reported.getByText(reviewBody), "en", "auto");
      await expect(
        reported.getByText(
          "Automatic translation · Fictional local-test translation",
        ),
      ).toBeVisible();
      await expectText(reported.getByText(arabic.review), "ar", "rtl");
      for (const source of [
        "fictional-local-test",
        "deterministic-pairs-v1",
        "review-pairs-v1",
      ])
        await expect(reported.getByText(source, { exact: true })).toBeVisible();
      await administratorPage.screenshot({
        path: testInfo.outputPath("administrator-translation-reports-en.png"),
        fullPage: true,
      });
      const reportHeadingViewport = administratorPage.viewportSize()!;
      await administratorPage.setViewportSize(page.viewportSize()!);
      for (const locale of ["en", "ar", "ckb"] as const) {
        if (locale !== "en")
          await administratorPage.goto(
            `/${locale}/administrator/reviews/translation-reports`,
          );
        const heading = administratorPage
          .getByRole("main")
          .locator("header.page-heading");
        await expect(
          heading.getByRole("heading", {
            level: 1,
            name: customerReviewMessages[locale].translationReportsTitle,
          }),
        ).toBeVisible();
        const returnLink = await observeRecordHeading(
          administratorPage,
          testInfo,
          customerReviewMessages[locale].administratorTitle,
          `/${locale}/administrator/reviews`,
          `heading-reports-${locale}-a11y`,
        );
        if (testInfo.project.name === "mobile" && locale === "ckb")
          await administratorPage.screenshot({
            path: testInfo.outputPath("heading-reports-ckb.png"),
          });
        await returnLink.press("Enter");
        await expect(administratorPage).toHaveURL(
          `/${locale}/administrator/reviews`,
        );
      }
      await administratorPage.setViewportSize(reportHeadingViewport);
      await administratorPage.goto("/en/administrator/reviews");
    });
    const review = await openAdministratorReview(
      administratorPage,
      fixture.ids.bookingReference,
    );
    const administratorReply = review.getByRole("region", {
      name: "Cottage Owner reply",
    });
    await expect(administratorReply.getByText(replyBody)).toBeVisible();
    await expect(administratorReply).toContainText(fixture.identities.owner);
    await administratorPage.screenshot({
      path: testInfo.outputPath("administrator-reply-hide-form-en.png"),
      fullPage: true,
    });
    const hideReply = administratorReply.getByRole("button", {
      name: "Hide reply",
    });
    await hideReply.click();
    await expect(administratorReply.getByRole("alert")).toContainText(
      "Enter a reason",
    );
    await administratorReply
      .getByLabel("Reason for hiding the reply")
      .fill(reason);
    const replyHideControl = hideReply;
    await replyHideControl.focus();
    await expect(replyHideControl).toBeFocused();
    await replyHideControl.press("Enter");
    await expect(administratorReply.getByRole("status")).toContainText(
      "The reply was hidden.",
    );
    await expect(
      administratorPage.getByRole("heading", {
        name: "Customer review moderation",
        level: 1,
      }),
    ).toBeFocused();

    await expect(administratorReply).toContainText(reason);
    await administratorPage.screenshot({
      path: testInfo.outputPath("administrator-reply-hidden-en.png"),
      fullPage: true,
    });
    await expect(
      review.getByRole("button", { name: "Hide review" }),
    ).toBeVisible();
    expect(countReviewRows("customer_review_reply_hides")).toBe("1");
    expect(countReviewRows("customer_review_hides")).toBe("0");

    await visitor.goto(publicPath("en"));
    await expect(publicReview.getByText(reviewBody)).toBeVisible();
    await expect(visitor.getByText("Cottage Owner reply")).toHaveCount(0);
    await expect(visitor.getByText(replyBody)).toHaveCount(0);

    await test.step("a hidden reply takes its stored translation off the public page", async () => {
      await visitor.goto(publicPath("ar"));
      const card = visitor.getByRole("article");
      await expectText(card.getByText(arabic.review), "ar", "rtl");
      await expect(card.getByText(arabic.label)).toHaveCount(1);
      await expect(visitor.getByText(arabic.replyGroup)).toHaveCount(0);
      await expect(visitor.getByText(arabic.reply)).toHaveCount(0);
      await expect(visitor.getByText(replyBody)).toHaveCount(0);
      // The stored translation is not deleted; the page stops showing it with its hidden parent.
      expect(countReplyTranslations()).toBe("1");
    });

    await page.goto(ownerPath("en"));
    await expect(ownerReview.getByRole("status")).toHaveText(
      "Hidden by RentCottage",
    );
    await expect(ownerReview).not.toContainText(reason);
    await expect(publishReply).toHaveCount(0);
    await page.goto(ownerPath("ckb"));
    await expect(page.getByText(replyBody)).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("owner-reply-hidden-ckb.png"),
      fullPage: true,
    });

    await visitorContext.close();
    await administratorContext.close();

    fixture.harness.runSql(reviewFixtureCleanup(namespace, fixture.identities));
    const reusedUsers = Object.values(fixture.identities)
      .map((user) => `'${user}'`)
      .join(",");
    const cleanupProof = fixture.harness.runSql(`select jsonb_build_object(
      'accountContexts',(select count(*) from public.account_contexts contexts
        where contexts.user_id in (${reusedUsers})),
      'accountNames',(select count(*) from public.account_names names
        where names.user_id in (${reusedUsers})),
      'authUsers',(select count(*) from auth.users users
        where users.id in (${reusedUsers})),
      'customerReviews',(select count(*) from public.customer_reviews reviews
        where reviews.booking_request_id='${fixture.ids.requestId}')
    );`);
    expect(JSON.parse(cleanupProof)).toEqual({
      accountContexts: 0,
      accountNames: 0,
      authUsers: 3,
      customerReviews: 0,
    });
  } finally {
    fixture.harness.runSql(reviewFixtureCleanup(namespace, fixture.identities));
  }
});

test.describe("administrator review return", () => {
  let protectedReview: Awaited<ReturnType<typeof seedFixture>>;
  let protectedReviewBody: string;

  test.beforeAll(async ({}, testInfo) => {
    const projectName = testInfo.project
      .name as keyof typeof administratorReturnNamespaces;
    const namespace = administratorReturnNamespaces[projectName];
    if (!namespace)
      throw new Error("Administrator return browser project is unmapped");
    protectedReview = await seedFixture(namespace);
    protectedReviewBody = `Administrator return protected review ${namespace}`;
    const reviewId = `92000000-0000-4000-8000-00000000${namespace}01`;
    const inserted = JSON.parse(
      protectedReview.harness.runSql(`with inserted as (
        insert into public.customer_reviews(
          id,booking_request_id,booking_confirmation_id,profile_id,
          author_user_id,rating,original_language,original_body,submitted_at
        )
        select '${reviewId}',requests.id,confirmations.id,requests.profile_id,
          requests.customer_user_id,5,'en','${protectedReviewBody}',clock_timestamp()
        from public.booking_requests requests
        join public.booking_confirmations confirmations
          on confirmations.booking_request_id=requests.id
        where requests.id='${protectedReview.ids.requestId}'
        returning id,original_body
      ) select jsonb_build_object(
        'reviewId',inserted.id,
        'originalBody',inserted.original_body
      ) from inserted;`),
    );
    expect(inserted).toEqual({
      reviewId,
      originalBody: protectedReviewBody,
    });
  });

  for (const [index, copy] of administratorReturnLocales.entries()) {
    for (const entry of ["signed-out", "aal1"] as const) {
      test(`${copy.locale} ${entry} administrator review return keeps the chosen language and MFA`, async ({
        page,
      }, testInfo) => {
        const queuePath = `/${copy.locale}/administrator/reviews`;
        const accessPath = `/${copy.locale}/administrator/access?returnTo=${encodeURIComponent(queuePath)}`;
        const administrator = await provisionAdministrator(
          `customer-review-return-${copy.locale}-${entry}-${testInfo.project.name}`,
        );
        await page.context().clearCookies();

        if (entry === "signed-out") {
          const origin =
            administratorReturnLocales[
              (index + administratorReturnLocales.length - 1) %
                administratorReturnLocales.length
            ];
          await page.goto(`/${origin.locale}/administrator/reviews`);
          await expect(page).toHaveURL(
            `/${origin.locale}/administrator/access?returnTo=${encodeURIComponent(`/${origin.locale}/administrator/reviews`)}`,
          );
          await expectAdministratorEmailAccess(page, origin);
          const languageLink = page
            .getByRole("banner")
            .getByRole("link", { name: copy.languageName, exact: true });
          await openHeaderPanel(page, "language");
          await expect(languageLink).toHaveAttribute("href", accessPath);
          await languageLink.click();
          await expect(page).toHaveURL(accessPath);
          await expectAdministratorEmailAccess(page, copy);
        } else {
          await page.goto(`/${copy.locale}/administrator/access`);
          await expectAdministratorEmailAccess(page, copy);
          await beginAdministratorMfa(page, administrator.email, copy);

          await page.goto(queuePath);
          await expect(page).toHaveURL(queuePath);
          await expect(
            page.getByRole("heading", { name: copy.queueTitle }),
          ).toBeVisible();
          await expect(page.getByText(copy.accessRequired)).toBeVisible();
          await expect(page.getByRole("article")).toHaveCount(0);
          await expect(
            page.getByText(protectedReview.ids.bookingReference),
          ).toHaveCount(0);
          await expect(page.getByText(protectedReviewBody)).toHaveCount(0);
          await expect(page.locator("html")).toHaveAttribute(
            "dir",
            copy.direction,
          );

          const recovery = page.getByRole("link", {
            name: copy.accessAction,
          });
          await expect(recovery).toHaveAttribute("href", accessPath);
          await recovery.press("Enter");
          await expect(page).toHaveURL(accessPath);
          await expectAdministratorEmailAccess(page, copy);
        }

        await expect(page.getByRole("article")).toHaveCount(0);
        await expect(
          page.getByText(protectedReview.ids.bookingReference),
        ).toHaveCount(0);
        await expect(page.getByText(protectedReviewBody)).toHaveCount(0);
        const secret = await beginAdministratorMfa(
          page,
          administrator.email,
          copy,
        );

        await page.getByLabel(copy.mfaCode).fill("12");
        await page.getByRole("button", { name: copy.verify }).press("Enter");
        await expect(page.getByText(copy.invalidCode)).toBeVisible();
        await expect(page).toHaveURL(accessPath);
        await expect(page.getByLabel(copy.phone)).toHaveCount(0);
        await expect(
          page.getByText(protectedReview.ids.bookingReference),
        ).toHaveCount(0);
        await expect(page.getByText(protectedReviewBody)).toHaveCount(0);

        await page.getByLabel(copy.mfaCode).fill(
          new OTPAuth.TOTP({
            secret: OTPAuth.Secret.fromBase32(secret),
          }).generate(),
        );
        await page.getByRole("button", { name: copy.verify }).press("Enter");

        await expect(page).toHaveURL(queuePath);
        await expect(
          page.getByRole("heading", { name: copy.queueTitle }),
        ).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute(
          "dir",
          copy.direction,
        );
        const protectedRow = page
          .getByRole("article")
          .filter({ hasText: protectedReview.ids.bookingReference });
        await expect(protectedRow).toHaveCount(1);
        await expect(protectedRow).toContainText(protectedReviewBody);
      });
    }
  }
});

test("Cottage Owner finds reviews and replies from the workspace list", async ({
  page,
  browser,
}, testInfo) => {
  requireLocalDatabase();
  const allocated =
    ownerReviewsNamespaces[
      testInfo.project.name as keyof typeof ownerReviewsNamespaces
    ];
  if (!allocated) throw new Error("Owner Reviews browser project is unmapped");
  const harness = createLocalSupabaseConcurrencyHarness();
  harness.guardDisposableLocalDatabase();
  const requestIds = allocated.map(
    (namespace) => `60000000-0000-4000-8000-00000000${namespace}01`,
  );
  expect(
    harness.runSql(
      `select count(*) from public.booking_requests where id in (${requestIds.map((id) => `'${id}'`).join(",")});`,
    ),
  ).toBe("0");
  let root: Awaited<ReturnType<typeof seedFixture>> | undefined;
  let shared: Awaited<ReturnType<typeof seedFixture>> | undefined;
  let foreign: Awaited<ReturnType<typeof seedFixture>> | undefined;
  const origin =
    process.env.PLAYWRIGHT_SERVER === "worker"
      ? `http://127.0.0.1:${process.env.PLAYWRIGHT_WORKER_PORT ?? "8788"}`
      : `http://127.0.0.1:${process.env.PLAYWRIGHT_NEXT_PORT ?? "3000"}`;
  const visitorContext = await browser.newContext({ baseURL: origin });
  const administratorContext = await browser.newContext({ baseURL: origin });
  try {
    root = await seedFixture(allocated[0]);
    shared = await seedFixture(allocated[1], {
      sharedCottage: {
        namespace: allocated[0],
        ownerUserId: root.identities.owner,
        profileId: root.ids.profileId,
        publicSlug: root.publicSlug,
      },
    });
    foreign = await seedFixture(allocated[2]);
    const bodies = [
      "A peaceful garden for our family.",
      "A welcoming cottage beside the trees.",
      "Foreign owner review must remain private here.",
    ];
    const fixtures = [root, shared, foreign];
    const reviewIds: string[] = [];
    for (const [index, fixture] of fixtures.entries()) {
      const customer = await signedInPhoneClient(fixture.phones.customer);
      const eligible = await customer.rpc("get_customer_review", {
        target_reference: fixture.ids.bookingReference,
      });
      expect(eligible.error).toBeNull();
      expect(eligible.data).toMatchObject({ status: "eligible" });
      const submitted = await customer.rpc("submit_customer_review", {
        target_reference: fixture.ids.bookingReference,
        target_rating: 5,
        target_original_language: "en",
        target_original_body: bodies[index],
      });
      expect(submitted.error).toBeNull();
      expect(submitted.data).toMatchObject({ status: "submitted" });
      reviewIds.push(submitted.data.reviewId);
    }
    const owner = await signedInPhoneClient(root.phones.owner);
    const listed = await owner.rpc("list_owner_customer_reviews", {
      target_before_at: null,
      target_before_id: null,
      target_limit: 20,
    });
    expect(listed.error).toBeNull();
    expect(
      listed.data.items.map((item: { reviewId: string }) => item.reviewId),
    ).toEqual([reviewIds[1], reviewIds[0]]);
    expect(listed.data.nextCursor).toBeNull();
    const listPath = (locale: Locale) => `/${locale}/owner/reviews`;
    await signInPhone(page, root.phones.owner, "/en/owner/cottages");
    const rows = page.getByRole("main").locator("ul.list-rows > li");
    for (const [locale, title, area, noReply] of [
      ["en", "Reviews", "Owner Backoffice", "No reply yet"],
      ["ar", "التقييمات", "مكتب مالك الكوخ", "لم يتم الرد بعد"],
      [
        "ckb",
        "هەڵسەنگاندنەکان",
        "بەشی بەڕێوەبردنی خاوەن کۆتێج",
        "هێشتا وەڵام نەدراوەتەوە",
      ],
    ] as const) {
      if (locale !== "en") await page.goto(`/${locale}/owner/cottages`);
      const tab = page
        .getByRole("navigation", { name: area })
        .getByRole("link", { name: title, exact: true });
      if (testInfo.project.name === "mobile") await tab.tap();
      else {
        await tab.focus();
        await page.keyboard.press("Enter");
      }
      await expect(page).toHaveURL(listPath(locale));
      await expect(
        page.getByRole("heading", { level: 1, name: title }),
      ).toBeVisible();
      await expect(tab).toHaveAttribute("aria-current", "page");
      await expect(page.locator("html")).toHaveAttribute(
        "dir",
        locale === "en" ? "ltr" : "rtl",
      );
      await expect(rows).toHaveCount(2);
      await expect(rows.nth(0)).toContainText(bodies[1]);
      await expect(rows.nth(1)).toContainText(bodies[0]);
      await expect(
        rows.nth(0).getByText(noReply, { exact: true }),
      ).toBeVisible();
      await expect(
        rows.nth(1).getByText(noReply, { exact: true }),
      ).toBeVisible();
      await expect(page.getByText(bodies[2])).toHaveCount(0);
      await expect(
        rows.nth(1).getByRole("link", { name: "Fictional Preserved Cottage" }),
      ).toHaveAttribute(
        "href",
        `/${locale}/owner/booking-requests/${root.ids.bookingReference}`,
      );
      const replyField = rows.nth(1).getByRole("textbox");
      await replyField.focus();
      await page.keyboard.press("Tab");
      await expect(rows.nth(1).getByRole("combobox")).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(rows.nth(1).getByRole("button")).toBeFocused();
      const observation = await page.getByRole("main").evaluate((main) => ({
        locale: document.documentElement.lang,
        viewport: { width: innerWidth, height: innerHeight },
        scrollWidth: document.documentElement.scrollWidth,
        elements: Array.from(
          main.querySelectorAll(
            "h1,h2,p,small,a,button,textarea,select,.status-badge",
          ),
          (element) => {
            const style = getComputedStyle(element);
            const backgrounds = [];
            for (
              let ancestor: Element | null = element;
              ancestor;
              ancestor = ancestor.parentElement
            )
              backgrounds.push({
                tag: ancestor.tagName,
                background: getComputedStyle(ancestor).backgroundColor,
              });
            return {
              tag: element.tagName,
              text: element.textContent,
              id: element.id,
              label: element.getAttribute("aria-label"),
              labelledBy: element.getAttribute("aria-labelledby"),
              describedBy: element.getAttribute("aria-describedby"),
              rect: element.getBoundingClientRect().toJSON(),
              color: style.color,
              background: style.backgroundColor,
              border: style.borderColor,
              outline: {
                color: style.outlineColor,
                width: style.outlineWidth,
                offset: style.outlineOffset,
              },
              shadow: style.boxShadow,
              fontSize: style.fontSize,
              fontWeight: style.fontWeight,
              focused: element.matches(":focus-visible"),
              backgrounds,
            };
          },
        ),
      }));
      expect(observation.scrollWidth).toBeLessThanOrEqual(
        observation.viewport.width + 1,
      );
      await testInfo.attach(`owner-reviews-${locale}-rendered-a11y`, {
        body: JSON.stringify(observation, null, 2),
        contentType: "application/json",
      });
      if (
        testInfo.project.name === "mobile" ||
        (locale === "en" &&
          (testInfo.project.name === "desktop" ||
            testInfo.project.name === "worker"))
      )
        await page.screenshot({
          path: testInfo.outputPath(
            `owner-reviews-${testInfo.project.name}-${locale}.png`,
          ),
          fullPage: true,
        });
    }
    await page.goto(listPath("en"));
    const firstForm = rows.nth(0);
    const secondForm = rows.nth(1);
    const field = secondForm.getByLabel("Public reply");
    const publish = secondForm.getByRole("button", { name: "Publish reply" });
    await field.fill("Call +9647501234567");
    await publish.click();
    await expect(secondForm.getByRole("alert")).toContainText(
      "Remove contact details",
    );
    await expect(firstForm.getByLabel("Public reply")).toHaveValue("");
    await expect(
      secondForm.getByRole("button", { name: "Publish reply" }),
    ).toBeFocused();
    await testInfo.attach("owner-reviews-refusal-a11y", {
      body: JSON.stringify(
        await secondForm.getByRole("alert").evaluate((element) => ({
          role: element.getAttribute("role"),
          text: element.textContent,
          color: getComputedStyle(element).color,
          background: getComputedStyle(element).backgroundColor,
          rect: element.getBoundingClientRect().toJSON(),
        })),
      ),
      contentType: "application/json",
    });
    if (testInfo.project.name === "desktop")
      await page.screenshot({
        path: testInfo.outputPath("owner-reviews-contact-refused-focus.png"),
        fullPage: true,
      });
    const replyBody = "Thank you for enjoying our garden.";
    await field.fill(replyBody);
    await publish.focus();
    await page.keyboard.press("Enter");
    await expect(
      secondForm.getByRole("heading", { name: "Your reply" }),
    ).toBeVisible();
    await expect(
      secondForm.getByText("Replied", { exact: true }),
    ).toBeVisible();
    await expect(
      secondForm.getByRole("heading", { name: "Customer review", exact: true }),
    ).toBeFocused();
    await testInfo.attach("owner-reviews-published-focus-a11y", {
      body: JSON.stringify(
        await secondForm
          .getByRole("heading", { name: "Customer review", exact: true })
          .evaluate((element) => {
            const style = getComputedStyle(element);
            const backgrounds = [];
            for (
              let ancestor: Element | null = element;
              ancestor;
              ancestor = ancestor.parentElement
            )
              backgrounds.push(getComputedStyle(ancestor).backgroundColor);
            return {
              rect: element.getBoundingClientRect().toJSON(),
              focused: element.matches(":focus-visible"),
              color: style.color,
              border: style.borderColor,
              outline: {
                color: style.outlineColor,
                width: style.outlineWidth,
                offset: style.outlineOffset,
              },
              shadow: style.boxShadow,
              backgrounds,
            };
          }),
      ),
      contentType: "application/json",
    });
    await expect(secondForm.getByRole("textbox")).toHaveCount(0);
    await expect(firstForm.getByRole("textbox")).toHaveValue("");
    await page.reload();
    await expect(secondForm.getByText(replyBody)).toBeVisible();
    const stored = await owner.rpc("get_owner_customer_review", {
      target_reference: root.ids.bookingReference,
    });
    expect(stored.error).toBeNull();
    expect(stored.data.reply.originalBody).toBe(replyBody);
    const untouched = await owner.rpc("get_owner_customer_review", {
      target_reference: shared.ids.bookingReference,
    });
    expect(untouched.error).toBeNull();
    expect(untouched.data.reply).toBeNull();
    await secondForm
      .getByRole("link", { name: "Fictional Preserved Cottage" })
      .click();
    await expect(page).toHaveURL(
      `/en/owner/booking-requests/${root.ids.bookingReference}`,
    );
    await expect(
      page
        .getByRole("region", { name: "Customer review", exact: true })
        .getByText(replyBody),
    ).toBeVisible();
    const visitor = await visitorContext.newPage();
    const publicPath = `/en/cottages/${root.publicSlug}/reviews`;
    await visitor.goto(publicPath);
    await expect(
      visitor
        .getByRole("article")
        .filter({ hasText: bodies[0] })
        .getByText(replyBody),
    ).toBeVisible();
    await page.goto(listPath("en"));
    await page.getByRole("main").evaluate((main) => {
      main.style.zoom = "2";
    });
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      )
      .toBe(true);
    await expect(secondForm.getByText(replyBody)).toBeVisible();
    await testInfo.attach("owner-reviews-200-percent", {
      body: JSON.stringify(
        await page.getByRole("main").evaluate((main) => ({
          zoom: getComputedStyle(main).zoom,
          viewport: innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          heading: main.querySelector("h1")!.getBoundingClientRect().toJSON(),
        })),
      ),
      contentType: "application/json",
    });
    await page.getByRole("main").evaluate((main) => {
      main.style.zoom = "";
    });
    const administrator = await provisionAdministrator(
      `owner-reviews-${testInfo.project.name}`,
    );
    const administratorPage = await administratorContext.newPage();
    await administratorPage.goto("/en/administrator/reviews");
    const secret = await beginAdministratorMfa(
      administratorPage,
      administrator.email,
      administratorReturnLocales[0],
    );
    await administratorPage.getByLabel("Authenticator app code").fill(
      new OTPAuth.TOTP({
        secret: OTPAuth.Secret.fromBase32(secret),
      }).generate(),
    );
    await administratorPage.getByRole("button", { name: "Verify" }).click();
    await expect(administratorPage).toHaveURL("/en/administrator/reviews");
    const review = await openAdministratorReview(
      administratorPage,
      root.ids.bookingReference,
    );
    const replyRegion = review.getByRole("region", {
      name: "Cottage Owner reply",
    });
    const replyReason = "Private workspace reply moderation fixture";
    await replyRegion
      .getByLabel("Reason for hiding the reply")
      .fill(replyReason);
    await replyRegion
      .getByRole("button", { name: "Hide reply", exact: true })
      .click();
    await expect(replyRegion.getByRole("status")).toContainText(
      "The reply was hidden.",
    );
    await page.reload();
    await expect(secondForm.getByRole("status")).toHaveText(
      "Hidden by RentCottage",
    );
    await expect(secondForm.getByText(replyBody)).toBeVisible();
    await expect(page.getByText(replyReason)).toHaveCount(0);
    await visitor.reload();
    await expect(visitor.getByText(replyBody)).toHaveCount(0);
    await expect(visitor.getByText(bodies[0])).toBeVisible();
    const reviewReason = "Private workspace review moderation fixture";
    await review
      .getByLabel("Reason for hiding", { exact: true })
      .fill(reviewReason);
    await review
      .getByRole("button", { name: "Hide review", exact: true })
      .click();
    await expect(
      review.getByRole("status").filter({ hasText: "The review was hidden." }),
    ).toBeVisible();
    await page.reload();
    await expect(secondForm).toContainText(
      "This review was hidden by RentCottage and is not shown to visitors.",
    );
    await expect(secondForm.getByText(bodies[0])).toHaveCount(0);
    await expect(secondForm.getByText(replyBody)).toBeVisible();
    await expect(page.getByText(reviewReason)).toHaveCount(0);
    await expect(page.getByText(bodies[2])).toHaveCount(0);
    const ownerMarkup = await page.content();
    for (const privateText of [
      reviewReason,
      replyReason,
      bodies[0],
      bodies[2],
      foreign.identities.owner,
      foreign.identities.customer,
      "Fictional private address",
    ])
      expect(ownerMarkup).not.toContain(privateText);
    await visitor.reload();
    await expect(visitor.getByText(bodies[0])).toHaveCount(0);
    await expect(visitor.getByText(replyBody)).toHaveCount(0);
    harness.runSql(
      `update public.account_contexts set owner_approval_state='suspended' where user_id='${root.identities.owner}';`,
    );
    const denied = await owner.rpc("list_owner_customer_reviews", {
      target_limit: 20,
    });
    expect(denied.error?.code).toBe("42501");
    await page.reload();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "This booking is not available to this account.",
    );
    await expect(page.getByText(bodies[1])).toHaveCount(0);
    await expect(page.getByRole("textbox")).toHaveCount(0);
  } finally {
    for (const attachment of testInfo.attachments) {
      if (attachment.contentType === "application/json" && attachment.body) {
        await writeFile(
          testInfo.outputPath(`${attachment.name}.json`),
          attachment.body,
        );
      }
    }
    await visitorContext.close();
    await administratorContext.close();
    if (shared)
      harness.runSql(reviewFixtureCleanup(allocated[1], shared.identities));
    if (root)
      harness.runSql(reviewFixtureCleanup(allocated[0], root.identities));
    if (foreign)
      harness.runSql(reviewFixtureCleanup(allocated[2], foreign.identities));
  }
});
