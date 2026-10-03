import { expect, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as OTPAuth from "otpauth";
import { SupabaseOwnerApplicationRepository } from "../src/owner-application/supabase-owner-application";

const { createLocalSupabaseConcurrencyHarness } = createRequire(
  import.meta.url,
)("../scripts/local-supabase-concurrency-harness.mjs") as {
  createLocalSupabaseConcurrencyHarness(): {
    guardDisposableLocalDatabase(): void;
    runSql(sql: string): string;
  };
};
const { accessBrowserFixture, createSubmittedReviewFixture } = createRequire(
  import.meta.url,
)("../scripts/lib/access-browser-fixtures.mjs") as {
  accessBrowserFixture(project: string): {
    project: string;
    exactAddress: string;
    reviewLegalName: string;
    reviewOwnerPhone: string;
    reviewCottageName: string;
    bookingOwnerPhone: string;
    bookingLegalName: string;
    bookingCottageName: string;
  };
  createSubmittedReviewFixture(input: {
    fixture: ReturnType<typeof accessBrowserFixture>;
    privilegedClient: SupabaseClient;
    publishableKey: string;
    url: string;
  }): Promise<void>;
};
const harness = createLocalSupabaseConcurrencyHarness();
const password = "Local-test-password-2026";
let administratorEmail: string;
let administratorId: string;
let historicId: string;
let remediationId: string;
let reviewFixture: ReturnType<typeof accessBrowserFixture>;
let reviewApplicationId: string;
let reviewDocumentId: string;
let reviewOwnerClient: SupabaseClient;
let privilegedClient: SupabaseClient;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function localUrl() {
  const url = process.env.SUPABASE_URL;
  if (
    process.env.APP_ENVIRONMENT !== "test" ||
    !url ||
    new URL(url).hostname !== "127.0.0.1" ||
    !process.env.SUPABASE_SECRET_KEY ||
    !process.env.SUPABASE_PUBLISHABLE_KEY
  )
    throw new Error(
      "Administrator browser fixtures require local test Supabase",
    );
  return url;
}

function count(sql: string) {
  const value = Number(harness.runSql(sql));
  if (!Number.isSafeInteger(value)) throw new Error("Fixture count is invalid");
  return value;
}

function westernDigits(value: string) {
  return value.replace(/[٠-٩]/g, (digit) =>
    String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)),
  );
}

