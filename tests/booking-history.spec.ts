import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { build } from "esbuild";
import { mkdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

const { createLocalSupabaseConcurrencyHarness } = createRequire(
  import.meta.url,
)("../scripts/local-supabase-concurrency-harness.mjs") as {
  createLocalSupabaseConcurrencyHarness(): {
    guardDisposableLocalDatabase(): void;
    runSql(sql: string): string;
  };
};

async function verifyPhone(page: Page, phone: string) {
  await page.getByLabel("Iraqi phone number").fill(phone);
  await page.getByRole("button", { name: "Send verification code" }).click();
  await expect(page.getByLabel("Verification code")).toBeVisible();
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Verify", exact: true }).click();
}

test("complete customer and owner history stays role-specific, private, translated, and responsive", async ({
  page,
}, testInfo) => {
  const bundlePath = testInfo.outputPath("booking-history.js");
  await build({
    entryPoints: ["tests/fixtures/booking-history.browser.tsx"],
    outfile: bundlePath,
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
    plugins: [
      {
        name: "booking-history-link",
        setup(pluginBuild) {
          pluginBuild.onResolve({ filter: /^next\/link$/ }, () => ({
            path: "history-link",
            namespace: "fixture",
          }));
          pluginBuild.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents:
              "import React from 'react'; export default function Link({href,children}) { return React.createElement('a',{href},children); }",
            loader: "js",
            resolveDir: process.cwd(),
          }));
        },
      },
    ],
  });
  await page.goto("/api/health");
  await page.setContent(
    '<meta name="viewport" content="width=device-width, initial-scale=1"><main class="results-page"><section class="booking-history" id="fixture-root"></section></main>',
  );
  await page.addStyleTag({
    content: await readFile(join(process.cwd(), "src/app/globals.css"), "utf8"),
  });
  await page.addStyleTag({
    content: await readFile(testInfo.outputPath("booking-history.css"), "utf8"),
  });
  await page.addScriptTag({ path: bundlePath });

  for (const locale of ["en", "ar", "ckb"] as const) {
    for (const role of ["customer", "cottage_owner"] as const) {
      await page.evaluate((input) => window.renderBookingHistory(input), {
        locale,
        role,
      });
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.locator("html")).toHaveAttribute(
        "dir",
        locale === "en" ? "ltr" : "rtl",
      );
      const links = page.getByRole("link");
      await expect(links).toHaveCount(7);
      await expect(
        page.getByRole("region", {
          name:
            locale === "en"
              ? "Earnings summary"
              : locale === "ar"
                ? "ملخص الأرباح"
                : "پوختەی داهات",
        }),
      ).toHaveCount(role === "cottage_owner" ? 1 : 0);
      for (let index = 0; index < 7; index += 1) {
        await expect(links.nth(index)).toHaveAttribute(
          "href",
          `/${locale}/${role === "customer" ? "booking-requests" : "owner/booking-requests"}/RC-REQ-${String(index + 1).padStart(16, "0")}`,
        );
      }
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(overflow).toBe(false);
      await page.screenshot({
        path: testInfo.outputPath(`${locale}-${role}-history.png`),
        fullPage: true,
      });
      if (role === "cottage_owner") {
        mkdirSync(".agent-evidence/visual", { recursive: true });
        await page.screenshot({
          path: `.agent-evidence/visual/${testInfo.project.name}-${locale}-owner-earnings-history.png`,
          fullPage: true,
        });
      }
    }
  }
});

