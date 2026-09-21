import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
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
    publish: boolean;
  }): ReviewFixture;
};
const customerReviewFixtureModule: Promise<CustomerReviewFixtureModule> = import(
  // @ts-expect-error The repository fixture is an ESM JavaScript module without declarations.
  "../scripts/lib/customer-review-fixture.mjs"
);
const { createLocalSupabaseConcurrencyHarness } = createRequire(import.meta.url)(
  "../scripts/local-supabase-concurrency-harness.mjs",
) as {
  createLocalSupabaseConcurrencyHarness(): {
    guardDisposableLocalDatabase(): void;
    runSql(sql: string): string;
  };
};

const namespaces = {
  mobile: ["61", "64"],
  desktop: ["62", "65"],
  worker: ["63", "66"],
} as const;
const password = "Local-test-password-2026";

function fixtureId(prefix: string, namespace: string, sequence: number) {
  return `${prefix}-0000-4000-8000-00000000${namespace}${String(sequence).padStart(2, "0")}`;
}

function requireLocalDatabase() {
  const target = new URL(process.env.SUPABASE_URL ?? "invalid:");
  if (
    process.env.APP_ENVIRONMENT !== "test" ||
    target.protocol !== "http:" ||
    target.hostname !== "127.0.0.1"
  ) {
    throw new Error("Customer review journey requires the guarded local database");
  }
}