test.beforeAll(async ({}, testInfo) => {
  const url = localUrl();
  harness.guardDisposableLocalDatabase();
  const source = readFileSync(
    "supabase/tests/database/administrator_records.test.sql",
    "utf8",
  );
  const startMarker = "-- BEGIN ADMINISTRATOR RECORDS FIXTURE";
  const endMarker = "-- END ADMINISTRATOR RECORDS FIXTURE";
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (
    start < 0 ||
    end <= start ||
    source.lastIndexOf(startMarker) !== start ||
    source.lastIndexOf(endMarker) !== end ||
    !source.slice(start + startMarker.length, end).trim()
  )
    throw new Error("Canonical administrator fixture markers are invalid");
  const existing = count(
    "select count(*) from public.account_contexts where user_id::text like '25000000-%';",
  );
  if (existing === 0)
    harness.runSql(
      `begin;\n${source.slice(start + startMarker.length, end).trim()}\ncommit;`,
    );
  else if (existing !== 35)
    throw new Error(`Administrator fixture namespace is partial: ${existing}`);
  expect({
    customers: count(
      "select count(*) from public.account_contexts where user_id::text like '25000000-%' and role in ('customer','cottage_owner');",
    ),
    owners: count(
      "select count(*) from public.account_contexts where user_id::text like '25000000-%' and role='cottage_owner';",
    ),
    applications: count(
      "select count(*) from public.owner_applications where id::text like '25000000-%' and status in ('submitted','under_review');",
    ),
    approvals: count(
      "select count(*) from public.cottage_profile_review_cycles where profile_id='25000000-0000-4000-8000-000000000401' and state='in_review';",
    ),
  }).toEqual({ customers: 34, owners: 8, applications: 2, approvals: 1 });
  const cycles = harness
    .runSql(
      "select id::text from public.cottage_profile_review_cycles where profile_id='25000000-0000-4000-8000-000000000401' order by cycle_number;",
    )
    .split("\n");
  if (cycles.length !== 2)
    throw new Error("Historic approval fixture is incomplete");
  [historicId, remediationId] = cycles;
  const reader = harness.runSql(`begin;
    set local role authenticated;
    set local request.jwt.claims = '{"sub":"25000000-0000-4000-8000-000000000201","role":"authenticated","aal":"aal2"}';
    select jsonb_build_object('account',(public.search_administrator_records('customers','25000000-0000-4000-8000-000000000001',null,null,null,null,null,null)->>'total')::integer,
      'historic',public.get_administrator_record('approval','${historicId}'::uuid)->>'state',
      'remediation',public.get_administrator_record('approval','${remediationId}'::uuid)->>'state');
    rollback;`);
  expect(JSON.parse(reader.split("\n").at(-1) ?? "")).toEqual({
    account: 1,
    historic: "approved",
    remediation: "in_review",
  });
  privilegedClient = createClient(url, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const project = testInfo.project.name;
  const projectIndex = ["mobile", "desktop", "worker"].indexOf(project);
  if (projectIndex < 0)
    throw new Error(`Unknown administrator records project: ${project}`);
  const projectLabel = `${project[0].toUpperCase()}${project.slice(1)}`;
  reviewFixture = {
    ...accessBrowserFixture(project),
    reviewOwnerPhone: `+964759250000${projectIndex}`,
    reviewLegalName: `${projectLabel} Administrator Records Review Fixture`,
    reviewCottageName: `${projectLabel} Administrator Records Review Cottage`,
  };
  await createSubmittedReviewFixture({
    fixture: reviewFixture,
    privilegedClient,
    publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY!,
    url,
  });
  reviewOwnerClient = createClient(url, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const reviewSignedIn = await reviewOwnerClient.auth.signInWithPassword({
    phone: reviewFixture.reviewOwnerPhone,
    password,
  });
  if (reviewSignedIn.error || !reviewSignedIn.data.user)
    throw new Error("Dedicated review owner sign-in failed", {
      cause: reviewSignedIn.error,
    });
  const reviewApplication = await new SupabaseOwnerApplicationRepository(
    reviewOwnerClient,
    privilegedClient,
  ).load();
  expect(reviewApplication).not.toBeNull();
  expect(reviewApplication?.ownerUserId).toBe(reviewSignedIn.data.user.id);
  expect(reviewApplication?.status).toBe("submitted");
  expect(reviewApplication?.legalName).toBe(reviewFixture.reviewLegalName);
  expect(reviewApplication?.applicationId).toMatch(uuidPattern);
  expect(reviewApplication?.documents.map(({ kind }) => kind).sort()).toEqual([
    "authority_to_rent",
    "identity",
    "licensing_or_exemption",
    "payout_account",
  ]);
  const identityDocument = reviewApplication?.documents.find(
    ({ kind }) => kind === "identity",
  );
  expect(identityDocument?.id).toMatch(uuidPattern);
  reviewApplicationId = reviewApplication!.applicationId;
  reviewDocumentId = identityDocument!.id;
  administratorEmail = `records-${testInfo.project.name}-${randomUUID()}@rentcottage.test`;
  const { data: created, error } = await privilegedClient.auth.admin.createUser(
    {
      email: administratorEmail,
      password,
      email_confirm: true,
    },
  );
  if (error || !created.user)
    throw new Error("Fictional administrator creation failed", {
      cause: error,
    });
  administratorId = created.user.id;
  const provision = await privilegedClient.rpc(
    "provision_platform_administrator",
    {
      target_user_id: administratorId,
    },
  );
  if (provision.error)
    throw new Error("Fictional administrator provisioning failed", {
      cause: provision.error,
    });
});

test("an administrator discovers accounts and approval records with authoritative counts and restricted documents in every locale", async ({
  page,
}) => {
  const fixture = reviewFixture;
  const applications = count(
    "select count(*) from public.owner_applications where status in ('submitted','under_review');",
  );
  const approvals = count(
    "select count(*) from public.cottage_profile_review_cycles where state='in_review';",
  );
  const navigated: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigated.push(frame.url());
  });
  await page.goto("/en/administrator/access");
  await page.getByLabel("Email").fill(administratorEmail);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Continue" }).click();
  const secret = await page.getByTestId("mfa-secret").textContent();
  if (!secret) throw new Error("Fictional authenticator enrollment failed");
  await page.getByLabel("Authenticator app code").fill(
    new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(secret),
    }).generate(),
  );
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByText(/Administrator access is ready/)).toBeVisible();
  await page.getByRole("link", { name: "Records" }).click();
  await expect(
    page.getByRole("heading", { name: "Marketplace records" }),
  ).toBeVisible();

  for (const [locale, title, applicationLabel, approvalLabel] of [
    [
      "en",
      "Marketplace records",
      "Pending Owner Applications",
      "Pending content approvals",
    ],
    ["ar", "سجلات السوق", "طلبات المالك المعلقة", "موافقات المحتوى المعلقة"],
    [
      "ckb",
      "تۆمارەکانی بازاڕ",
      "داواکارییە چاوەڕوانەکانی خاوەن",
      "پەسەندکردنی چاوەڕوانی ناوەڕۆک",
    ],
  ] as const) {
    await page.goto(`/${locale}/administrator/records`);
    await expect(page.locator("html")).toHaveAttribute(
      "dir",
      locale === "en" ? "ltr" : "rtl",
    );
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    const applicationButton = page.getByRole("button", {
      name: new RegExp(`^${applicationLabel}:`),
    });
    const approvalButton = page.getByRole("button", {
      name: new RegExp(`^${approvalLabel}:`),
    });
    await expect(applicationButton).toBeVisible();
    await expect(approvalButton).toBeVisible();
    expect(
      westernDigits((await applicationButton.textContent()) ?? "").trim(),
    ).toBe(`${applicationLabel}: ${applications}`);
    expect(
      westernDigits((await approvalButton.textContent()) ?? "").trim(),
    ).toBe(`${approvalLabel}: ${approvals}`);
    await page
      .getByRole("button", { name: new RegExp(`^${approvalLabel}`) })
      .click();
    await expect(
      page.getByRole("link", { name: "Fictional Historic Snapshot" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
  }

  await page.goto("/en/administrator/records");
  await page.getByLabel("Record type").selectOption("customers");
  await page.getByLabel("From date (Baghdad)").fill("2026-09-01");
  await page.getByLabel("Through date (Baghdad)").fill("2026-09-01");
  await page.getByRole("button", { name: "Search records" }).click();
  await expect(page.getByText("Matching records: 26")).toBeVisible();
  await expect(page.locator("ol li")).toHaveCount(25);
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.locator("ol li")).toHaveCount(1);
  await page.getByLabel("From date (Baghdad)").fill("2026-09-03");
  await page.getByLabel("Search", { exact: true }).press("Enter");
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Check the search, dates, and filters",
  );
  await expect(page.getByText("Matching records: 26")).toHaveCount(0);
  await expect(page.getByLabel("From date (Baghdad)")).toHaveAttribute(
    "aria-describedby",
    "administrator-records-filter-error",
  );
  await page.getByLabel("Record type").selectOption("owners");
  await page.getByLabel("Search", { exact: true }).fill("+9647510000101");
  await page.getByLabel("From date (Baghdad)").fill("");
  await page.getByLabel("Through date (Baghdad)").fill("");
  await page.getByLabel("Search", { exact: true }).press("Enter");
  await expect(page.getByText("Matching records: 1")).toBeVisible();
  await page.getByRole("link", { name: "Fictional Historical Owner" }).click();
  await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
  await expect(page.locator("main")).not.toContainText(
    /PRIVATE ADDRESS|PRIVATE DIRECTIONS|\+9647510000101|@/,
  );
  await expect(
    page.getByRole("link", { name: "Open Owner Application and documents" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Find this owner's cottages" }).click();
  await expect(page.getByText("Matching records: 2")).toBeVisible();
  expect(page.url()).toContain("scope=cottages&ownerId=");

  await page.goto("/en/administrator/records");
  await page.getByRole("button", { name: /Pending content approvals/ }).click();
  await page.locator(`a[href$="/${remediationId}"]`).click();
  await expect(
    page.getByRole("heading", { name: "Content approval" }),
  ).toBeVisible();
  await expect(page.getByText("In review")).toBeVisible();
  await page.goto("/en/administrator/records");
  await page.getByLabel("Record type").selectOption("approvals");
  await page.getByLabel("Status").selectOption("approved");
  await page.getByRole("button", { name: "Search records" }).click();
  await page.locator(`a[href$="/${historicId}"]`).click();
  await expect(page.getByText("Fictional publication approval")).toBeVisible();
  await expect(page.getByText("Fictional English approval")).toBeVisible();
  await expect(page.getByText("Fictional Arabic approval")).toBeVisible();
  await expect(page.getByText("Fictional Sorani approval")).toBeVisible();

  harness.guardDisposableLocalDatabase();
  try {
    harness.runSql(
      "update public.owner_applications set legal_name='Fictional <img src=x onerror=alert(1)>' where id='25000000-0000-4000-8000-000000000303';",
    );
    await page.goto("/en/administrator/records");
    await page.getByLabel("Search", { exact: true }).fill("<img src=x");
    await page.getByRole("button", { name: "Search records" }).click();
    await expect(
      page.getByRole("link", {
        name: "Fictional <img src=x onerror=alert(1)>",
      }),
    ).toBeVisible();
    await expect(page.locator('main img[src="x"]')).toHaveCount(0);
  } finally {
    harness.runSql(
      "update public.owner_applications set legal_name='Fictional Queue Owner' where id='25000000-0000-4000-8000-000000000303';",
    );
  }

  await page.goto("/en/administrator/records");
  await page
    .getByLabel("Search", { exact: true })
    .fill(fixture.reviewLegalName);
  await page.getByRole("button", { name: "Search records" }).click();
  await page.getByRole("link", { name: fixture.reviewLegalName }).click();
  await expect(page).toHaveURL(new RegExp(reviewApplicationId));
  const documentRow = page
    .getByRole("listitem")
    .filter({ hasText: "Identity evidence" });
  await expect(
    documentRow.getByRole("link", { name: "Open secure document" }),
  ).toHaveCount(0);
  const readyApplication = await new SupabaseOwnerApplicationRepository(
    reviewOwnerClient,
    privilegedClient,
  ).load();
  expect(readyApplication?.applicationId).toBe(reviewApplicationId);
  expect(readyApplication?.status).toBe("submitted");
  expect(
    readyApplication?.documents.find(({ kind }) => kind === "identity")?.id,
  ).toBe(reviewDocumentId);
  const accessedAfter = new Date(Date.now() - 5_000).toISOString();
  await documentRow.getByRole("button", { name: "Create secure link" }).focus();
  await page.keyboard.press("Enter");
  const link = documentRow.getByRole("link", { name: "Open secure document" });
  await expect(link).toBeVisible();
  const href = await link.getAttribute("href");
  if (!href)
    throw new Error("Secure document link missing after explicit action");
  expect(href).not.toContain(fixture.reviewLegalName);
  expect(href).not.toContain(fixture.reviewOwnerPhone);
  const response = await page.request.get(href);
  expect(response.status()).toBe(200);
  expect((await response.body()).subarray(0, 4).toString()).toBe("%PDF");
  const audit = await privilegedClient
    .from("owner_verification_document_audit")
    .select("document_id,actor_subject_id,action,object_path")
    .eq("document_id", reviewDocumentId)
    .eq("actor_subject_id", administratorId)
    .eq("action", "access_granted")
    .gte("occurred_at", accessedAfter)
    .order("occurred_at", { ascending: false })
    .limit(1)
    .single();
  if (audit.error) throw audit.error;
  expect(audit.data.document_id).toBe(reviewDocumentId);
  expect(audit.data.actor_subject_id).toBe(administratorId);
  expect(decodeURIComponent(new URL(href).pathname)).toContain(
    audit.data.object_path,
  );

  await page.goto("/en/administrator/records");
  await page
    .getByLabel("Search", { exact: true })
    .fill("no fictional match 250");
  await page.getByRole("button", { name: "Search records" }).click();
  await expect(page.getByText("No records match these filters.")).toBeVisible();
  await expect(page.getByText("Matching records: 0")).toBeVisible();
  const definition = harness.runSql(
    "select pg_get_functiondef('public.search_administrator_records(text,text,text,date,date,uuid,timestamp with time zone,uuid)'::regprocedure);",
  );
  harness.guardDisposableLocalDatabase();
  try {
    harness.runSql(
      "create or replace function public.search_administrator_records(target_kind text,target_query text,target_status text,target_from date,target_through date,target_owner_id uuid,after_at timestamptz,after_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$ begin raise exception 'Local records read fixture unavailable'; end; $$;",
    );
    await page.getByRole("button", { name: "Search records" }).click();
    await expect(page.locator("main").getByRole("alert")).toContainText(
      "Records are temporarily unavailable",
    );
    await expect(page.getByText("Matching records: 0")).toHaveCount(0);
  } finally {
    harness.runSql(definition);
  }
  await page
    .getByLabel("Search", { exact: true })
    .fill("Fictional Queue Owner");
  await page.getByRole("button", { name: "Search records" }).click();
  await expect(
    page.getByRole("link", { name: "Fictional Queue Owner" }),
  ).toBeVisible();
  const downgrade = await page.context().newPage();
  await downgrade.goto("/en/administrator/access");
  await downgrade.getByLabel("Email").fill(administratorEmail);
  await downgrade.getByLabel("Password").fill(password);
  await downgrade.getByRole("button", { name: "Continue" }).click();
  await expect(downgrade.getByLabel("Authenticator app code")).toBeVisible();
  await downgrade.close();
  await page.getByRole("button", { name: "Search records" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Administrator access with authenticator verification is required.",
  );
  await expect(
    page.getByRole("link", { name: "Fictional Queue Owner" }),
  ).toHaveCount(0);
  const browserHistoryState = await page.evaluate(() =>
    JSON.stringify(history.state),
  );
  for (const surface of [...navigated, page.url(), browserHistoryState])
    for (const value of [
      fixture.reviewLegalName,
      fixture.reviewOwnerPhone,
      "+9647510000101",
      "Fictional Queue Owner",
    ])
      expect(surface).not.toContain(value);
});

test("marketplace users and AAL1 administrators cannot discover administrator records", async ({
  page,
}, testInfo) => {
  const fixture = accessBrowserFixture(testInfo.project.name);
  await page.goto("/en/owner/access");
  await page.getByLabel("Iraqi phone number").fill(fixture.reviewOwnerPhone);
  await page.getByRole("button", { name: "Send verification code" }).click();
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Verify" }).click();
  await page.goto("/en/administrator/records");
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Administrator access with authenticator verification is required.",
  );
  const customer = createClient(
    localUrl(),
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const signedIn = await customer.auth.signInWithPassword({
    phone: fixture.reviewOwnerPhone,
    password,
  });
  if (signedIn.error) throw signedIn.error;
  const denied = await customer.rpc("search_administrator_records", {
    target_kind: "customers",
    target_query: "",
    target_status: null,
    target_from: null,
    target_through: null,
    target_owner_id: null,
    after_at: null,
    after_id: null,
  });
  expect(denied.error?.code).toBe("42501");
  await page.goto("/en/administrator/access");
  await page.getByLabel("Email").fill(administratorEmail);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.goto("/en/administrator/records");
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Administrator access with authenticator verification is required.",
  );
  const aal1 = createClient(localUrl(), process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const adminSignedIn = await aal1.auth.signInWithPassword({
    email: administratorEmail,
    password,
  });
  if (adminSignedIn.error) throw adminSignedIn.error;
  const aal1Denied = await aal1.rpc("get_administrator_record", {
    target_kind: "account",
    target_id: "25000000-0000-4000-8000-000000000001",
  });
  expect(aal1Denied.error?.code).toBe("42501");
});
