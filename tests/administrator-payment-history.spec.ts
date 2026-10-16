import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as OTPAuth from "otpauth";

type Harness = {
  guardDisposableLocalDatabase(): void;
  runSql(sql: string): string;
};
const { createLocalSupabaseConcurrencyHarness } = createRequire(
  import.meta.url,
)("../scripts/local-supabase-concurrency-harness.mjs") as {
  createLocalSupabaseConcurrencyHarness(): Harness;
};
const { captureCleanup } = createRequire(import.meta.url)(
  "../scripts/lib/booking-fixture.mjs",
) as {
  captureCleanup(options?: {
    stem?: string;
    paymentRecovery?: boolean;
    releaseOperations?: boolean;
    publishedCottage?: boolean;
  }): string;
};

const reference = "RC-REQ-0000000000000137";
const harness = createLocalSupabaseConcurrencyHarness();
const fixture = readFileSync(
  "supabase/tests/database/booking_request_payment_history.test.sql",
  "utf8",
)
  .split("-- BEGIN HISTORY BROWSER FIXTURE")[1]
  .split("-- END HISTORY BROWSER FIXTURE")[0];
// The existing support journey also displays a real accepted non-simulator reference.
const supportRequest = "60000000-0000-4000-8000-000000001511";
const supportReference = "RC-REQ-0000000000001511";
const supportLifecycle = "73000000-0000-4000-8000-000000001511";
const supportProvider = {
  provider: "fictional-payments",
  environment: "local-test",
  merchantId: "fictional-merchant",
  terminalId: "fictional-terminal",
};
const supportFingerprint = createHash("sha256")
  .update(
    JSON.stringify({
      provider: supportProvider,
      kind: "capture",
      paymentLifecycleId: supportLifecycle,
      logicalOperationId: `${supportLifecycle}:capture`,
      attemptId: `${supportLifecycle}:capture:attempt-2`,
      amountFils: 115000000,
      currency: "IQD",
    }),
  )
  .digest("hex");
const supportFixture = readFileSync(
  "supabase/tests/database/booking_request_payment_history.test.sql",
  "utf8",
)
  .split("-- BEGIN CAPTURE RECOVERY SOURCE")[1]
  .split("-- END CAPTURE RECOVERY SOURCE")[0]
  .replaceAll("00000000100", "00000000151")
  .replaceAll("750000100", "750000151")
  .replaceAll("confirmation-auth-", "support-auth-")
  .replaceAll("CONFIRMATION-HOLD-1", "SUPPORT-HOLD-1511")
  .replaceAll(
    "6f86ac037886a0823766736c1c1ffb409cd9c98be93f038e0cfe5219c2a4a99d",
    supportFingerprint,
  );
const supportCleanup = captureCleanup({ stem: "151" });
const fixtureCleanup = `begin;
  alter table public.booking_notification_events disable trigger reject_booking_notification_events_change;
  delete from public.booking_notification_events where booking_request_id='60000000-0000-4000-8000-000000001371';
  alter table public.booking_notification_events enable trigger reject_booking_notification_events_change;
  alter table public.booking_request_payment_history disable trigger reject_booking_request_payment_history_change;
  delete from public.booking_request_payment_history
  where payment_lifecycle_id = '73000000-0000-4000-8000-000000001371';
  alter table public.booking_request_payment_history enable trigger reject_booking_request_payment_history_change;
  delete from public.booking_requests where id = '60000000-0000-4000-8000-000000001371';
  alter table public.booking_snapshots disable trigger reject_booking_snapshot_update;
  delete from public.booking_snapshots where id = '40000000-0000-4000-8000-000000001371';
  alter table public.booking_snapshots enable trigger reject_booking_snapshot_update;
  delete from public.cottage_inventory_commitments where id = '51000000-0000-4000-8000-000000001371';
  delete from public.cottage_booking_period_occupancies where booking_period_commitment_id = '50000000-0000-4000-8000-000000001371';
  delete from public.cottage_booking_period_commitments where id = '50000000-0000-4000-8000-000000001371';
  alter table public.cottage_shifts disable trigger reject_cottage_shift_delete;
  delete from public.cottage_shifts where schedule_revision_id = '30000000-0000-4000-8000-000000001371';
  alter table public.cottage_shifts enable trigger reject_cottage_shift_delete;
  alter table public.cottage_shift_schedule_revisions disable trigger reject_cottage_shift_schedule_revision_delete;
  delete from public.cottage_shift_schedule_revisions where id = '30000000-0000-4000-8000-000000001371';
  alter table public.cottage_shift_schedule_revisions enable trigger reject_cottage_shift_schedule_revision_delete;
  delete from public.owner_application_cottage_profiles where id = '20000000-0000-4000-8000-000000001371';
  delete from public.account_contexts where user_id in ('10000000-0000-4000-8000-000000001371', '10000000-0000-4000-8000-000000001372');
  delete from auth.users where id in ('10000000-0000-4000-8000-000000001371', '10000000-0000-4000-8000-000000001372');
commit;`;