async function seedFixture(
  namespace: string,
  sharedCottage?: {
    namespace: string;
    ownerUserId: string;
    profileId: string;
  },
) {
  const { customerReviewFixture } = await customerReviewFixtureModule;
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new Error("Customer review fixture credentials are missing");
  const privileged = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const ensurePhoneUser = async (phone: string) => {
    const listed = await privileged.auth.admin.listUsers({ perPage: 1000 });
    if (listed.error) throw listed.error;
    const existing = listed.data.users.find((user) => user.phone === phone);
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
    startDaySql: `((clock_timestamp() at time zone 'Asia/Baghdad')::date-${sharedCottage ? 5 : 3})`,
    complete: true,
    publish: !sharedCottage,
  });
  const phones = {
    owner: `+964750000${namespace}01`,
    customer: `+964750000${namespace}02`,
    other: `+964750000${namespace}03`,
  };
  const identities = {
    owner: await ensurePhoneUser(phones.owner),
    customer: await ensurePhoneUser(phones.customer),
    other: await ensurePhoneUser(phones.other),
  };
  const authBlock = /insert into auth\.users \(id, aud, role, phone, phone_confirmed_at\) values[\s\S]*?;\ninsert into public\.account_contexts/;
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
  if (sql === fixture.sql) throw new Error("Customer review auth fixture block changed");
  if (!sql.includes(renderedItems) || sql.includes(legacyItems)) {
    throw new Error("Customer review booking presentation fixture changed");
  }
  if (sharedCottage) {
    const cottageSetup = /insert into public\.owner_application_cottage_profiles[\s\S]*?select set_config\('rentcottage\.shift_schedule_write_revision_id','',true\);\n/;
    const withoutCottageSetup = sql.replace(cottageSetup, "");
    if (withoutCottageSetup === sql) {
      throw new Error("Customer review shared-cottage fixture changed");
    }
    sql = withoutCottageSetup
      .replace(
        `('${fixture.ids.ownerUserId}','cottage_owner','approved'),\n`,
        "",
      )
      .replaceAll(fixture.ids.ownerUserId, sharedCottage.ownerUserId)
      .replaceAll(fixture.ids.profileId, sharedCottage.profileId)
      .replaceAll(
        fixtureId("30000000", namespace, 1),
        fixtureId("30000000", sharedCottage.namespace, 1),
      )
      .replaceAll(
        fixtureId("31000000", namespace, 1),
        fixtureId("31000000", sharedCottage.namespace, 1),
      );
    for (const sequence of [1, 2, 3]) {
      sql = sql.replaceAll(
        fixtureId("32000000", namespace, sequence),
        fixtureId("32000000", sharedCottage.namespace, sequence),
      );
    }
  }
  sql = sql
    .replaceAll(
      fixture.ids.ownerUserId,
      sharedCottage?.ownerUserId ?? identities.owner,
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
    completion: "completed",
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

test("Customer review publishes, paginates, survives moderation audit, and disappears publicly", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(testInfo.project.name === "worker" ? 480_000 : 180_000);
  requireLocalDatabase();
  const pair = namespaces[testInfo.project.name as keyof typeof namespaces];
  if (!pair) throw new Error("Customer review browser project is unmapped");
  const primary = await seedFixture(pair[0]);
  const ratingOnly = await seedFixture(pair[1], {
    namespace: pair[0],
    ownerUserId: primary.identities.owner,
    profileId: primary.ids.profileId,
  });

  const bookingPath = `/en/booking-requests/${primary.ids.bookingReference}`;
  await page.goto(bookingPath);
  await expect(
    page.getByRole("heading", { name: "Sign in or create an account" }),
  ).toBeVisible();
  await expectIdentityDenied(primary.phones.other, primary.ids.bookingReference);
  await expectIdentityDenied(primary.phones.owner, primary.ids.bookingReference);

  await signInPhone(page, primary.phones.customer, bookingPath);
  const customerReview = page.getByRole("region", { name: "Review this cottage" });
  await expect(customerReview.getByRole("heading", { name: "Review this cottage" })).toBeVisible();
  await expect(customerReview.getByText("Review window open until", { exact: false })).toBeVisible();

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

  const original = "إقامة هادئة وجميلة بلا تغيير";
  await page.getByRole("radio", { name: "5 stars" }).check();
  await page.getByLabel("Review text (optional)").fill(original);
  await page.getByLabel("Original language").selectOption("ar");
  await page.getByRole("button", { name: "Publish review" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Your review was published." }),
  ).toBeVisible();

  const ratingContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
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

  for (const locale of ["en", "ar", "ckb"] as const) {
    const response = await visitor.goto(`/${locale}/cottages/${primary.publicSlug}/reviews`);
    expect(response?.ok()).toBe(true);
    if (!(await visitor.getByText(original).isVisible().catch(() => false))) {
      await visitor.locator('a[href*="beforeAt="]').click();
    }
    await expect(visitor.getByText(original)).toHaveAttribute("lang", "ar");
    await expect(visitor.getByText(original)).toHaveAttribute("dir", "auto");
    expect(await response!.text()).not.toContain(primary.identities.customer);
    expect(await response!.text()).not.toContain(primary.ids.bookingReference);
    await expect(visitor.locator("html")).toHaveAttribute(
      "dir",
      locale === "en" ? "ltr" : "rtl",
    );
  }
  await page.screenshot({ path: testInfo.outputPath("customer-review-submitted.png"), fullPage: true });

  await page.goto("/en/administrator/access");
  await page.getByLabel("Email").fill(
    `platform-administrator-${testInfo.project.name}@rentcottage.test`,
  );
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Continue" }).click();
  const secret = await page.getByTestId("mfa-secret").textContent();
  if (!secret) throw new Error("Customer review administrator MFA returned no secret");
  const aal1 = await page.context().newPage();
  await aal1.goto("/en/administrator/reviews");
  await expect(aal1.getByText("Authenticator-verified administrator access is required.")).toBeVisible();
  await aal1.close();
  await page.getByLabel("Authenticator app code").fill(
    new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) }).generate(),
  );
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByText("Administrator access is ready.")).toBeVisible();
  await page.goto("/en/administrator/reviews");
  if (!(await page.getByText(original).isVisible().catch(() => false))) {
    await page.getByRole("link", { name: "Next reviews" }).click();
  }
  const review = page.getByRole("article").filter({ hasText: original });
  await expect(review).toContainText(primary.ids.bookingReference);
  await expect(review).toContainText(primary.identities.customer);
  await review.getByRole("button", { name: "Hide review" }).click();
  await expect(review.getByRole("alert")).toContainText("Enter a reason");
  const reason = "Contact-safety moderation fixture";
  await review.getByLabel("Reason for hiding").fill(reason);
  await review.getByRole("button", { name: "Hide review" }).click();
  await expect(review.getByRole("status")).toContainText("The review was hidden.");
  await expect(review).toContainText(reason);
  await page.reload();
  await expect(page.getByText(original)).toBeVisible();
  await expect(page.getByText(reason)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("customer-review-hidden-audit.png"), fullPage: true });

  for (const locale of ["en", "ar", "ckb"] as const) {
    const responseBodies: string[] = [];
    visitor.on("response", async (response) => {
      if (response.url().includes(`/cottages/${primary.publicSlug}/reviews`)) {
        responseBodies.push(await response.text().catch(() => ""));
      }
    });
    await visitor.goto(`/${locale}/cottages/${primary.publicSlug}/reviews`);
    await expect(visitor.getByText(original)).toHaveCount(0);
    const rendered = [await visitor.content(), ...responseBodies].join("\n");
    for (const privateValue of [
      original,
      primary.ids.bookingReference,
      primary.identities.customer,
      reason,
    ]) expect(rendered).not.toContain(privateValue);
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
