import { expect, test, type Page, type Response } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import * as OTPAuth from "otpauth";

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
const password = "Local-test-password-2026";

const administratorReturnLocales = [
  {
    locale: "en",
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
    accessRequired: "چوونەژوورەوەی بەڕێوەبەر بە دڵنیایی ئەپ پێویستە.",
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

async function seedFixture(
  namespace: string,
  options: {
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
    '"items":[{"serviceDay":"2101-01-01","kind":"shift","position":1,"displayName":"Morning","startsAt":"2101-01-01T08:00:00+03:00","endsAt":"2101-01-01T12:00:00+03:00","crossesMidnight":false,"priceIqd":30000},{"serviceDay":"2101-01-01","kind":"shift","position":3,"displayName":"Night","startsAt":"2101-01-01T20:00:00+03:00","endsAt":"2101-01-02T02:00:00+03:00","crossesMidnight":true,"priceIqd":30000},{"serviceDay":"2101-01-02","kind":"full-day","displayName":"Full day","startsAt":"2101-01-02T08:00:00+03:00","endsAt":"2101-01-02T23:00:00+03:00","crossesMidnight":false,"priceIqd":50000}]';
  let sql = fixture.sql
    .replace(authBlock, "insert into public.account_contexts")
    .replaceAll(
      '"cottageName":"Preserved Cottage","bookingPriceIqd"',
      '"cottageName":"Preserved Cottage","houseRules":"Fictional house rules","bookingPriceIqd"',
    )
    .replaceAll(legacyItems, renderedItems);
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
  harness.runSql(sql);
  const sourceProof = harness.runSql(`select jsonb_build_object(
    'payment',public.booking_request_payment_status(requests),
    'completion',(public.booking_completion_eligibility_at(requests.id,clock_timestamp())->>'status'),
    'discoverable',public.is_cottage_publicly_discoverable(requests.profile_id)
  ) from public.booking_requests requests
  where requests.booking_request_reference='${fixture.ids.bookingReference}';`);
  expect(JSON.parse(sourceProof)).toEqual({
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
  const origin =
    process.env.PLAYWRIGHT_SERVER === "worker"
      ? `http://127.0.0.1:${process.env.PLAYWRIGHT_WORKER_PORT ?? "8788"}`
      : "http://127.0.0.1:3000";
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

async function expectIdentityDenied(phone: string, bookingReference: string) {
  const client = createClient(
    process.env.SUPABASE_URL ?? "",
    process.env.SUPABASE_PUBLISHABLE_KEY ?? "",
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const signedIn = await client.auth.signInWithPassword({ phone, password });
  if (signedIn.error) throw signedIn.error;
  const response = await client.rpc("get_customer_review", {
    target_reference: bookingReference,
  });
  expect(response.error?.code).toBe("42501");
}

function anchoredServiceDay(anchor: string, offset: number) {
  expect(anchor).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  const operator = offset < 0 ? "-" : "+";
  return `'${anchor}'::date${operator}${Math.abs(offset)}`;
}

test("Customer review publishes, paginates, survives moderation audit, and disappears publicly", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(testInfo.project.name === "worker" ? 480_000 : 180_000);
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
    page.getByRole("status").filter({ hasText: "Your review was published." }),
  ).toBeVisible();
  await page.reload();
  const authorReview = page.getByRole("region", { name: "Your review" });
  await expect(authorReview.getByText(original)).toHaveAttribute("lang", "en");
  await expect(authorReview.getByText(original)).toHaveAttribute("dir", "auto");
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
    const startDaySql = anchoredServiceDay(serviceDateAnchor, serviceDayOffset);
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
    ckb: "تەنها هەڵسەنگاندن",
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
  await page.screenshot({
    path: testInfo.outputPath("customer-review-submitted.png"),
    fullPage: true,
  });

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
    aal1.getByText("Authenticator-verified administrator access is required."),
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
  const visitedAdministratorPages = new Set<string>();
  let targetAdministratorPage: string | undefined;
  while (true) {
    expect(visitedAdministratorPages.has(page.url())).toBe(false);
    visitedAdministratorPages.add(page.url());
    if (
      (await page
        .getByRole("article")
        .filter({ hasText: primary.ids.bookingReference })
        .count()) === 1
    ) {
      targetAdministratorPage = page.url();
    }
    const next = page.getByRole("link", { name: "Next reviews" });
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
  const review = page
    .getByRole("article")
    .filter({ hasText: primary.ids.bookingReference });
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
  await review.getByRole("button", { name: "Hide review" }).click();
  await expect(review.getByRole("status")).toContainText(
    "The review was hidden.",
  );
  await expect(review).toContainText(reason);
  await page.reload();
  await expect(review.getByText(original)).toBeVisible();
  await expect(review.getByText(reason)).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("customer-review-hidden-audit.png"),
    fullPage: true,
  });

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
      if (response.url().includes(`/cottages/${primary.publicSlug}/reviews`)) {
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

  for (const copy of administratorReturnLocales) {
    for (const entry of ["signed-out", "aal1"] as const) {
      test(`${copy.locale} ${entry} administrator review return preserves locale and MFA`, async ({
        page,
      }, testInfo) => {
        test.setTimeout(testInfo.project.name === "worker" ? 240_000 : 120_000);
        const queuePath = `/${copy.locale}/administrator/reviews`;
        const accessPath = `/${copy.locale}/administrator/access?returnTo=${encodeURIComponent(queuePath)}`;
        const administrator = await provisionAdministrator(
          `customer-review-return-${copy.locale}-${entry}-${testInfo.project.name}`,
        );
        await page.context().clearCookies();

        if (entry === "signed-out") {
          await page.goto(queuePath);
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
          await page.screenshot({
            path: testInfo.outputPath(
              `${copy.locale}-aal1-administrator-review-return-denied.png`,
            ),
            fullPage: true,
          });

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
        await page.screenshot({
          path: testInfo.outputPath(
            `${copy.locale}-${entry}-administrator-review-return-invalid-code.png`,
          ),
          fullPage: true,
        });

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
        await page.screenshot({
          path: testInfo.outputPath(
            `${copy.locale}-${entry}-administrator-review-return-queue.png`,
          ),
          fullPage: true,
        });
      });
    }
  }
});