test("same-phone reauthentication restores the same real history and owner unpaid detail", async ({
  browser,
  baseURL,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop");
  if (!baseURL) throw new Error("Booking History browser origin is missing");
  const harness = createLocalSupabaseConcurrencyHarness();
  harness.guardDisposableLocalDatabase();
  const customerPhone = "+9647500000008";
  const ownerPhone = "+9647500000009";
  const fixtureCustomerId = "10000000-0000-4000-8000-000000003502";
  const fixtureOwnerId = "10000000-0000-4000-8000-000000003501";
  const unpaidRequest = "60000000-0000-4000-8000-000000003511";
  const unpaidReference = "RC-REQ-0000000000003511";
  const source = readFileSync(
    "supabase/tests/database/booking_confirmation_access.test.sql",
    "utf8",
  );
  const seedStart = source.indexOf("set session_replication_role = replica;");
  const seedEnd =
    source.indexOf("set session_replication_role = origin;", seedStart) +
    "set session_replication_role = origin;".length;
  const cleanupSource = readFileSync(
    "scripts/verify-booking-confirmation-notification-concurrency.mjs",
    "utf8",
  );
  const baseCleanup = cleanupSource
    .split("const cleanup = `")[1]
    .split("`;\n\n")[0]
    .replaceAll("${customerReceipt}", "82000000-0000-4000-8000-000000003502")
    .replaceAll("${ownerReceipt}", "82000000-0000-4000-8000-000000003501")
    .replaceAll("${request}", "60000000-0000-4000-8000-000000003501")
    .replaceAll("${operation}", "81000000-0000-4000-8000-000000003501")
    .replaceAll("${confirmation}", "80000000-0000-4000-8000-000000003501");
  const unpaidCleanup = `set session_replication_role=replica;
    delete from public.owner_request_notifications where booking_request_id='${unpaidRequest}';
    delete from public.booking_requests where id='${unpaidRequest}';
    delete from public.cottage_booking_period_commitments where id='50000000-0000-4000-8000-000000003511';
    delete from public.booking_snapshots where id='40000000-0000-4000-8000-000000003511';
    set session_replication_role=origin;`;
  const preliminaryCleanup = `${unpaidCleanup}${baseCleanup}`;
  let cleanup = preliminaryCleanup;
  try {
    harness.runSql(preliminaryCleanup);
    const admin = createClient(
      process.env.SUPABASE_URL ?? "",
      process.env.SUPABASE_SECRET_KEY ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const existing = await admin.auth.admin.listUsers({ perPage: 1000 });
    if (existing.error) throw existing.error;
    const syntheticPhones = new Set(
      [customerPhone, ownerPhone].map((phone) => phone.replace(/^\+/, "")),
    );
    for (const user of existing.data.users.filter(({ phone }) =>
      syntheticPhones.has((phone ?? "").replace(/^\+/, "")),
    )) {
      const removed = await admin.auth.admin.deleteUser(user.id);
      if (removed.error) throw removed.error;
    }
    async function createVerifiedIdentity(phone: string) {
      const context = await browser.newContext({ baseURL });
      const page = await context.newPage();
      try {
        await page.goto("/en/bookings");
        await expect(page).toHaveURL(/\/en\/access\?returnTo=%2Fen%2Fbookings/);
        await verifyPhone(page, phone);
        await expect(
          page.getByRole("heading", { name: "My bookings", exact: true }),
        ).toBeVisible();
      } finally {
        await context.close();
      }
      const users = await admin.auth.admin.listUsers({ perPage: 1000 });
      if (users.error) throw users.error;
      const identities = users.data.users.filter(
        (user) => user.phone?.replace(/^\+/, "") === phone.replace(/^\+/, ""),
      );
      expect(identities).toHaveLength(1);
      return identities[0].id;
    }
    function prepareLaterSignIn(userId: string, phone: string) {
      expect(
        harness.runSql(`update auth.users
          set confirmation_sent_at=clock_timestamp()-interval '1 hour'
          where id='${userId}' and regexp_replace(phone,'^\\+','')=regexp_replace('${phone}','^\\+','')
          returning id`),
      ).toBe(userId);
    }
    const customerId = await createVerifiedIdentity(customerPhone);
    const ownerId = await createVerifiedIdentity(ownerPhone);
    expect(
      harness.runSql(`update public.account_contexts
        set role='cottage_owner',owner_approval_state='approved'
        where user_id='${ownerId}' returning user_id`),
    ).toBe(ownerId);

    prepareLaterSignIn(ownerId, ownerPhone);
    const emptyOwnerContext = await browser.newContext({ baseURL });
    const emptyOwnerPage = await emptyOwnerContext.newPage();
    await emptyOwnerPage.goto("/en/bookings?workspace=owner");
    await verifyPhone(emptyOwnerPage, ownerPhone);
    const emptySummary = emptyOwnerPage.getByRole("region", {
      name: "Earnings summary",
    });
    await expect(emptySummary).toContainText("Expected unpaid payoutsIQD 0");
    await expect(emptySummary).toContainText("Paid payoutsIQD 0");
    await expect(
      emptyOwnerPage.getByText("No booking requests yet.", { exact: true }),
    ).toBeVisible();
    await emptyOwnerPage.reload();
    await expect(emptySummary).toContainText("Expected unpaid payoutsIQD 0");
    await emptyOwnerContext.close();

    prepareLaterSignIn(customerId, customerPhone);
    const deniedContext = await browser.newContext({ baseURL });
    const deniedPage = await deniedContext.newPage();
    await deniedPage.goto("/en/bookings?workspace=owner");
    await verifyPhone(deniedPage, customerPhone);
    await expect(deniedPage.locator("main").getByRole("alert")).toContainText(
      "This booking is not available to this account.",
    );
    await deniedContext.close();
    const dynamicSeed = source
      .slice(seedStart, seedEnd)
      .replace(
        /insert into auth\.users[\s\S]*?;\ninsert into public\.account_contexts[\s\S]*?;/,
        "",
      )
      .replaceAll(fixtureCustomerId, customerId)
      .replaceAll(fixtureOwnerId, ownerId);
    const dynamicBaseCleanup = baseCleanup
      .replaceAll(fixtureCustomerId, customerId)
      .replaceAll(fixtureOwnerId, ownerId);
    cleanup = `${unpaidCleanup}delete from auth.sessions where user_id in ('${customerId}','${ownerId}'); delete from auth.identities where user_id in ('${customerId}','${ownerId}');${dynamicBaseCleanup}`;
    harness.runSql(dynamicSeed);
    harness.runSql(`set session_replication_role=replica;
      insert into public.account_contexts(user_id,role,owner_approval_state) values('${ownerId}','cottage_owner','approved'),('${customerId}','customer',null)
      on conflict (user_id) do update set role=excluded.role,owner_approval_state=excluded.owner_approval_state;
      insert into public.booking_snapshots select '40000000-0000-4000-8000-000000003511',customer_user_id,profile_id,repeat('f',64),repeat('e',64),quote_payload,intent_payload,booking_terms_version,booking_terms_locale,booking_terms_body,booking_terms_sha256,cancellation_policy_version,acceptance_locale,acceptance_evidence,repeat('a',64),marketplace_commission_rate_basis_points,marketplace_commission_amount_fils,created_at from public.booking_snapshots where id='40000000-0000-4000-8000-000000003501';
      insert into public.cottage_booking_period_commitments select '50000000-0000-4000-8000-000000003511',customer_user_id,profile_id,schedule_revision_id,'UNPAID-HOLD-3511','pending_hold','{["2101-01-02 05:00+00","2101-01-02 09:00+00")}'::tstzmultirange,created_at from public.cottage_booking_period_commitments where id='50000000-0000-4000-8000-000000003501';
      insert into public.booking_requests(id,booking_request_reference,customer_user_id,owner_user_id,profile_id,booking_snapshot_id,booking_period_commitment_id,payment_lifecycle_id,customer_name,party_size,status,response_deadline,created_at)
      select '${unpaidRequest}','${unpaidReference}',customer_user_id,owner_user_id,profile_id,'40000000-0000-4000-8000-000000003511','50000000-0000-4000-8000-000000003511','73000000-0000-4000-8000-000000003511','Returning Customer',party_size,'pending',response_deadline+interval '1 minute',created_at+interval '1 minute' from public.booking_requests where id='60000000-0000-4000-8000-000000003501';
      insert into public.owner_request_notifications(id,booking_request_id,owner_user_id,created_at) values('90000000-0000-4000-8000-000000003511','${unpaidRequest}','${ownerId}',clock_timestamp());
      set session_replication_role=origin;`);
    const ownerRows = JSON.parse(
      harness.runSql(`begin;
        set local role authenticated;
        do $$begin perform set_config('request.jwt.claims','{"sub":"${ownerId}","role":"authenticated","aal":"aal1"}',true); end$$;
        select public.list_booking_history('cottage_owner');
        rollback;`),
    );
    expect(ownerRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          bookingRequestReference: "RC-REQ-0000000000003501",
          ownerEarnings: { status: "unavailable" },
        }),
        expect.objectContaining({
          bookingRequestReference: unpaidReference,
          ownerEarnings: { status: "not-captured" },
        }),
      ]),
    );

    prepareLaterSignIn(customerId, customerPhone);
    const returningContext = await browser.newContext({ baseURL });
    const returningPage = await returningContext.newPage();
    await returningPage.goto("/en/bookings");
    await expect(returningPage).toHaveURL(
      /\/en\/access\?returnTo=%2Fen%2Fbookings/,
    );
    await verifyPhone(returningPage, customerPhone);
    await expect(
      returningPage.locator(
        'a[href="/en/booking-requests/RC-REQ-0000000000003501"]',
      ),
    ).toBeVisible();
    expect(
      harness.runSql(
        `select count(*) from auth.users where regexp_replace(phone,'^\\+','')=regexp_replace('${customerPhone}','^\\+','')`,
      ),
    ).toBe("1");
    await returningPage.screenshot({
      path: testInfo.outputPath("returning-customer-history.png"),
      fullPage: true,
    });
    await returningContext.close();

    prepareLaterSignIn(ownerId, ownerPhone);
    const ownerContext = await browser.newContext({ baseURL });
    const ownerPage = await ownerContext.newPage();
    await ownerPage.goto("/en/bookings");
    await verifyPhone(ownerPage, ownerPhone);
    await expect(
      ownerPage.getByRole("heading", { name: "My bookings", exact: true }),
    ).toBeVisible();
    await ownerPage.goto("/en/bookings?workspace=owner");
    await expect(
      ownerPage.getByRole("region", { name: "Earnings summary" }),
    ).toContainText(
      "Earnings totals are unavailable. Check the booking records below for details.",
    );
    const unavailableLink = ownerPage.getByRole("link", {
      name: /Preserved Cottage name.*CONFIRMED-BOOKING-35/,
    });
    await expect(
      ownerPage.locator("li").filter({ has: unavailableLink }),
    ).toContainText(
      "Earnings are temporarily unavailable for this booking. No amount is shown until the record can be verified.",
    );
    const unpaidLink = ownerPage.getByRole("link", {
      name: /Preserved Cottage name.*RC-REQ-0000000000003511/,
    });
    await expect(unpaidLink).toHaveAttribute(
      "href",
      `/en/owner/booking-requests/${unpaidReference}`,
    );
    const unpaidItem = ownerPage.locator("li").filter({ has: unpaidLink });
    await expect(unpaidItem).toContainText(
      "Payment has not been collected for this request, so it has no earnings yet.",
    );
    await ownerPage.reload();
    await expect(unpaidItem).toContainText(
      "Payment has not been collected for this request, so it has no earnings yet.",
    );
    mkdirSync(".agent-evidence/visual", { recursive: true });
    await ownerPage.screenshot({
      path: ".agent-evidence/visual/real-owner-unavailable-history.png",
      fullPage: true,
    });
    await unpaidLink.click();
    const card = ownerPage.getByRole("article", { name: unpaidReference });
    await expect(card).toContainText("Returning Customer");
    await expect(card).toContainText("Pending");
    const pageText = await ownerPage.locator("body").innerText();
    expect(pageText).not.toContain("Current private address");
    expect(pageText).not.toContain(customerPhone);
    await ownerPage.screenshot({
      path: testInfo.outputPath("owner-unpaid-detail.png"),
      fullPage: true,
    });
    await ownerContext.close();
  } finally {
    harness.runSql(cleanup);
  }
});