test.beforeAll(() => {
  harness.guardDisposableLocalDatabase();
  if (
    harness.runSql(
      `select count(*) from public.booking_requests where booking_request_reference='${reference}';`,
    ) === "0"
  )
    harness.runSql(`begin;${fixture}commit;`);
});

test.beforeAll(() => {
  harness.guardDisposableLocalDatabase();
  harness.runSql(supportCleanup);
  harness.runSql(`begin;${readFileSync("supabase/fixtures/payment-evidence.sql", "utf8")}${supportFixture}
    set local role service_role;
    select pg_temp.capture_execute(public.lease_booking_request_capture_work('${supportRequest}','${JSON.stringify(supportProvider)}'::jsonb)->'permit','succeeded');
    commit;`);
});

test.afterAll(() => {
  harness.guardDisposableLocalDatabase();
  harness.runSql(supportCleanup);
  harness.runSql(fixtureCleanup);
});

test("AAL2 support sees ordered redacted history in every launch language", async ({
  page,
}, testInfo) => {
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (
    process.env.APP_ENVIRONMENT !== "test" ||
    !url ||
    new URL(url).hostname !== "127.0.0.1" ||
    !secretKey
  )
    throw new Error("History browser fixtures require local test Supabase");
  const admin = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // A distinct administrator prevents MFA enrollment from colliding with access.spec
  // or a previous focused attempt. The disposable database owns these fictional users.
  const email = `payment-history-${testInfo.project.name}-${randomUUID()}@rentcottage.test`;
  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email,
      password: "Local-test-password-2026",
      email_confirm: true,
    });
  if (createError || !created.user)
    throw new Error("History administrator fixture creation failed", {
      cause: createError,
    });
  const { error: provisionError } = await admin.rpc(
    "provision_platform_administrator",
    { target_user_id: created.user.id },
  );
  if (provisionError)
    throw new Error("History administrator fixture provisioning failed", {
      cause: provisionError,
    });
  harness.runSql(
    `insert into public.account_names (user_id, first_name) values ('${created.user.id}', 'Sara') on conflict (user_id) do update set first_name = excluded.first_name;`,
  );
  await page.goto("/en/administrator/access");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("Local-test-password-2026");
  await page.getByRole("button", { name: "Continue" }).click();
  const secret = await page.getByTestId("mfa-secret").textContent();
  if (!secret) throw new Error("MFA enrollment returned no secret");

  const aal1Page = await page.context().newPage();
  await aal1Page.goto(`/en/administrator/payments/${reference}`);
  await expect(aal1Page.getByText(/assurance level 2/i)).toBeVisible();
  await aal1Page.close();

  const code = new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(secret),
  }).generate();
  await page.getByLabel("Authenticator app code").fill(code);
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByText(/Administrator access is ready/)).toBeVisible();

  await page.goto("/en/administrator/payments");
  const lookup = page.getByRole("button", { name: "View payment history" });
  // A raw browser button computes weight 400 and radius 0px here.
  await expect(lookup).toHaveCSS("font-weight", "700");
  await expect(lookup).not.toHaveCSS("border-radius", "0px");
  const lookupField = page.getByLabel("Booking Request reference");
  await expect
    .poll(async () => {
      const [field, action] = await Promise.all([
        lookupField.boundingBox(),
        lookup.boundingBox(),
      ]);
      return action!.y - (field!.y + field!.height);
    })
    .toBeGreaterThanOrEqual(8);

  for (const [locale, heading, pending, physical, succeeded, retry] of [
    [
      "en",
      "Payment support history",
      "Pending",
      "Physical attempt",
      "Succeeded",
      "Retrying",
    ],
    [
      "ar",
      "سجل دعم الدفع",
      "قيد الانتظار",
      "محاولة تنفيذ",
      "ناجح",
      "إعادة المحاولة",
    ],
    [
      "ckb",
      "مێژووی پشتگیری پارەدان",
      "چاوەڕێ",
      "هەوڵی جێبەجێکردن",
      "سەرکەوتوو",
      "هەوڵدانەوە",
    ],
  ] as const) {
    await page.goto(`/${locale}/administrator/payments/${reference}`);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    const events = page.getByRole("listitem");
    await expect(events).toHaveCount(3);
    await expect(
      page.getByText(pending, { exact: true }).first(),
    ).toBeVisible();
    await expect(events.nth(1)).toContainText(physical);
    await expect(events.nth(1)).toContainText(succeeded);
    await expect(events.nth(2)).toContainText(retry);
    await expect(events.nth(1)).toContainText(
      { en: "IQD 105,000", ar: "IQD 105,000", ckb: "IQD ١٠٥٬٠٠٠" }[locale],
    );
    await expect(events.nth(1)).not.toContainText("105000000 IQD");
    if (locale !== "en")
      await expect(page.locator("main")).not.toContainText(
        /physical-attempt|state-transition|succeeded|retrying|unclassified-evidence/,
      );
    await expect(page.locator("html")).toHaveAttribute(
      "dir",
      locale === "en" ? "ltr" : "rtl",
    );
    await expect(page.getByText("Sensitive Customer")).toHaveCount(0);
    await expect(page.getByText("merchant-secret-value")).toHaveCount(0);
    await expect(page.getByText("raw-provider-token")).toHaveCount(0);
    if (testInfo.project.name === "mobile" && locale === "ar") {
      const viewport = page.viewportSize()!;
      try {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.evaluate(() => document.fonts.ready);
        await expect(events).toHaveCount(3);
        await expect(events.nth(2)).toContainText(retry);
        const capture = testInfo.outputPath(
          "563-before-after-payment-history-ar-390.png",
        );
        await page.screenshot({ path: capture, fullPage: true });
        await testInfo.attach("563-before-after-payment-history-ar-390", {
          path: capture,
          contentType: "image/png",
        });
        const measurements = await page.evaluate(() => ({
          viewport: { width: window.innerWidth, height: window.innerHeight },
          document: {
            width: document.documentElement.scrollWidth,
            height: document.documentElement.scrollHeight,
            clientWidth: document.documentElement.clientWidth,
            clientHeight: document.documentElement.clientHeight,
          },
          elements: [...document.querySelectorAll("body *")].flatMap(
            (element, index) => {
              const bounds = element.getBoundingClientRect();
              const interactive = element.matches(
                'a[href], button, input, select, textarea, summary, label, [tabindex], [contenteditable="true"], [role="button"], [role="link"]',
              );
              const directText = [...element.childNodes].some(
                (node) =>
                  node.nodeType === Node.TEXT_NODE &&
                  /\S/.test(node.nodeValue ?? ""),
              );
              if (
                (!interactive && !directText) ||
                !element.checkVisibility({
                  checkOpacity: true,
                  checkVisibilityCSS: true,
                }) ||
                bounds.width === 0 ||
                bounds.height === 0
              )
                return [];
              const style = getComputedStyle(element);
              const ancestors = [];
              for (
                let ancestor = element.parentElement;
                ancestor;
                ancestor = ancestor.parentElement
              ) {
                const background = getComputedStyle(ancestor);
                ancestors.push({
                  tag: ancestor.localName,
                  id: ancestor.id,
                  backgroundColor: background.backgroundColor,
                  backgroundImage:
                    background.backgroundImage === "none" ? "none" : "present",
                  opacity: background.opacity,
                });
              }
              return [
                {
                  index,
                  tag: element.localName,
                  id: element.id,
                  className: element.getAttribute("class"),
                  role: element.getAttribute("role"),
                  type: element.getAttribute("type"),
                  ariaLabel: element.getAttribute("aria-label"),
                  ariaLabelledby: element.getAttribute("aria-labelledby"),
                  ariaDescribedby: element.getAttribute("aria-describedby"),
                  labelIds:
                    element instanceof HTMLInputElement ||
                    element instanceof HTMLButtonElement ||
                    element instanceof HTMLSelectElement ||
                    element instanceof HTMLTextAreaElement
                      ? [...(element.labels ?? [])].map((label) => label.id)
                      : [],
                  interactive,
                  directText,
                  active: document.activeElement === element,
                  focusVisible: element.matches(":focus-visible"),
                  bounds: bounds.toJSON(),
                  color: style.color,
                  backgroundColor: style.backgroundColor,
                  backgroundImage:
                    style.backgroundImage === "none" ? "none" : "present",
                  fontSize: style.fontSize,
                  fontWeight: style.fontWeight,
                  outlineStyle: style.outlineStyle,
                  outlineColor: style.outlineColor,
                  outlineWidth: style.outlineWidth,
                  outlineOffset: style.outlineOffset,
                  opacity: style.opacity,
                  ancestors,
                },
              ];
            },
          ),
        }));
        await testInfo.attach("563-before-after-payment-history-ar-390.json", {
          body: JSON.stringify(measurements, null, 2),
          contentType: "application/json",
        });
        await page.setViewportSize({ width: 320, height: 844 });
        const reflow = await page.evaluate(async () => {
          await document.fonts.ready;
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
          return {
            innerWidth: window.innerWidth,
            document: {
              clientWidth: document.documentElement.clientWidth,
              scrollWidth: document.documentElement.scrollWidth,
              language: document.documentElement.lang,
              direction: document.documentElement.dir,
            },
            elements: [
              ...document.querySelectorAll(
                "header, header *, nav, nav *, main, main *",
              ),
            ].flatMap((element, index) => {
              const bounds = element.getBoundingClientRect();
              if (
                !element.checkVisibility({
                  checkOpacity: true,
                  checkVisibilityCSS: true,
                }) ||
                bounds.width === 0 ||
                bounds.height === 0
              )
                return [];
              const style = getComputedStyle(element);
              return [
                {
                  index,
                  tag: element.localName,
                  id: element.id,
                  className: element.getAttribute("class"),
                  role: element.getAttribute("role"),
                  bounds: bounds.toJSON(),
                  clientWidth: element.clientWidth,
                  scrollWidth: element.scrollWidth,
                  overflowX: style.overflowX,
                  overflowY: style.overflowY,
                  whiteSpace: style.whiteSpace,
                  overflowWrap: style.overflowWrap,
                  wordBreak: style.wordBreak,
                  textOverflow: style.textOverflow,
                  fontSize: style.fontSize,
                  outsideViewport:
                    bounds.left < 0 ||
                    bounds.right > document.documentElement.clientWidth,
                  scrollOverflow: element.scrollWidth > element.clientWidth,
                },
              ];
            }),
          };
        });
        await testInfo.attach(
          "563-before-after-payment-history-ar-390-reflow-320.json",
          {
            body: JSON.stringify(reflow, null, 2),
            contentType: "application/json",
          },
        );
      } finally {
        await page.setViewportSize(viewport);
      }
    }
    await page.goto(`/${locale}/administrator/payments/${supportReference}`);
    const supportLabel = {
      en: "Internal support reference",
      ar: "مرجع دعم داخلي",
      ckb: "ژمارەی ئاماژەی ناوخۆیی پشتگیری",
    }[locale];
    await expect(
      page.getByText(supportLabel, { exact: true }).first(),
    ).toBeVisible();
    for (const kind of ["request", "reference", "movement"]) {
      await expect(
        page.getByText(new RegExp(`^internal-${kind}:[0-9a-f-]{36}$`)).first(),
      ).toBeVisible();
    }
    await expect(page.locator("main")).not.toContainText(
      /fixture-request-|fixture-reference-|fixture-movement-/,
    );
  }

  // Fail only the read RPC in the guarded disposable DB. Restore its exact
  // definition even when an assertion fails; payment procedures are untouched.
  const readDefinition = harness.runSql(
    "select pg_get_functiondef('public.get_administrator_booking_request_payment_history(text)'::regprocedure);",
  );
  try {
    harness.runSql(
      "create or replace function public.get_administrator_booking_request_payment_history(target_reference text) returns jsonb language plpgsql stable security definer set search_path='' as $$ begin raise exception 'Local history read fixture unavailable'; end; $$;",
    );
    for (const [locale, message] of [
      [
        "en",
        "Payment support history is temporarily unavailable. Please try again.",
      ],
      ["ar", "سجل دعم الدفع غير متاح مؤقتاً. يرجى المحاولة مرة أخرى."],
      [
        "ckb",
        "مێژووی پشتگیری پارەدان کاتێکی کورت بەردەست نییە. دووبارە هەوڵ بدەوە.",
      ],
    ] as const) {
      await page.goto(`/${locale}/administrator/payments/${reference}`);
      await expect(page.getByRole("main").getByRole("alert")).toContainText(
        message,
      );
      await expect(
        page.getByRole("main").getByRole("alert").getByRole("link"),
      ).toHaveCount(0);
    }
  } finally {
    harness.runSql(readDefinition);
    expect(
      harness.runSql(
        "select pg_get_functiondef('public.get_administrator_booking_request_payment_history(text)'::regprocedure);",
      ),
    ).toBe(readDefinition);
  }
  await page.goto(`/en/administrator/payments/${reference}`);
  await expect(
    page.getByRole("heading", { name: "Payment support history" }),
  ).toBeVisible();
});
