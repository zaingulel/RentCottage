import { writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as OTPAuth from "otpauth";
import { administratorRecordsMessages } from "../src/i18n/administrator-records-messages";
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
  harness.runSql(
    `insert into public.account_names (user_id, first_name) values ('${administratorId}', 'Sara') on conflict (user_id) do update set first_name = excluded.first_name;`,
  );
});

test("an administrator discovers accounts and approval records with authoritative counts and restricted documents in every locale", async ({
  page,
}, testInfo) => {
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
    const recordSearchControl = page.getByRole("button", {
      name: administratorRecordsMessages[locale].search,
      exact: true,
    });
    await recordSearchControl.focus();
    await expect(recordSearchControl).toBeFocused();
    const recordSearchSource = await recordSearchControl.elementHandle();
    if (!recordSearchSource) throw new Error("Focus source is missing");
    await recordSearchControl.press("Enter");
    await expect(recordSearchControl).toBeEnabled();
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
    await expect(recordSearchControl).toBeFocused();
    expect(
      await recordSearchSource.evaluate(
        (source) => document.activeElement === source,
      ),
    ).toBe(true);
    await recordSearchSource.dispose();
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
  await expect(
    documentRow.getByRole("button", { name: "Create secure link" }),
  ).toBeFocused();
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

  for (const locale of ["en", "ar", "ckb"] as const) {
    const copy = administratorRecordsMessages[locale];
    await page.goto(`/${locale}/administrator/records`);
    await expect(page.getByRole("heading", { name: copy.title })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Fictional Queue Owner" }),
    ).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const query = page.getByLabel(copy.query, { exact: true });
    const controls = [
      page.getByRole("combobox", { name: copy.kind, exact: true }),
      query,
      page.getByRole("combobox", { name: copy.status, exact: true }),
      page.getByLabel(copy.from, { exact: true }),
      page.getByLabel(copy.through, { exact: true }),
    ];
    const searchButton = page.getByRole("button", {
      name: copy.search,
      exact: true,
    });
    if (testInfo.project.name === "desktop") {
      await expect.soft
        .poll(async () => {
          const fields = await Promise.all(
            controls.map((control) => control.locator("..").boundingBox()),
          );
          const actions = await searchButton.locator("..").boundingBox();
          const [kind, search, status, from, through] = fields;
          if (!kind || !search || !status || !from || !through || !actions)
            return null;
          return {
            firstRow:
              Math.abs(kind.y - search.y) < 1 &&
              Math.abs(kind.y - status.y) < 1,
            dateRow:
              Math.abs(from.y - through.y) < 1 &&
              actions.y >= from.y &&
              actions.y + actions.height <= from.y + from.height + 1,
            columns:
              Math.abs(kind.x - from.x) < 1 &&
              Math.abs(search.x - through.x) < 1 &&
              Math.abs(status.x - actions.x) < 1 &&
              Math.abs(kind.width - search.width) < 1 &&
              Math.abs(search.width - status.width) < 1,
            secondRow:
              from.y >=
              Math.max(
                ...fields.slice(0, 3).map((field) => field!.y + field!.height),
              ),
          };
        }, `${locale} records use three columns and a shared date/action row`)
        .toEqual({
          firstRow: true,
          dateRow: true,
          columns: true,
          secondRow: true,
        });
    }
    if (testInfo.project.name === "mobile") {
      await expect.soft
        .poll(async () => {
          const boxes = await Promise.all(
            [...controls, searchButton].map((control, index) =>
              control.locator(index === 1 ? "../.." : "..").boundingBox(),
            ),
          );
          const form = await controls[0]
            .locator("../..")
            .evaluate((element) => {
              const bounds = element.getBoundingClientRect();
              const style = getComputedStyle(element);
              const left =
                bounds.left +
                parseFloat(style.borderLeftWidth) +
                parseFloat(style.paddingLeft);
              const right =
                bounds.right -
                parseFloat(style.borderRightWidth) -
                parseFloat(style.paddingRight);
              return {
                left,
                right,
                viewport: window.innerWidth,
              };
            });
          return boxes.every((box, index) => {
            const previous = boxes[index - 1];
            return (
              box !== null &&
              box.width > 0 &&
              box.height > 0 &&
              box.x >= 0 &&
              box.x + box.width <= form.viewport &&
              Math.abs(box.x - form.left) <= 1 &&
              Math.abs(box.x + box.width - form.right) <= 1 &&
              (index === 0 ||
                (previous !== null && box.y >= previous.y + previous.height))
            );
          });
        }, `${locale} records filters fill one phone column in document order`)
        .toBe(true);
    }
    await expect.soft(query).toHaveAccessibleDescription(copy.applicationHint);
    await expect.soft
      .poll(async () => {
        const hint = page.getByText(copy.applicationHint, { exact: true });
        if (!(await hint.isVisible())) return false;
        const field = await query.boundingBox();
        return hint.evaluate((element, fieldBottom) => {
          const bounds = element.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(element);
          return (
            bounds.top >= fieldBottom &&
            [...range.getClientRects()].every(
              (line) =>
                line.left >= Math.max(0, bounds.left) &&
                line.right <= Math.min(window.innerWidth, bounds.right) + 1 &&
                line.top >= bounds.top &&
                line.bottom <= bounds.bottom + 1,
            )
          );
        }, field!.y + field!.height);
      }, `${locale} complete query guidance is visible below its field`)
      .toBe(true);
  }

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

test("suspension controls preserve independent capabilities and immutable history through reactivation", async ({
  page,
}, testInfo) => {
  const url = localUrl();
  const fixture = accessBrowserFixture(testInfo.project.name);
  const owner = createClient(url, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signedIn = await owner.auth.signInWithPassword({
    phone: fixture.bookingOwnerPhone,
    password,
  });
  expect(signedIn.error).toBeNull();
  const ownerId = signedIn.data.user!.id;
  const profile = await owner
    .from("owner_application_cottage_profiles")
    .select(
      "id,application_id,current_publication_id,current_shift_schedule_id",
    )
    .eq("name", fixture.bookingCottageName)
    .single();
  expect(profile.error).toBeNull();
  expect(profile.data!.current_publication_id).toMatch(uuidPattern);
  expect(profile.data!.current_shift_schedule_id).toMatch(uuidPattern);
  const email = `suspension-records-${testInfo.project.name}-${randomUUID()}@rentcottage.test`;
  const administrator = await privilegedClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  expect(administrator.error).toBeNull();
  const actorId = administrator.data.user!.id;
  const provisioned = await privilegedClient.rpc(
    "provision_platform_administrator",
    {
      target_user_id: actorId,
    },
  );
  expect(provisioned.error).toBeNull();
  harness.runSql(
    `insert into public.account_names (user_id, first_name) values ('${actorId}', 'Sara') on conflict (user_id) do update set first_name = excluded.first_name;`,
  );
  await page.goto("/en/administrator/access");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Continue" }).click();
  const secret = await page.getByTestId("mfa-secret").textContent();
  if (!secret)
    throw new Error("Suspension administrator enrollment is unavailable");
  await page.getByLabel("Authenticator app code").fill(
    new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(secret),
    }).generate(),
  );
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page.getByText(/Administrator access is ready/)).toBeVisible();
  const readHistory = () =>
    JSON.parse(
      harness.runSql(`select coalesce(jsonb_agg(to_jsonb(actions) order by created_at,id),'[]')
    from private.marketplace_suspension_actions actions where actor_user_id='${actorId}';`),
    ) as Array<{
      id: string;
      target_kind: string;
      account_user_id: string | null;
      profile_id: string | null;
      actor_user_id: string;
      action: string;
      reason: string;
      from_state: string;
      to_state: string;
      expected_revision: number;
      resulting_revision: number;
      created_at: string;
    }>;
  expect(readHistory()).toEqual([]);
  const capability = async () => {
    const result = await owner.rpc("owner_can_start_new_business", {
      target_owner_user_id: ownerId,
    });
    expect(result.error).toBeNull();
    return result.data;
  };
  expect(await capability()).toBe(true);
  await page.goto(`/en/administrator/records/account/${ownerId}`);
  const customer = page.getByRole("region", {
    name: "Customer activity",
    exact: true,
  });
  const ownerPanel = page.getByRole("region", {
    name: "Owner activity",
    exact: true,
  });
  await expect(customer.locator(".status-badge")).toHaveText("Active");
  await expect(ownerPanel.locator(".status-badge")).toHaveText("Approved");
  await customer
    .getByRole("button", { name: "Suspend new activity", exact: true })
    .click();
  await expect(customer.getByLabel("Reason", { exact: true })).toHaveJSProperty(
    "required",
    true,
  );
  expect(readHistory()).toEqual([]);
  const act = async (
    panel: ReturnType<Page["getByRole"]>,
    action: "suspend" | "reactivate",
    reason: string,
    state: string,
  ) => {
    await panel.getByLabel("Reason", { exact: true }).fill(reason);
    await panel
      .getByRole("button", {
        name:
          action === "suspend"
            ? "Suspend new activity"
            : "Reactivate eligible activity",
        exact: true,
      })
      .click();
    await expect(panel.getByRole("status")).toContainText("Command completed.");
    await expect(panel.locator(".status-badge")).toHaveText(state);
    const history = readHistory();
    const recorded = history.at(-1)!;
    expect(recorded).toMatchObject({
      actor_user_id: actorId,
      action,
      reason,
      to_state: state.toLowerCase(),
    });
    expect(recorded.id).toMatch(uuidPattern);
    expect(recorded.resulting_revision).toBe(recorded.expected_revision + 1);
    const audit = panel
      .getByRole("listitem")
      .filter({ hasText: reason })
      .filter({
        has: page.getByText(actorId, { exact: true }),
      });
    await expect(audit).toHaveCount(1);
    await expect(audit.getByText(actorId, { exact: true })).toBeVisible();
    expect(
      Date.parse((await audit.locator("time").getAttribute("datetime"))!),
    ).toBe(Date.parse(recorded.created_at));
    await panel
      .getByRole("button", {
        name: "Refresh restriction and release progress",
        exact: true,
      })
      .click();
    await expect(panel.getByRole("status")).toContainText(
      "progress refreshed.",
    );
    expect(readHistory()).toEqual(history);
    return recorded;
  };
  const suspendedCustomer = await act(
    customer,
    "suspend",
    "Fictional customer capability safety restriction",
    "Suspended",
  );
  expect(suspendedCustomer).toMatchObject({
    target_kind: "customer",
    account_user_id: ownerId,
    from_state: "active",
  });
  expect(await capability()).toBe(true);
  await expect(ownerPanel.locator(".status-badge")).toHaveText("Approved");
  const observeAccessibility = async (
    panel: ReturnType<Page["getByRole"]>,
    reasonLabel: string,
    includeCssZoom = false,
  ) => {
    const savedViewport = page.viewportSize();
    expect(savedViewport).not.toBeNull();
    const savedZoom = await page.locator("html").evaluate((element) => ({
      value: element.style.getPropertyValue("zoom"),
      priority: element.style.getPropertyPriority("zoom"),
    }));
    const readFocus = (element: HTMLElement) => {
      const style = getComputedStyle(element);
      return {
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        outlineColor: style.outlineColor,
        outlineOffset: style.outlineOffset,
        boxShadow: style.boxShadow,
        borderColor: style.borderColor,
      };
    };
    try {
      const reason = panel.getByRole("textbox", {
        name: reasonLabel,
        exact: true,
      });
      const submit = panel.locator("form").getByRole("button");
      await expect(submit).toHaveCount(1);
      await expect(submit).toBeEnabled();
      await reason.focus();
      await expect(reason).toBeFocused();
      const reasonFocus = await reason.evaluate(readFocus);
      await reason.press("Tab");
      await expect(submit).toBeFocused();
      const submitFocus = await submit.evaluate(readFocus);
      for (const focus of [reasonFocus, submitFocus]) {
        expect(
          (focus.outlineStyle !== "none" &&
            Number.parseFloat(focus.outlineWidth) > 0 &&
            !["transparent", "rgba(0, 0, 0, 0)"].includes(
              focus.outlineColor,
            )) ||
            focus.boxShadow !== "none",
        ).toBe(true);
      }
      const rendered = await panel.evaluate((region) => {
        const visible = (element: Element) => {
          const style = getComputedStyle(element);
          const box = element.getBoundingClientRect();
          return (
            style.display !== "none" &&
            style.visibility === "visible" &&
            box.width > 0 &&
            box.height > 0
          );
        };
        const styles = Array.from(
          region.querySelectorAll(
            "h2,h3,p,label,dt,dd,time,.status-badge,button,a,textarea",
          ),
        )
          .filter(visible)
          .map((element) => {
            const style = getComputedStyle(element);
            const backgrounds = [];
            for (
              let ancestor: Element | null = element;
              ancestor;
              ancestor = ancestor.parentElement
            ) {
              const ancestorStyle = getComputedStyle(ancestor);
              backgrounds.push({
                tag: ancestor.tagName,
                backgroundColor: ancestorStyle.backgroundColor,
                backgroundImage: ancestorStyle.backgroundImage,
                opacity: ancestorStyle.opacity,
              });
            }
            return {
              tag: element.tagName,
              text: element.textContent?.trim(),
              color: style.color,
              fontFamily: style.fontFamily,
              fontSize: style.fontSize,
              lineHeight: style.lineHeight,
              fontWeight: style.fontWeight,
              borderColor: style.borderColor,
              borderWidth: style.borderWidth,
              backgrounds,
              rect: element.getBoundingClientRect().toJSON(),
            };
          });
        const targets = Array.from(region.querySelectorAll("button,a[href]"))
          .filter(
            (element) =>
              visible(element) &&
              !element.matches(":disabled") &&
              element.getAttribute("aria-disabled") !== "true",
          )
          .map((element) => ({
            tag: element.tagName,
            text: element.textContent?.trim(),
            ariaLabel: element.getAttribute("aria-label"),
            rect: element.getBoundingClientRect().toJSON(),
          }));
        return {
          lang: document.documentElement.lang,
          dir: document.documentElement.dir,
          viewport: { width: innerWidth, height: innerHeight },
          region: region.getBoundingClientRect().toJSON(),
          styles,
          targets,
        };
      });
      expect(rendered.targets.length).toBeGreaterThan(0);
      for (const target of rendered.targets) {
        expect(target.rect.width, target.text).toBeGreaterThanOrEqual(24);
        expect(target.rect.height, target.text).toBeGreaterThanOrEqual(24);
      }
      await page.setViewportSize({ width: 320, height: savedViewport!.height });
      const narrow = await panel.evaluate((region) => ({
        viewportWidth: innerWidth,
        documentWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        region: region.getBoundingClientRect().toJSON(),
      }));
      expect(narrow.scrollWidth).toBeLessThanOrEqual(narrow.documentWidth + 1);
      expect(narrow.region.left).toBeGreaterThanOrEqual(-1);
      expect(narrow.region.right).toBeLessThanOrEqual(narrow.viewportWidth + 1);
      await page.setViewportSize(savedViewport!);
      let cssZoom;
      if (includeCssZoom) {
        await page
          .locator("html")
          .evaluate((element) => element.style.setProperty("zoom", "2"));
        cssZoom = await panel.evaluate((region) => ({
          method: "CSS documentElement.style.zoom; not native browser zoom",
          computedZoom: getComputedStyle(document.documentElement).zoom,
          viewportWidth: innerWidth,
          documentWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          region: region.getBoundingClientRect().toJSON(),
        }));
        expect(Number.parseFloat(cssZoom.computedZoom)).toBe(2);
      }
      return {
        minimumTargetCssPixels: 24,
        keyboard: {
          order: ["labelled reason textarea", "enabled form submit"],
          reasonFocus,
          submitFocus,
        },
        rendered,
        narrow,
        cssZoom,
        savedViewport,
        savedZoom,
      };
    } finally {
      await page.locator("html").evaluate((element, saved) => {
        if (saved.value)
          element.style.setProperty("zoom", saved.value, saved.priority);
        else element.style.removeProperty("zoom");
      }, savedZoom);
      await page.setViewportSize(savedViewport!);
      expect(page.viewportSize()).toEqual(savedViewport);
      expect(
        await page.locator("html").evaluate((element) => ({
          value: element.style.getPropertyValue("zoom"),
          priority: element.style.getPropertyPriority("zoom"),
        })),
      ).toEqual(savedZoom);
    }
  };
  if (testInfo.project.name === "worker") {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(customer.locator(".status-badge")).toHaveText("Suspended");
    await expect(ownerPanel.locator(".status-badge")).toHaveText("Approved");
    const customerAudit = customer
      .getByRole("listitem")
      .filter({
        has: page.getByText(suspendedCustomer.reason, { exact: true }),
      })
      .filter({ has: page.getByText(actorId, { exact: true }) });
    await expect(customerAudit).toHaveCount(1);
    await expect(
      customerAudit.getByText(suspendedCustomer.reason, { exact: true }),
    ).toBeVisible();
    await expect(
      customerAudit.getByText(actorId, { exact: true }),
    ).toBeVisible();
    const accessibility = await observeAccessibility(customer, "Reason", true);
    const capture = testInfo.outputPath("administrator-en-desktop.png");
    await page.screenshot({ path: capture, fullPage: true });
    await testInfo.attach("administrator-en-desktop", {
      path: capture,
      contentType: "image/png",
    });
    const administratorEnDesktopStatePath = testInfo.outputPath(
      "administrator-en-desktop-state.json",
    );
    await writeFile(
      administratorEnDesktopStatePath,
      JSON.stringify({
        viewport: page.viewportSize(),
        lang: await page.locator("html").getAttribute("lang"),
        dir: await page.locator("html").getAttribute("dir"),
        action: suspendedCustomer,
        accessibility,
      }),
    );
    await testInfo.attach("administrator-en-desktop-state", {
      path: administratorEnDesktopStatePath,
      contentType: "application/json",
    });
  }
  await act(
    customer,
    "reactivate",
    "Fictional customer capability restored",
    "Active",
  );
  const suspendedOwner = await act(
    ownerPanel,
    "suspend",
    "Fictional owner capability safety restriction",
    "Suspended",
  );
  expect(suspendedOwner).toMatchObject({
    target_kind: "owner",
    account_user_id: ownerId,
    from_state: "approved",
  });
  expect(await capability()).toBe(false);
  await expect(customer.locator(".status-badge")).toHaveText("Active");
  const context = await owner
    .from("account_contexts")
    .select("role,customer_suspended,owner_approval_state")
    .eq("user_id", ownerId)
    .single();
  expect(context.error).toBeNull();
  expect(context.data).toEqual({
    role: "cottage_owner",
    customer_suspended: false,
    owner_approval_state: "suspended",
  });
  await act(
    ownerPanel,
    "reactivate",
    "Fictional eligible owner activity restored",
    "Approved",
  );
  expect(await capability()).toBe(true);
  await page.goto(`/en/administrator/cottages/${profile.data!.id}`);
  const cottage = page.getByRole("region", {
    name: "Cottage activity",
    exact: true,
  });
  await expect(cottage.locator(".status-badge")).toHaveText("Published");
  const suspendedCottage = await act(
    cottage,
    "suspend",
    "Fictional cottage business safety restriction",
    "Suspended",
  );
  expect(suspendedCottage).toMatchObject({
    target_kind: "cottage",
    profile_id: profile.data!.id,
    from_state: "published",
  });
  await act(
    cottage,
    "reactivate",
    "Fictional eligible cottage listing restored",
    "Published",
  );
  const restored = JSON.parse(
    harness.runSql(`select jsonb_build_object('profileId',profiles.id,'publicationId',profiles.current_publication_id,'scheduleId',profiles.current_shift_schedule_id,'state',listings.state,'discoverable',public.is_cottage_publicly_discoverable(profiles.id))
    from public.owner_application_cottage_profiles profiles join public.cottage_marketplace_listings listings on listings.profile_id=profiles.id where profiles.id='${profile.data!.id}';`),
  );
  expect(restored).toEqual({
    profileId: profile.data!.id,
    publicationId: profile.data!.current_publication_id,
    scheduleId: profile.data!.current_shift_schedule_id,
    state: "published",
    discoverable: true,
  });
  const retained = readHistory();
  expect(retained).toHaveLength(6);
  await page.reload();
  await expect(cottage.locator(".status-badge")).toHaveText("Published");
  expect(readHistory()).toEqual(retained);
  let canonicalRetention: unknown;
  let canonicalFailed = false;
  let canonicalFailure: unknown;
  let canonicalRestorationError: string | null = null;
  if (testInfo.project.name === "worker") {
    const canonicalId = "25000000-0000-4000-8000-000000000401";
    const canonicalFacts = () => {
      const rows = JSON.parse(
        harness.runSql(`select jsonb_agg(jsonb_build_object(
        'profileId',profiles.id,'state',listings.state,'restricted',profiles.business_suspended,
        'revision',profiles.suspension_revision,'previousListingState',profiles.listing_state_before_suspension,
        'owner',(select to_jsonb(contexts) from public.account_contexts contexts where contexts.user_id=profiles.owner_user_id),
        'application',(select to_jsonb(applications) from public.owner_applications applications where applications.id=profiles.application_id),
        'publication',(select to_jsonb(snapshots) from public.cottage_publication_snapshots snapshots where snapshots.id=profiles.current_publication_id),
        'schedule',(select to_jsonb(schedules) from public.cottage_shift_schedule_revisions schedules where schedules.id=profiles.current_shift_schedule_id),
        'sources',(select jsonb_agg(to_jsonb(sources) order by sources.revision) from public.cottage_profile_source_revisions sources where sources.profile_id=profiles.id),
        'actions',(select coalesce(jsonb_agg(to_jsonb(actions) order by actions.resulting_revision desc),'[]') from private.marketplace_suspension_actions actions where actions.target_kind='cottage' and actions.profile_id=profiles.id),
        'publicationId',profiles.current_publication_id,'scheduleId',profiles.current_shift_schedule_id,
        'publicationMatches',exists(select 1 from public.cottage_publication_snapshots snapshots where snapshots.id=profiles.current_publication_id and snapshots.profile_id=profiles.id),
        'scheduleMatches',exists(select 1 from public.cottage_shift_schedule_revisions schedules where schedules.id=profiles.current_shift_schedule_id and schedules.profile_id=profiles.id),
        'content',to_jsonb(profiles)-array['business_suspended','suspension_revision','listing_state_before_suspension','updated_at'],
        'pending',(select count(*) from public.booking_requests requests where requests.profile_id=profiles.id and requests.status='pending')
      )) from public.owner_application_cottage_profiles profiles join public.cottage_marketplace_listings listings on listings.profile_id=profiles.id where profiles.id='${canonicalId}';`),
      );
      expect(rows).toHaveLength(1);
      return rows[0];
    };
    const restoreCanonicalListing = (
      facts: ReturnType<typeof canonicalFacts>,
      latestActionId: string,
    ) => {
      const content = JSON.stringify(facts.content).replaceAll("'", "''");
      const owner = JSON.stringify(facts.owner).replaceAll("'", "''");
      const application = JSON.stringify(facts.application).replaceAll(
        "'",
        "''",
      );
      harness.runSql(`begin;
        do $fixture$
        declare profile public.owner_application_cottage_profiles;
          listing public.cottage_marketplace_listings; changed integer;
        begin
          select * into profile from public.owner_application_cottage_profiles profiles where profiles.id='${canonicalId}' for update;
          select * into listing from public.cottage_marketplace_listings listings where listings.profile_id='${canonicalId}' for update;
          if profile.id is null or listing.profile_id is null or profile.business_suspended
            or profile.suspension_revision<>${facts.revision} or profile.listing_state_before_suspension is distinct from 'published'::public.cottage_marketplace_state
            or listing.state<>'paused' or (to_jsonb(profile)-array['business_suspended','suspension_revision','listing_state_before_suspension','updated_at']) is distinct from '${content}'::jsonb
            or (select to_jsonb(contexts) from public.account_contexts contexts where contexts.user_id=profile.owner_user_id) is distinct from '${owner}'::jsonb
            or (select to_jsonb(applications) from public.owner_applications applications where applications.id=profile.application_id) is distinct from '${application}'::jsonb
            or (select actions.id from private.marketplace_suspension_actions actions where actions.target_kind='cottage' and actions.profile_id=profile.id order by actions.resulting_revision desc limit 1) is distinct from '${latestActionId}'::uuid
            or exists(select 1 from public.booking_requests requests where requests.profile_id=profile.id and requests.status='pending') then
            raise exception 'Canonical listing restoration refused: ownership or baseline changed';
          end if;
          update public.cottage_marketplace_listings set state='published' where profile_id=profile.id and state='paused';
          get diagnostics changed=row_count;
          if changed<>1 then raise exception 'Canonical listing restoration must update exactly one row'; end if;
        end $fixture$;
        commit;`);
    };
    let baseline = canonicalFacts();
    expect(baseline).toMatchObject({
      profileId: canonicalId,
      restricted: false,
      publicationMatches: true,
      scheduleMatches: true,
      pending: 0,
      owner: {
        user_id: "25000000-0000-4000-8000-000000000101",
        role: "cottage_owner",
        owner_approval_state: "approved",
      },
      application: {
        id: "25000000-0000-4000-8000-000000000305",
        owner_user_id: "25000000-0000-4000-8000-000000000101",
        status: "approved",
        current_verification_record_id: null,
      },
      publication: {
        profile_id: canonicalId,
        review_cycle_id: historicId,
        publication_number: 1,
        name: "Fictional Historic Snapshot",
      },
      schedule: { profile_id: canonicalId, revision: 1 },
      content: {
        name: "Fictional Historic Snapshot",
        description: "Fictional description",
        house_rules: "Fictional rules",
      },
    });
    expect(baseline.publicationId).toMatch(uuidPattern);
    expect(baseline.scheduleId).toMatch(uuidPattern);
    expect(baseline.sources).toContainEqual(
      expect.objectContaining({
        profile_id: canonicalId,
        revision: 1,
        description: "Fictional description",
        house_rules: "Fictional rules",
      }),
    );
    if (baseline.state === "paused") {
      const [restoration, restriction] = baseline.actions;
      expect(restoration).toMatchObject({
        target_kind: "cottage",
        profile_id: canonicalId,
        action: "reactivate",
        reason: "Fictional canonical cottage eligible paused restoration",
        from_state: "suspended",
        to_state: "paused",
        resulting_revision: baseline.revision,
      });
      expect(restriction).toMatchObject({
        target_kind: "cottage",
        profile_id: canonicalId,
        actor_user_id: restoration.actor_user_id,
        action: "suspend",
        reason: "Fictional canonical cottage safety restriction",
        from_state: "published",
        to_state: "suspended",
        expected_revision: baseline.revision - 2,
        resulting_revision: baseline.revision - 1,
      });
      expect(restoration.expected_revision).toBe(
        restriction.resulting_revision,
      );
      expect(baseline.previousListingState).toBe("published");
      const paused = baseline;
      restoreCanonicalListing(paused, restoration.id);
      baseline = canonicalFacts();
      expect(baseline).toEqual({ ...paused, state: "published" });
    }
    expect(baseline.state).toBe("published");
    let captureFacts: ReturnType<typeof canonicalFacts> | undefined;
    try {
      await page.goto(`/en/administrator/cottages/${canonicalId}`);
      await expect(cottage.locator(".status-badge")).toHaveText("Published");
      const restriction = await act(
        cottage,
        "suspend",
        "Fictional canonical cottage safety restriction",
        "Suspended",
      );
      const prediction = JSON.parse(
        harness.runSql(`begin; set local role authenticated;
      set local request.jwt.claims='{"sub":"${actorId}","role":"authenticated","aal":"aal2"}';
      select public.get_marketplace_suspension('cottage','${canonicalId}'); commit;`),
      );
      expect(prediction).toMatchObject({
        status: "ready",
        targetKind: "cottage",
        targetId: canonicalId,
        state: "suspended",
        restorationState: "paused",
        restorationRestriction: "publication-or-owner-ineligible",
      });
      expect(prediction.actions[0].id).toBe(restriction.id);
      const restoration = await act(
        cottage,
        "reactivate",
        "Fictional canonical cottage eligible paused restoration",
        "Paused",
      );
      const after = canonicalFacts();
      expect(after).toEqual({
        ...baseline,
        state: "paused",
        revision: baseline.revision + 2,
        previousListingState: "published",
        actions: after.actions,
      });
      expect(
        after.actions.slice(0, 2).map((action: { id: string }) => action.id),
      ).toEqual([restoration.id, restriction.id]);
      expect(after.actions.slice(2)).toEqual(baseline.actions);
      captureFacts = after;
      const actions = readHistory();
      expect(actions).toHaveLength(8);
      expect(actions.slice(0, 6)).toEqual(retained);
      expect(actions.slice(6)).toEqual([restriction, restoration]);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/ckb/administrator/cottages/${canonicalId}`);
      await expect(page.locator("html")).toHaveAttribute("lang", "ckb");
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      const soraniCottage = page.getByRole("region", {
        name: "چالاکی ماڵ",
        exact: true,
      });
      await expect(soraniCottage.locator(".status-badge")).toHaveText(
        "وەستێنراو",
      );
      await expect(soraniCottage).toContainText(
        "شایستەیی بڵاوکردنەوە یان خشتە یان خاوەن ڕێگە بە بڵاوکردنەوەی ڕیکلام نادات.",
      );
      const restorationAudit = soraniCottage
        .getByRole("listitem")
        .filter({
          has: page.getByText(restoration.reason, { exact: true }),
        })
        .filter({ has: page.getByText(actorId, { exact: true }) });
      await expect(restorationAudit).toHaveCount(1);
      await expect(
        restorationAudit.getByText(restoration.reason, { exact: true }),
      ).toBeVisible();
      expect(readHistory()).toEqual(actions);
      const accessibility = await observeAccessibility(soraniCottage, "هۆکار");
      const capture = testInfo.outputPath("administrator-ckb-mobile.png");
      await soraniCottage.screenshot({ path: capture });
      await testInfo.attach("administrator-ckb-mobile", {
        path: capture,
        contentType: "image/png",
      });
      const administratorCkbMobileStatePath = testInfo.outputPath(
        "administrator-ckb-mobile-state.json",
      );
      await writeFile(
        administratorCkbMobileStatePath,
        JSON.stringify({
          viewport: page.viewportSize(),
          lang: await page.locator("html").getAttribute("lang"),
          dir: await page.locator("html").getAttribute("dir"),
          facts: after,
          actions: [restriction, restoration],
          accessibility,
        }),
      );
      await testInfo.attach("administrator-ckb-mobile-state", {
        path: administratorCkbMobileStatePath,
        contentType: "application/json",
      });
    } catch (error) {
      canonicalFailed = true;
      canonicalFailure = error;
    } finally {
      try {
        let current = canonicalFacts();
        expect(current).toEqual({
          ...baseline,
          state: current.state,
          restricted: current.restricted,
          revision: current.revision,
          previousListingState: current.previousListingState,
          actions: current.actions,
        });
        const ownActions = current.actions.filter(
          (action: { actor_user_id: string }) =>
            action.actor_user_id === actorId,
        );
        if (current.revision !== baseline.revision) {
          const latest = current.actions[0];
          expect(
            latest.actor_user_id,
            "An outside canonical restriction must remain untouched",
          ).toBe(actorId);
          if (current.restricted) {
            expect(current.state).toBe("suspended");
            expect(latest).toMatchObject({
              action: "suspend",
              reason: "Fictional canonical cottage safety restriction",
              from_state: "published",
              to_state: "suspended",
              expected_revision: baseline.revision,
              resulting_revision: current.revision,
            });
            expect(current.revision).toBe(baseline.revision + 1);
            const reactivated = JSON.parse(
              harness.runSql(`begin; set local role authenticated;
              set local request.jwt.claims='{"sub":"${actorId}","role":"authenticated","aal":"aal2"}';
              select public.set_marketplace_suspension('cottage','${canonicalId}','reactivate',${current.revision},'Fictional canonical cottage eligible paused restoration','${randomUUID()}'); commit;`),
            );
            expect(reactivated.status).toBe("completed");
            current = canonicalFacts();
            expect(current.actions[0].id).toBe(reactivated.actionId);
          }
          expect(current).toMatchObject({
            state: "paused",
            restricted: false,
            revision: baseline.revision + 2,
            previousListingState: "published",
            pending: 0,
          });
          expect(current.actions[0]).toMatchObject({
            actor_user_id: actorId,
            action: "reactivate",
            reason: "Fictional canonical cottage eligible paused restoration",
            from_state: "suspended",
            to_state: "paused",
            resulting_revision: current.revision,
          });
          expect(current.actions[1]).toMatchObject({
            actor_user_id: actorId,
            action: "suspend",
            reason: "Fictional canonical cottage safety restriction",
            from_state: "published",
            to_state: "suspended",
            resulting_revision: baseline.revision + 1,
          });
          expect(current.actions.slice(2)).toEqual(baseline.actions);
          const paused = current;
          restoreCanonicalListing(paused, current.actions[0].id);
          current = canonicalFacts();
          expect(current).toEqual({ ...paused, state: baseline.state });
        } else {
          expect(ownActions).toEqual([]);
          expect(current).toEqual(baseline);
        }
        expect(current.state).toBe("published");
        expect(current.restricted).toBe(false);
        canonicalRetention = {
          baseline,
          captureFacts,
          restoredBaseline: current,
          actions: current.actions.filter(
            (action: { actor_user_id: string }) =>
              action.actor_user_id === actorId,
          ),
        };
      } catch (error) {
        canonicalRestorationError =
          error instanceof Error ? error.message : String(error);
        if (canonicalFailed)
          testInfo.annotations.push({
            type: "fixture restoration failed",
            description: canonicalRestorationError,
          });
        else {
          canonicalFailed = true;
          canonicalFailure = error;
        }
      }
    }
  }
  const suspensionRetainedAdministratorGraphPath = testInfo.outputPath(
    "suspension-retained-administrator-graph.json",
  );
  try {
    await writeFile(
      suspensionRetainedAdministratorGraphPath,
      JSON.stringify({
        actorId,
        ownerId,
        profile: profile.data,
        actions: readHistory(),
        canonicalRetention,
        canonicalRestorationError,
      }),
    );
    await testInfo.attach("suspension-retained-administrator-graph", {
      path: suspensionRetainedAdministratorGraphPath,
      contentType: "application/json",
    });
  } catch (error) {
    if (!canonicalFailed) throw error;
    testInfo.annotations.push({
      type: "fixture receipt failed",
      description: error instanceof Error ? error.message : String(error),
    });
  }
  if (canonicalFailed) throw canonicalFailure;
});

const queueArgs = {
  target_queue: "requests",
  target_state: null,
  target_from: null,
  target_through: null,
  after_at: null,
  after_id: null,
};

const totalsArgs = {
  target_state: null,
  target_from: null,
  target_through: null,
};

async function expectQueuesDenied(page: Page) {
  await page.goto("/en/administrator/totals");
  await expect(page.locator("main")).toContainText(
    "Administrator access with authenticator verification is required.",
  );
  await page.goto("/en/administrator/queues");
  await expect(page.locator("main")).toContainText(
    "Administrator access with authenticator verification is required.",
  );
  await expect(page.locator('a[href*="/administrator/payments/"]')).toHaveCount(
    0,
  );
}

test("marketplace users and AAL1 administrators cannot discover administrator records", async ({
  page,
}) => {
  const fixture = reviewFixture;
  harness.guardDisposableLocalDatabase();
  const auditCount = () =>
    count("select count(*) from private.administrator_booking_money_exports;");
  const beforeExports = auditCount();
  await page.goto("/en/owner/access");
  const refuseExport = async () => {
    const origin = new URL(page.url()).origin;
    const response = await page.request.post(
      `${origin}/en/administrator/totals/export`,
      {
        form: {},
        headers: { Origin: origin, "Sec-Fetch-Site": "same-origin" },
        maxRedirects: 0,
      },
    );
    expect(response.status()).toBe(303);
    expect(response.headers()["content-disposition"]).toBeUndefined();
    expect(response.headers()["content-type"] ?? "").not.toContain("text/csv");
    expect(response.headers().location).toBe(
      `${origin}/en/administrator/totals?exportError=access_required`,
    );
    expect(auditCount()).toBe(beforeExports);
  };
  await refuseExport();
  const actualOrigin = new URL(page.url()).origin;
  for (const [source, forwardedHost, forwardedProto, status] of [
    [actualOrigin, "hostile.example", "http", 303],
    // Next derives the scheme from forwarded protocol; Worker preserves the incoming target.
    [
      actualOrigin,
      "hostile.example",
      "https",
      process.env.PLAYWRIGHT_SERVER === "worker" ? 303 : 403,
    ],
    ["https://hostile.example", "hostile.example", "https", 403],
    [
      actualOrigin.replace("127.0.0.1", "localhost"),
      new URL(actualOrigin).host,
      "http",
      403,
    ],
  ] as const) {
    const response = await page.request.post(
      `${actualOrigin}/en/administrator/totals/export`,
      {
        form: {},
        headers: {
          Origin: source,
          "Sec-Fetch-Site": "same-origin",
          "X-Forwarded-Host": forwardedHost,
          "X-Forwarded-Proto": forwardedProto,
        },
        maxRedirects: 0,
      },
    );
    expect(response.status()).toBe(status);
    expect(response.headers()["content-disposition"]).toBeUndefined();
    expect(response.headers()["content-type"] ?? "").not.toContain("text/csv");
    if (status === 303)
      expect(response.headers().location).toBe(
        `${actualOrigin}/en/administrator/totals?exportError=access_required`,
      );
    else expect(response.headers().location).toBeUndefined();
    expect(auditCount()).toBe(beforeExports);
  }
  for (const method of ["GET", "HEAD"])
    expect(
      (
        await page.request.fetch("/en/administrator/totals/export", { method })
      ).status(),
    ).toBe(405);
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
  await refuseExport();
  expect(
    (
      await customer.rpc(
        "record_administrator_booking_money_export",
        totalsArgs,
      )
    ).error?.code,
  ).toBe("42501");
  await expectQueuesDenied(page);
  expect(
    (await customer.rpc("search_administrator_booking_queue", queueArgs)).error
      ?.code,
  ).toBe("42501");
  expect(
    (await customer.rpc("list_administrator_booking_money", totalsArgs)).error
      ?.code,
  ).toBe("42501");
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
  await refuseExport();
  expect(
    (await aal1.rpc("record_administrator_booking_money_export", totalsArgs))
      .error?.code,
  ).toBe("42501");
  expect(auditCount()).toBe(beforeExports);
  await expectQueuesDenied(page);
  expect(
    (await aal1.rpc("search_administrator_booking_queue", queueArgs)).error
      ?.code,
  ).toBe("42501");
  expect(
    (await aal1.rpc("list_administrator_booking_money", totalsArgs)).error
      ?.code,
  ).toBe("42501");
});
