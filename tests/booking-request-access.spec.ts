import { triggerScheduled } from "./fixtures/trigger-scheduled";

// SQL arrangement mirrors admission, isolated effect, and explicit recording.
const paymentEvidenceSql =
  "-- BEGIN PAYMENT EVIDENCE FIXTURE\n" +
  readFileSync("supabase/fixtures/payment-evidence.sql", "utf8") +
  "\n-- END PAYMENT EVIDENCE FIXTURE\n";
import { readFileSync } from "node:fs";
import { selectPaymentRequiredExpiry } from "../src/booking-request/booking-request-payment-required-expiry";
import { bookingRequestPaymentFactsFrom } from "../src/booking-request/supabase-booking-request-payment-observation";
import { bookingTermsFixture } from "../src/booking-request/booking-terms-fixture";
import { paidConfirmationNotice } from "../src/notification/paid-confirmation-notice";
import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";

type AccessBrowserFixture = {
  bookingCottageName: string;
  bookingOwnerPhone: string;
  exactAddress: string;
};

const { accessBrowserFixture } = createRequire(import.meta.url)(
  "../scripts/lib/access-browser-fixtures.mjs",
) as {
  accessBrowserFixture(project: string): AccessBrowserFixture;
};

const { createLocalSupabaseConcurrencyHarness } = createRequire(
  import.meta.url,
)("../scripts/local-supabase-concurrency-harness.mjs") as {
  createLocalSupabaseConcurrencyHarness(): {
    guardDisposableLocalDatabase(): void;
    runSql(sql: string): string;
  };
};

const customerPhones: Record<string, string> = {
  mobile: "+9647520000000",
  desktop: "+9647520000001",
  worker: "+9647520000002",
};

function serviceDay(offset: number) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Baghdad",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(Date.now() + offset * 86_400_000));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

test("a verified Customer double-submit creates one Pending request and one minimal owner notice", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(testInfo.project.name === "worker" ? 480_000 : 120_000);
  const target = new URL(process.env.SUPABASE_URL ?? "invalid:");
  if (
    process.env.APP_ENVIRONMENT !== "test" ||
    target.protocol !== "http:" ||
    target.hostname !== "127.0.0.1"
  ) {
    throw new Error("Booking Request journey requires isolated local fixtures");
  }
  const bookingFixture = accessBrowserFixture(testInfo.project.name);
  const ownerPhone = bookingFixture.bookingOwnerPhone;
  const cottageName = bookingFixture.bookingCottageName;
  const exactAddress = bookingFixture.exactAddress;
  const customerPhone = customerPhones[testInfo.project.name];
  const offset = { mobile: 4, desktop: 5, worker: 6 }[testInfo.project.name];
  if (!customerPhone || !offset) {
    throw new Error("Booking fixture is unmapped");
  }

  const fixtureOwner = createClient(
    process.env.SUPABASE_URL ?? "",
    process.env.SUPABASE_PUBLISHABLE_KEY ?? "",
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { error: signInError } = await fixtureOwner.auth.signInWithPassword({
    phone: ownerPhone,
    password: "Local-test-password-2026",
  });
  if (signInError) throw signInError;
  const { data: profile, error: profileError } = await fixtureOwner
    .from("owner_application_cottage_profiles")
    .select("id,current_shift_schedule_id")
    .eq("name", cottageName)
    .not("current_publication_id", "is", null)
    .not("current_shift_schedule_id", "is", null)
    .single();
  if (profileError) throw profileError;
  if (!profile?.current_shift_schedule_id) {
    throw new Error("Published Booking Request fixture is unavailable");
  }
  const { data: shifts, error: shiftsError } = await fixtureOwner
    .from("cottage_shifts")
    .select("id,position")
    .eq("schedule_revision_id", profile.current_shift_schedule_id)
    .order("position");
  if (shiftsError) throw shiftsError;
  const { data: schedule, error: scheduleError } = await fixtureOwner
    .from("cottage_shift_schedule_revisions")
    .select("full_day_bundle_id")
    .eq("id", profile.current_shift_schedule_id)
    .single();
  if (scheduleError) throw scheduleError;
  const shift = shifts[0];
  if (!shift || !schedule.full_day_bundle_id) {
    throw new Error("Booking Request schedule fixture is incomplete");
  }
  const requestedDay = serviceDay(offset);
  const { error: pricingError } = await fixtureOwner.rpc(
    "save_cottage_inventory_pricing",
    {
      target_profile_id: profile.id,
      target_schedule_revision_id: profile.current_shift_schedule_id,
      requested_prices: {
        units: [
          ...shifts.map((item) => ({
            unitId: item.id,
            unitKind: "shift",
            standardPriceIqd: 170000 + item.position * 10000,
          })),
          {
            unitId: schedule.full_day_bundle_id,
            unitKind: "full_day_bundle",
            standardPriceIqd: 250000,
          },
        ],
      },
    },
  );
  if (pricingError) throw pricingError;
  const { error: availabilityError } = await fixtureOwner.rpc(
    "set_cottage_inventory_availability",
    {
      target_profile_id: profile.id,
      target_schedule_revision_id: profile.current_shift_schedule_id,
      target_service_day: requestedDay,
      requested_states: [
        ...shifts.map((item) => ({
          unitId: item.id,
          unitKind: "shift",
          state: "open",
        })),
        {
          unitId: schedule.full_day_bundle_id,
          unitKind: "full_day_bundle",
          state: "open",
        },
      ],
    },
  );
  if (availabilityError) throw availabilityError;

  const slug = `cottage-${profile.id.replaceAll("-", "")}`;
  const query = new URLSearchParams({
    from: requestedDay,
    to: requestedDay,
    guests: "4",
    selection: `${requestedDay}:shift:${shift.position}`,
  });
  await page.goto(`/en/request/${slug}?${query.toString()}`);
  await expect(
    page.getByRole("heading", { name: "Verify your phone to continue" }),
  ).toBeVisible();
  await page.getByLabel("Iraqi phone number").fill(customerPhone);
  await page.getByRole("button", { name: "Send verification code" }).click();
  const verificationCode = page.getByLabel("Verification code");
  await expect(verificationCode).toBeVisible();
  await verificationCode.fill("123456");
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Send your Booking Request" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "العربية" }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(
    page.getByRole("heading", { name: "أرسل طلب الحجز" }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("ar-booking-request-form.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "English" }).click();
  await expect(
    page.getByRole("heading", { name: "Send your Booking Request" }),
  ).toBeVisible();
  await page.getByLabel("Customer name").fill("Browser Customer");
  await page.getByLabel(/accept the preserved House Rules/i).check();
  await page.getByLabel(/accept the cancellation policy/i).check();
  await page.getByLabel(/accept the marketplace booking terms/i).check();
  await page
    .getByRole("form", { name: "Send your Booking Request" })
    .evaluate((form) => {
      (form as HTMLFormElement).requestSubmit();
      (form as HTMLFormElement).requestSubmit();
    });

  await expect(
    page.getByRole("heading", { name: "Booking Request pending" }),
  ).toBeVisible();
  await expect(page.getByText(/does not reserve/)).toHaveCount(0);
  await expect(page.getByText("Owner response deadline")).toBeVisible();
  expect(await page.locator("body").innerText()).not.toContain(exactAddress);
  expect(await page.content()).not.toContain(ownerPhone);
  const requestReference = await page
    .getByText(/^RC-REQ-[A-F0-9]{16}$/)
    .innerText();
  expect(requestReference).toMatch(/^RC-REQ-[A-F0-9]{16}$/);
  const unpaidResponse = await page.goto(
    `/en/booking-requests/${requestReference}`,
  );
  expect(unpaidResponse?.ok()).toBe(true);
  const unpaidResponseBody = await unpaidResponse!.text();
  expect(unpaidResponseBody).not.toContain(exactAddress);
  expect(unpaidResponseBody).not.toContain(ownerPhone);
  await page.screenshot({
    path: testInfo.outputPath("en-booking-request-pending.png"),
    fullPage: true,
  });
  const ownerContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  });
  const ownerPage = await ownerContext.newPage();
  const ownerPaidDetailPrefetches: string[] = [];
  ownerPage.on("request", (request) => {
    const headers = request.headers();
    if (
      new URL(ownerPage.url()).pathname === "/en/owner/cottages" &&
      new URL(request.url()).pathname.startsWith(
        "/en/owner/booking-requests/",
      ) &&
      (headers["next-router-prefetch"] ||
        headers["next-router-segment-prefetch"])
    ) {
      ownerPaidDetailPrefetches.push(new URL(request.url()).pathname);
    }
  });
  await ownerPage.goto("/en/owner/access");
  await ownerPage.getByLabel("Iraqi phone number").fill(ownerPhone);
  await ownerPage
    .getByRole("button", { name: "Send verification code" })
    .click();
  await ownerPage.getByLabel("Verification code").fill("123456");
  await ownerPage.getByRole("button", { name: "Verify", exact: true }).click();
  await ownerPage.getByRole("link", { name: "Open Cottage Profiles" }).click();
  const ownerNotice = ownerPage.getByRole("article", {
    name: requestReference,
  });
  await expect(ownerNotice).toBeVisible();
  await expect(ownerNotice).toContainText("Browser Customer");
  await expect(ownerNotice).not.toContainText(/provider|payment|phone|@/i);
  await expect(ownerNotice).toContainText("Marketplace commission");
  await expect(ownerNotice).toContainText("Expected net amount");
  await expect(ownerNotice).toContainText("House Rules");
  await expect(ownerNotice).not.toContainText(/terms version|policy version/i);
  await expect(ownerNotice).toContainText("(Cottage Shift)");
  await ownerPage.screenshot({
    path: testInfo.outputPath("en-owner-booking-request-notice.png"),
    fullPage: true,
  });

  async function submitAnotherRequest(locale: "en" | "ckb") {
    await page.goto(`/${locale}/request/${slug}?${query.toString()}`);
    const form = page.locator("form.booking-request-form");
    await form.getByRole("textbox").first().fill("Browser Customer");
    const checkboxes = form.getByRole("checkbox");
    for (let index = 0; index < (await checkboxes.count()); index += 1) {
      await checkboxes.nth(index).check();
    }
    await form.evaluate((node) => (node as HTMLFormElement).requestSubmit());
    const reference = page.getByText(/^RC-REQ-[A-F0-9]{16}$/);
    await expect(reference).toBeVisible();
    return reference.innerText();
  }

  if (testInfo.project.name === "mobile") {
    await ownerPage.goto("/ar/owner/cottages");
    const arabicNotice = ownerPage.getByRole("article", {
      name: requestReference,
    });
    await arabicNotice
      .getByLabel("سبب الرفض")
      .selectOption("cottage_unavailable");
    await arabicNotice
      .getByLabel("ملاحظة اختيارية للعميل")
      .fill("صيانة مجدولة للمسبح.");
    await arabicNotice
      .getByRole("button", { name: "رفض الطلب كاملاً" })
      .click();
    await expect(
      arabicNotice.getByText("مرفوض", { exact: true }),
    ).toBeVisible();
    await ownerPage.reload();
    await expect(
      ownerPage.getByText("إشعار الحالة", { exact: true }),
    ).toBeVisible();
    await ownerPage.screenshot({
      path: testInfo.outputPath("ar-owner-booking-request-declined.png"),
      fullPage: true,
    });
    await page.goto(`/ar/booking-requests/${requestReference}`);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(
      page.getByText("البيت غير متاح", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("ar-customer-booking-request-declined.png"),
      fullPage: true,
    });
    const secondReference = await submitAnotherRequest("ckb");
    await page.goto(`/ckb/booking-requests/${secondReference}`);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByText("چاوەڕێ", { exact: true })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("ckb-customer-booking-request-pending.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "کشاندنەوەی داواکاری چاوەڕێ" })
      .click();
    await expect(page.getByText("کشێنراوەتەوە", { exact: true })).toBeVisible();
    await page.reload();
    await expect(
      page.getByText("ئاگادارکردنەوەی دۆخ", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("ckb-customer-booking-request-withdrawn.png"),
      fullPage: true,
    });
  } else if (testInfo.project.name === "desktop") {
    await ownerNotice
      .getByLabel("Decline reason")
      .selectOption("cannot_accommodate_request");
    await ownerNotice
      .getByLabel("Optional note to the Customer")
      .fill("The requested party cannot be accommodated safely.");
    await ownerNotice
      .getByRole("button", { name: "Decline complete request" })
      .click();
    await expect(
      ownerNotice.getByText("Declined", { exact: true }),
    ).toBeVisible();
    await ownerPage.reload();
    await expect(
      ownerPage.getByText("Status notification", { exact: true }),
    ).toBeVisible();
    await ownerPage.screenshot({
      path: testInfo.outputPath("en-owner-booking-request-declined.png"),
      fullPage: true,
    });
    await page.goto(`/en/booking-requests/${requestReference}`);
    await expect(
      page.getByText("Cannot accommodate this request", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("The requested party cannot be accommodated safely.", {
        exact: true,
      }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("en-customer-booking-request-declined.png"),
      fullPage: true,
    });

    const processingReference = await submitAnotherRequest("en");
    await page.goto(`/en/booking-requests/${processingReference}`);
    await page.route(page.url(), async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const response = await route.fetch();
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      await route.fulfill({ response });
    });
    await page
      .getByRole("button", { name: "Withdraw pending request" })
      .click();
    await expect(page.getByText("Processing", { exact: true })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("en-customer-booking-request-processing.png"),
      fullPage: true,
    });
    await expect(page.getByText("Withdrawn", { exact: true })).toBeVisible();
    const scheduledExpiryReference = await submitAnotherRequest("en");
    await page.goto(`/en/booking-requests/${scheduledExpiryReference}`);
    await expect(page.getByText("Pending", { exact: true })).toBeVisible();
  } else if (testInfo.project.name === "worker") {
    await page.goto(`/en/booking-requests/${requestReference}`);
    await expect(
      page.getByRole("button", { name: "Withdraw pending request" }),
    ).toBeVisible();
    await ownerNotice
      .getByRole("button", { name: "Accept complete request" })
      .click();
    // The Customer stays mounted across the independent Owner action.
    await expect(page.getByRole("status")).toContainText(
      "Payment confirmation pending",
      { timeout: 15000 },
    );
    await expect(ownerNotice.getByRole("status")).toContainText(
      "Payment confirmation pending",
    );
    await expect(
      page.getByRole("button", { name: "Withdraw pending request" }),
    ).toHaveCount(0);
    await expect(ownerNotice.getByRole("button")).toHaveCount(0);
    const ownerBookingLink = {
      en: "Open confirmed booking",
      ar: "فتح الحجز المؤكد",
      ckb: "کردنەوەی حجزی پشتڕاستکراو",
    } as const;
    const locales = [
      {
        locale: "en",
        pending: "Payment confirmation pending",
        confirmed: "Booking confirmed",
        paidHeading: "Confirmed booking",
        incomplete: "Some practical access or contact details are unavailable.",
        noticePending: "Pending",
        noticeDelivered: "Delivered",
        required: "Payment Required",
        elapsed: "deadline has passed",
        quarantined: "Payment needs review",
        attention: "Support needs to review this payment",
        held: "remain held",
        paymentDeadline: "Payment deadline",
      },
      {
        locale: "ar",
        pending: "بانتظار تأكيد الدفع",
        confirmed: "تم تأكيد الحجز",
        paidHeading: "حجز مؤكد",
        incomplete: "بعض تفاصيل الوصول أو الاتصال غير متاحة.",
        noticePending: "قيد الانتظار",
        noticeDelivered: "تم التسليم",
        required: "الدفع مطلوب",
        elapsed: "انتهى موعد",
        quarantined: "الدفع يحتاج إلى مراجعة",
        attention: "يحتاج فريق الدعم إلى مراجعة هذا الدفع",
        held: "محجوزة",
        paymentDeadline: "موعد الدفع",
      },
      {
        locale: "ckb",
        pending: "چاوەڕێی پشتڕاستکردنەوەی پارەدان",
        confirmed: "حجز پشتڕاست کراوەتەوە",
        paidHeading: "حجزی پشتڕاستکراو",
        incomplete: "هەندێک وردەکاری گەیشتن یان پەیوەندی بەردەست نییە.",
        noticePending: "چاوەڕێ",
        noticeDelivered: "گەیەنرا",
        required: "پارەدان پێویستە",
        elapsed: "تێپەڕی",
        quarantined: "پارەدان پێویستی بە پێداچوونەوە هەیە",
        attention: "تیمی پشتگیری پێویستە پێداچوونەوە بە ئەم پارەدانە بکات",
        held: "گیراو دەمێننەوە",
        paymentDeadline: "کاتی کۆتایی پارەدان",
      },
    ] as const;
    async function captureViews(
      state:
        | "capture-processing"
        | "paid-confirmed"
        | "paid-confirmed-incomplete"
        | "payment-required-open"
        | "payment-required-elapsed"
        | "payment-expiry-quarantined",
      reference = requestReference,
    ) {
      for (const copy of locales) {
        // Keep the transition observers mounted: navigating an in-flight refresh
        // can terminate Wrangler's local forwarding proxy.
        const customerView = await page.context().newPage();
        const ownerView = await ownerContext.newPage();
        await customerView.goto(
          `/${copy.locale}/booking-requests/${reference}`,
        );
        await ownerView.goto(`/${copy.locale}/owner/cottages`);
        const currentOwnerNotice = ownerView.getByRole("article", {
          name: reference,
        });
        for (const surface of [customerView, ownerView]) {
          await expect(surface.locator("html")).toHaveAttribute(
            "dir",
            copy.locale === "en" ? "ltr" : "rtl",
          );
        }
        const expectedStatus =
          state === "capture-processing"
            ? copy.pending
            : state === "payment-expiry-quarantined"
              ? copy.quarantined
              : state === "paid-confirmed" ||
                  state === "paid-confirmed-incomplete"
                ? copy.confirmed
                : copy.required;
        if (
          state === "paid-confirmed" ||
          state === "paid-confirmed-incomplete"
        ) {
          await expect(
            customerView.getByRole("heading", { name: copy.paidHeading }),
          ).toBeVisible();
          await expect(
            customerView.getByRole("status").filter({
              hasText: new RegExp(
                `${copy.noticePending}|${copy.noticeDelivered}`,
              ),
            }),
          ).toBeVisible();
          await expect(customerView.getByText(exactAddress)).toBeVisible();
          await expect(customerView.getByText(customerPhone)).toBeVisible();
          await expect(customerView.getByText(ownerPhone)).toBeVisible();
          await expect(
            customerView.getByText(
              "Synthetic fixture only. Respect neighbours.",
            ),
          ).toBeVisible();
          await expect(
            customerView.getByText(bookingTermsFixture("en").body),
          ).toBeVisible();
          await expect(
            customerView.getByText("36.408333, 44.385834"),
          ).toBeVisible();
        } else {
          await expect(customerView.getByRole("status")).toContainText(
            expectedStatus,
          );
        }
        await expect(currentOwnerNotice.getByRole("status")).toContainText(
          expectedStatus,
        );
        if (
          state === "paid-confirmed" ||
          state === "paid-confirmed-incomplete"
        ) {
          await currentOwnerNotice
            .getByRole("link", { name: ownerBookingLink[copy.locale] })
            .click();
          await expect(
            ownerView.getByRole("heading", { name: copy.paidHeading }),
          ).toBeVisible();
          await expect(
            ownerView.getByRole("status").filter({
              hasText: new RegExp(
                `${copy.noticePending}|${copy.noticeDelivered}`,
              ),
            }),
          ).toBeVisible();
          await expect(ownerView.getByText(exactAddress)).toBeVisible();
          await expect(ownerView.getByText(customerPhone)).toBeVisible();
          await expect(ownerView.getByText(ownerPhone)).toBeVisible();
          await expect(
            ownerView.getByText(bookingTermsFixture("en").body),
          ).toBeVisible();
          for (const surface of [customerView, ownerView]) {
            if (state === "paid-confirmed-incomplete") {
              await expect(
                surface.getByRole("status", { name: copy.incomplete }),
              ).toBeVisible();
            }
            for (const value of [
              customerPhone,
              ownerPhone,
              "36.408333, 44.385834",
            ]) {
              await expect(surface.getByText(value, { exact: true })).toHaveCSS(
                "direction",
                "ltr",
              );
            }
            await expect(
              surface.getByText(bookingTermsFixture("en").body),
            ).toHaveCSS("direction", "ltr");
          }
        }
        if (state === "payment-required-elapsed") {
          await expect(customerView.getByRole("status")).toContainText(
            copy.elapsed,
          );
          await expect(currentOwnerNotice.getByRole("status")).toContainText(
            copy.elapsed,
          );
        }
        if (state === "payment-expiry-quarantined") {
          for (const surface of [customerView, currentOwnerNotice]) {
            await expect(surface.getByRole("status")).toContainText(
              copy.attention,
            );
            await expect(
              surface.getByText(copy.paymentDeadline, { exact: true }),
            ).toBeVisible();
            await expect(surface.getByRole("status")).toContainText(copy.held);
            await expect(surface.getByRole("button")).toHaveCount(0);
          }
          await expect(customerView.locator("body")).not.toContainText(
            "Synthetic private fixture address",
          );
          await expect(currentOwnerNotice).not.toContainText(
            /providerReference|diagnostic_reason|idempotency/i,
          );
        }
        if (state !== "paid-confirmed" && state !== "paid-confirmed-incomplete")
          await expect(currentOwnerNotice.getByRole("button")).toHaveCount(0);
        for (const viewport of [
          { name: "mobile", width: 390, height: 844 },
          { name: "desktop", width: 1440, height: 1000 },
        ]) {
          for (const [role, surface] of [
            ["customer", customerView],
            ["owner", ownerView],
          ] as const) {
            await surface.setViewportSize({
              width: viewport.width,
              height: viewport.height,
            });
            await surface.evaluate(() => document.fonts.ready);
            expect(
              await surface.evaluate(
                () =>
                  document.documentElement.scrollWidth <=
                  document.documentElement.clientWidth,
              ),
            ).toBe(true);
            await surface.screenshot({
              path: testInfo.outputPath(
                `${role}-${copy.locale}-${viewport.name}-${state}-${reference}.png`,
              ),
              fullPage: true,
            });
          }
        }
        // Drain screenshot-page requests before closing their local proxy streams.
        await Promise.all([
          customerView.waitForLoadState("networkidle"),
          ownerView.waitForLoadState("networkidle"),
        ]);
        await customerView.close();
        await ownerView.close();
      }
    }
    await captureViews("capture-processing");
    const harness = createLocalSupabaseConcurrencyHarness();
    harness.guardDisposableLocalDatabase();
    const notificationSelector = harness.runSql(
      "select pg_get_functiondef('public.list_due_booking_confirmation_notifications(integer)'::regprocedure);",
    );
    // Hold notice discovery for this tick to prove paid access before a drain.
    // Capture and expiry still run through the real Worker; restore in all cases.
    try {
      harness.runSql(`create or replace function public.list_due_booking_confirmation_notifications(target_limit integer default 50)
        returns setof jsonb language sql security definer set search_path='' as $$select null::jsonb where false$$;`);
      const scheduled = await triggerScheduled(
        baseURL,
        "/__scheduled?cron=%2A%20%2A%20%2A%20%2A%20%2A",
      );
      expect(scheduled.ok).toBe(true);
    } finally {
      harness.runSql(notificationSelector);
    }
    await expect(ownerNotice.getByRole("status")).toContainText(
      "Booking confirmed",
      { timeout: 15000 },
    );
    // The mounted pending page must refresh into the paid details automatically.
    await expect(
      page.getByRole("heading", { name: "Confirmed booking" }),
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("status")).toContainText("Pending");
    await captureViews("paid-confirmed");
    const originalPrivateDirections = JSON.parse(
      harness.runSql(
        `select to_jsonb(private_directions) from public.owner_application_cottage_profiles where id='${profile.id}';`,
      ),
    ) as string | null;
    try {
      harness.runSql(
        `update public.owner_application_cottage_profiles set private_directions=null where id='${profile.id}';`,
      );
      await captureViews("paid-confirmed-incomplete");
    } finally {
      const restoredPrivateDirections =
        originalPrivateDirections === null
          ? "null"
          : `'${originalPrivateDirections.replaceAll("'", "''")}'`;
      harness.runSql(
        `update public.owner_application_cottage_profiles set private_directions=${restoredPrivateDirections} where id='${profile.id}';`,
      );
    }
    const paidIdentity = () =>
      JSON.parse(
        harness.runSql(
          `select jsonb_build_object(
            'bookingRequestId',requests.id,
            'bookingReference',commitments.commitment_reference,
            'receiptId',receipts.id
          )
          from public.booking_requests requests
          join public.booking_confirmations confirmations on confirmations.booking_request_id=requests.id
          join public.booking_receipts receipts on receipts.booking_confirmation_id=confirmations.id and receipts.recipient_role='customer'
          join public.cottage_booking_period_commitments commitments on commitments.id=confirmations.booking_period_commitment_id
          where requests.booking_request_reference='${requestReference}';`,
        ),
      );
    const identityBeforeRetry = paidIdentity();
    const noticeCandidate = JSON.parse(
      harness.runSql(`set role service_role;
        select candidate from public.list_due_booking_confirmation_notifications(10) candidate
        where candidate->>'receiptId'='${identityBeforeRetry.receiptId}';`),
    );
    const noticePayload = JSON.stringify(
      paidConfirmationNotice(noticeCandidate),
    ).replaceAll("'", "''");
    const failedNotice = JSON.parse(
      harness.runSql(`set role service_role;
        select public.ensure_booking_confirmation_notification_work(
          '${identityBeforeRetry.receiptId}','${noticeCandidate.locale}',
          'paid-confirmation-v1','${noticePayload}'::jsonb
        );
        with leased as (
          select public.lease_booking_confirmation_notification_work('${identityBeforeRetry.receiptId}') result
        )
        select public.record_booking_confirmation_notification_failure(
          '${identityBeforeRetry.receiptId}',
          (result->>'leaseGeneration')::bigint,
          (result->>'leaseToken')::uuid,
          'failed'
        ) from leased;`),
    );
    expect(failedNotice.status).toBe("retryable");
    await page.reload();
    const paidDetails = page.getByRole("region", {
      name: "Confirmed booking",
    });
    await expect(paidDetails.getByRole("status")).toContainText(
      "Delivery failed",
    );
    await paidDetails
      .getByRole("button", { name: "Retry confirmation notice" })
      .click();
    await expect(paidDetails.getByRole("status")).toHaveText("Pending");
    await expect(
      paidDetails.getByRole("button", { name: "Retry confirmation notice" }),
    ).toHaveCount(0);
    expect(paidIdentity()).toEqual(identityBeforeRetry);
    expect((await triggerScheduled(baseURL, "/__scheduled")).ok).toBe(true);
    await page.goto(`/en/booking-requests/${requestReference}`);
    await expect(
      page.getByRole("heading", { name: "Confirmed booking" }),
    ).toBeVisible();
    await expect(page.getByRole("status")).toContainText("Delivered");
    await page.getByRole("link", { name: "Booking History" }).click();
    await expect(
      page.getByRole("heading", { name: "Booking History" }),
    ).toBeVisible();
    const customerHistoryLink = page.locator(
      `a[href="/en/booking-requests/${requestReference}"]`,
    );
    await expect(customerHistoryLink).toContainText(
      identityBeforeRetry.bookingReference,
    );
    await customerHistoryLink.click();
    await expect(
      page.getByRole("region", { name: "Confirmed booking" }),
    ).toContainText(identityBeforeRetry.bookingReference);
    await expect(page.getByText(exactAddress)).toBeVisible();
    await ownerPage.goto(`/en/owner/booking-requests/${requestReference}`);
    await expect(
      ownerPage.getByRole("heading", { name: "Confirmed booking" }),
    ).toBeVisible();
    await expect(ownerPage.getByRole("status")).toContainText("Delivered");
    await ownerPage.getByRole("link", { name: "Booking History" }).click();
    const ownerHistoryLink = ownerPage.locator(
      `a[href="/en/owner/booking-requests/${requestReference}"]`,
    );
    await expect(ownerHistoryLink).toContainText(
      identityBeforeRetry.bookingReference,
    );
    await ownerHistoryLink.click();
    await expect(ownerPage.getByText(exactAddress)).toBeVisible();

    // A second, distinct Shift preserves the successful journey above.
    query.set("selection", `${requestedDay}:shift:${shifts[1].position}`);
    const failureReference = await submitAnotherRequest("en");
    expect(failureReference).not.toBe(requestReference);
    await page.goto(`/en/booking-requests/${failureReference}`);
    await ownerPage.goto("/en/owner/cottages");
    const failureNotice = ownerPage.getByRole("article", {
      name: failureReference,
    });
    await failureNotice
      .getByRole("button", { name: "Accept complete request" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Payment confirmation pending",
      { timeout: 15000 },
    );
    await expect(failureNotice.getByRole("status")).toContainText(
      "Payment confirmation pending",
    );

    const failureId = harness.runSql(
      paymentEvidenceSql +
        `select id from public.booking_requests where booking_request_reference='${failureReference}';`,
    );
    expect(failureId).toMatch(/^[0-9a-f-]{36}$/);
    const observeFailure = () =>
      JSON.parse(
        harness.runSql(
          paymentEvidenceSql +
            `select jsonb_build_object(
      'work',(select to_jsonb(work) from public.booking_request_capture_work work where booking_request_id='${failureId}'),
      'provider',(select pg_temp.payment_fixture_operation_json(operation) from public.payment_provider_operations operation join public.booking_request_capture_work work on work.payment_lifecycle_id=operation.payment_lifecycle_id where work.booking_request_id='${failureId}' and operation.operation_kind='capture'),
      'notifications',(select count(*) from public.booking_request_status_notifications where booking_request_id='${failureId}' and status='payment-required'),
      'hold',(select to_jsonb(commitment) from public.cottage_booking_period_commitments commitment join public.booking_requests request on request.booking_period_commitment_id=commitment.id where request.id='${failureId}'),
      'occupancies',(select jsonb_agg(to_jsonb(occupancy) order by shift_id,service_day) from public.cottage_booking_period_occupancies occupancy join public.booking_requests request on request.booking_period_commitment_id=occupancy.booking_period_commitment_id where request.id='${failureId}'),
      'intentActive',(select intent_dedupe_active from public.booking_request_submission_attempts where booking_request_id='${failureId}'),
      'confirmations',(select count(*) from public.booking_confirmations where booking_request_id='${failureId}')
    );`,
        ),
      );
    const held = observeFailure();
    harness.runSql(
      paymentEvidenceSql +
        `set role service_role;
      with leased as (select public.lease_booking_request_capture_work('${failureId}',
        '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb) result)
      select pg_temp.capture_execute(result->'permit','failed') from leased;
      reset role;
      update public.booking_request_capture_work set lease_expires_at=clock_timestamp() where booking_request_id='${failureId}';`,
    );
    expect((await triggerScheduled(baseURL, "/__scheduled")).ok).toBe(true);
    // Both existing pages must refresh from real Worker-persisted failure evidence.
    await expect(page.getByRole("status")).toContainText("Payment Required", {
      timeout: 15000,
    });
    await expect(failureNotice.getByRole("status")).toContainText(
      "Payment Required",
    );
    await expect(page.getByRole("status")).toContainText("remain held");
    await expect(failureNotice.getByRole("status")).toContainText(
      "not confirmed",
    );
    await expect(page.getByText("Owner response deadline")).toHaveCount(0);
    await expect(page.getByText("Payment deadline")).toBeVisible();
    const terminal = observeFailure();
    expect(terminal.work.state).toBe("payment_required");
    expect(
      Date.parse(terminal.work.payment_required_deadline) -
        Date.parse(terminal.work.payment_required_recorded_at),
    ).toBe(1_200_000);
    expect(terminal.provider.original_outcome).toBe("failed");
    expect(terminal.provider.current_outcome).toBe("failed");
    expect(terminal.provider.movement_reference).toBeNull();
    expect(terminal.provider.physical_execution_count).toBe(1);
    expect(terminal.notifications).toBe(1);
    expect(terminal.confirmations).toBe(0);
    expect(terminal.hold).toEqual(held.hold);
    expect(terminal.occupancies).toEqual(held.occupancies);
    expect(terminal.intentActive).toBe(true);
    // The live owner list has refreshed through both capture outcomes. Paid
    // access details are fetched on explicit navigation, not by list prefetch.
    expect(ownerPaidDetailPrefetches).toEqual([]);
    await captureViews("payment-required-open", failureReference);
    expect((await triggerScheduled(baseURL, "/__scheduled")).ok).toBe(true);
    expect(observeFailure()).toEqual(terminal);

    const windowDefinition = harness.runSql(
      paymentEvidenceSql +
        "select pg_get_functiondef('public.booking_request_payment_required_window(public.booking_requests)'::regprocedure);",
    );
    expect(windowDefinition).toContain("clock_timestamp()");
    try {
      // Pin only database read time at the exact boundary; immutable stored timestamps stay untouched.
      harness.runSql(
        paymentEvidenceSql +
          windowDefinition.replace(
            "clock_timestamp()",
            "work.payment_required_deadline",
          ),
      );
      await expect(page.getByRole("status")).toContainText(
        "deadline has passed",
        {
          timeout: 15000,
        },
      );
      await expect(failureNotice.getByRole("status")).toContainText(
        "deadline has passed",
      );
      await captureViews("payment-required-elapsed", failureReference);
      expect(observeFailure()).toEqual(terminal);
    } finally {
      harness.runSql(paymentEvidenceSql + windowDefinition);
    }
    // Authenticate a different Customer through the real public client before exercising the command.
    const otherCustomer = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const otherPhone = "+9647520000000";
    const otp = await otherCustomer.auth.signInWithOtp({ phone: otherPhone });
    if (otp.error) throw otp.error;
    const verified = await otherCustomer.auth.verifyOtp({
      phone: otherPhone,
      token: "123456",
      type: "sms",
    });
    if (verified.error) throw verified.error;
    const role = await otherCustomer.rpc("claim_marketplace_role", {
      requested_role: "customer",
    });
    if (role.error) throw role.error;
    const deniedPaidAccess = await otherCustomer.rpc(
      "get_confirmed_booking_access",
      { target_reference: requestReference },
    );
    expect(deniedPaidAccess.error).toBeNull();
    expect(deniedPaidAccess.data).toBeNull();
    expect(JSON.stringify(deniedPaidAccess.data)).not.toContain(exactAddress);
    expect(JSON.stringify(deniedPaidAccess.data)).not.toContain(ownerPhone);
    const recoveryGraph = () =>
      harness.runSql(
        paymentEvidenceSql +
          `select jsonb_build_object(
      'attempts',(select coalesce(jsonb_agg(to_jsonb(attempts) order by id),'[]') from public.booking_request_payment_recovery_attempts attempts where booking_request_id='${failureId}'),
      'operations',(select coalesce(jsonb_agg(to_jsonb(operations) order by operations.id),'[]') from public.booking_request_payment_recovery_operations operations join public.booking_request_payment_recovery_attempts attempts on attempts.id=operations.recovery_attempt_id where attempts.booking_request_id='${failureId}'),
      'ledger',(select jsonb_agg(pg_temp.payment_fixture_operation_json(ledger) order by ledger.id) from public.payment_provider_operations ledger),
      'requests',(select jsonb_agg(to_jsonb(requests) order by id) from public.booking_requests requests),
      'snapshots',(select jsonb_agg(to_jsonb(snapshots) order by id) from public.booking_snapshots snapshots),
      'claims',(select jsonb_agg(to_jsonb(claims) order by id) from public.booking_request_authorization_claims claims),
      'submissions',(select jsonb_agg(to_jsonb(submissions) order by id) from public.booking_request_submission_attempts submissions),
      'receipts',(select jsonb_agg(to_jsonb(receipts) order by id) from public.booking_receipts receipts),
      'notifications',(select jsonb_agg(to_jsonb(notifications) order by id) from public.booking_request_status_notifications notifications),
      'inventory',(select jsonb_agg(to_jsonb(inventory) order by id) from public.cottage_inventory_commitments inventory),
      'history',(select coalesce(jsonb_agg(to_jsonb(history) order by sequence),'[]') from public.booking_request_payment_history history where booking_request_id='${failureId}'));`,
      );
    const beforeDenial = recoveryGraph();
    const denied = await otherCustomer.rpc(
      "claim_customer_booking_request_payment_recovery",
      {
        target_booking_request_id: failureId,
        target_command_key: "81000000-0000-4000-8000-000000001003",
        target_replacement_method: "simulated-replacement",
      },
    );
    expect(denied.error?.code).toBe("RC404");
    expect(recoveryGraph()).toEqual(beforeDenial);
    expect(observeFailure()).toEqual(terminal);
    const confirmationDefinition = harness.runSql(
      paymentEvidenceSql +
        "select pg_get_functiondef('public.finalize_booking_request_confirmation(uuid,jsonb)'::regprocedure);",
    );
    const recoveryFinalizationDefinition = harness.runSql(
      paymentEvidenceSql +
        "select pg_get_functiondef('public.finalize_booking_request_payment_required_expiry(uuid)'::regprocedure);",
    );
    const recoveryFactsDefinition = harness.runSql(
      paymentEvidenceSql +
        "select pg_get_functiondef('public.get_booking_request_payment_facts(uuid)'::regprocedure);",
    );
    expect(recoveryFactsDefinition).toContain("clock_timestamp()");
    try {
      // Interrupt confirmation after the real replacement-payment action records pre-deadline success.
      harness.runSql(
        paymentEvidenceSql +
          confirmationDefinition.replace(
            "begin\n",
            "begin\n  raise exception 'Injected confirmation delivery interruption';\n",
          ),
      );
      await page.goto(`/en/booking-requests/${failureReference}`);
      await page
        .getByRole("button", {
          name: "Use simulated replacement payment",
          exact: true,
        })
        .click();
      // Refresh can remount the status view and clear its local action error.
      // Observe the durable interrupted outcome and the authoritative visible state.
      await expect
        .poll(() =>
          harness.runSql(
            paymentEvidenceSql +
              `select count(*) from public.booking_request_payment_recovery_operations operations join public.booking_request_payment_recovery_attempts attempts on attempts.id=operations.recovery_attempt_id join public.booking_request_capture_work work on work.booking_request_id=attempts.booking_request_id where attempts.booking_request_id='${failureId}' and operations.step='replacement-capture' and operations.outcome='succeeded' and operations.authoritative_outcome_at < work.payment_required_deadline;`,
          ),
        )
        .toBe("1");
      await expect(
        page.getByText(
          "Your replacement payment is being checked. Do not start another attempt.",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(page.getByRole("status")).toContainText("not confirmed");
      await expect(page.getByRole("status")).toContainText("remain held");
      expect(observeFailure().confirmations).toBe(0);
      harness.runSql(
        paymentEvidenceSql +
          `create function public.confirmation_expiry_now() returns timestamptz language sql volatile security definer set search_path='' as $$select payment_required_deadline from public.booking_request_capture_work where booking_request_id='${failureId}'$$;`,
      );
      for (const definition of [
        windowDefinition,
        recoveryFinalizationDefinition,
        recoveryFactsDefinition,
        confirmationDefinition,
      ])
        harness.runSql(
          paymentEvidenceSql +
            definition.replaceAll(
              "clock_timestamp()",
              "public.confirmation_expiry_now()",
            ),
        );
      const recoveryFacts = bookingRequestPaymentFactsFrom(
        JSON.parse(
          harness.runSql(
            paymentEvidenceSql +
              `set role service_role;select public.get_booking_request_payment_facts('${failureId}');`,
          ),
        ),
      );
      expect(recoveryFacts.deadline).not.toBeNull();
      expect(recoveryFacts.observedAt).toBe(recoveryFacts.deadline);
      expect(recoveryFacts.attempts).toHaveLength(1);
      expect(recoveryFacts.attempts[0]?.state).toBe("succeeded");
      expect(selectPaymentRequiredExpiry(recoveryFacts)).toEqual({
        status: "confirm",
        attemptId: recoveryFacts.attempts[0]?.id,
      });
      // Application expiry selects confirmation; the integrity finalizer must
      // refuse expiry without adding the retired selector's bookkeeping row.
      const beforeExpiryRefusal = recoveryGraph();
      const heldBeforeExpiryRefusal = observeFailure();
      const expiryResult = JSON.parse(
        harness.runSql(
          paymentEvidenceSql +
            `set role service_role;select public.finalize_booking_request_payment_required_expiry('${failureId}');`,
        ),
      );
      expect(expiryResult.status).toBe("processing");
      expect(recoveryGraph()).toEqual(beforeExpiryRefusal);
      expect(observeFailure()).toEqual(heldBeforeExpiryRefusal);
      expect((await triggerScheduled(baseURL, "/__scheduled")).ok).toBe(true);
      await expect(
        page.getByRole("heading", { name: "Confirmed booking" }),
      ).toBeVisible({ timeout: 15000 });
      await expect(failureNotice.getByRole("status")).toContainText(
        "Booking confirmed",
        { timeout: 15000 },
      );
      expect(
        harness.runSql(
          paymentEvidenceSql +
            `select count(*) from public.booking_request_payment_required_expiry_work where booking_request_id='${failureId}';`,
        ),
      ).toBe("0");
      expect(
        harness.runSql(
          paymentEvidenceSql +
            `select count(*) from public.booking_request_payment_required_expiry_operations where booking_request_id='${failureId}';`,
        ),
      ).toBe("0");
    } finally {
      for (const definition of [
        windowDefinition,
        recoveryFinalizationDefinition,
        recoveryFactsDefinition,
        confirmationDefinition,
      ])
        harness.runSql(paymentEvidenceSql + definition);
      harness.runSql(
        paymentEvidenceSql +
          "drop function if exists public.confirmation_expiry_now();",
      );
    }
    const recovered = observeFailure();
    expect(recovered.work).toEqual(terminal.work);
    expect(recovered.provider).toEqual(terminal.provider);
    expect(recovered.occupancies).toEqual(terminal.occupancies);
    expect(recovered.hold.id).toBe(terminal.hold.id);
    expect(recovered.hold.status).toBe("confirmed_booking");
    expect(recovered.confirmations).toBe(1);
    expect(
      harness.runSql(
        paymentEvidenceSql +
          `select count(*)||':'||sum((select effect.physical_execution_count from public.simulated_payment_effects effect where effect.operation_id=ledger.id)) from public.payment_provider_operations ledger join public.booking_request_payment_recovery_attempts attempts on attempts.id=ledger.recovery_attempt_id where attempts.booking_request_id='${failureId}';`,
      ),
    ).toBe("3:3");
    await captureViews("paid-confirmed", failureReference);

    // A separate future Shift proves unpaid expiry without changing either confirmed booking above.
    const expiryDay = serviceDay(offset + 1);
    const opened = await fixtureOwner.rpc(
      "set_cottage_inventory_availability",
      {
        target_profile_id: profile.id,
        target_schedule_revision_id: profile.current_shift_schedule_id,
        target_service_day: expiryDay,
        requested_states: [
          ...shifts.map((item) => ({
            unitId: item.id,
            unitKind: "shift",
            state: "open",
          })),
          {
            unitId: schedule.full_day_bundle_id,
            unitKind: "full_day_bundle",
            state: "open",
          },
        ],
      },
    );
    if (opened.error) throw opened.error;
    query.set("from", expiryDay);
    query.set("to", expiryDay);
    query.set("selection", `${expiryDay}:shift:${shift.position}`);
    const expiryReference = await submitAnotherRequest("en");
    await page.goto(`/en/booking-requests/${expiryReference}`);
    await ownerPage.goto("/en/owner/cottages");
    const expiryNotice = ownerPage.getByRole("article", {
      name: expiryReference,
    });
    await expiryNotice
      .getByRole("button", { name: "Accept complete request" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Payment confirmation pending",
      { timeout: 15000 },
    );
    const expiryId = harness.runSql(
      paymentEvidenceSql +
        `select id from public.booking_requests where booking_request_reference='${expiryReference}';`,
    );
    expect(expiryId).toMatch(/^[0-9a-f-]{36}$/);
    const identity =
      '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}';
    harness.runSql(
      paymentEvidenceSql +
        `set role service_role;
      with leased as (select public.lease_booking_request_capture_work('${expiryId}','${identity}') result)
      select pg_temp.capture_execute(result->'permit','failed') from leased;
      reset role;update public.booking_request_capture_work set lease_expires_at=clock_timestamp() where booking_request_id='${expiryId}';`,
    );
    expect((await triggerScheduled(baseURL, "/__scheduled")).ok).toBe(true);
    await expect(page.getByRole("status")).toContainText("Payment Required", {
      timeout: 15000,
    });
    const expiryGraph = async () => {
      const input = {
        target_profile_id: profile.id,
        target_schedule_revision_id: profile.current_shift_schedule_id,
        target_service_day: expiryDay,
      };
      const [availability, calendar] = await Promise.all([
        fixtureOwner.rpc(
          "resolve_cottage_inventory_public_availability",
          input,
        ),
        fixtureOwner.rpc("resolve_cottage_inventory_owner_calendar", input),
      ]);
      if (availability.error) throw availability.error;
      if (calendar.error) throw calendar.error;
      return {
        availability: availability.data,
        calendar: calendar.data,
        ...JSON.parse(
          harness.runSql(
            paymentEvidenceSql +
              `select jsonb_build_object(
      'request',(select to_jsonb(r) from public.booking_requests r where id='${expiryId}'),
      'capture',(select to_jsonb(w) from public.booking_request_capture_work w where booking_request_id='${expiryId}'),
      'expiry',(select to_jsonb(w) from public.booking_request_payment_required_expiry_work w where booking_request_id='${expiryId}'),
      'notices',(select coalesce(jsonb_agg(to_jsonb(n) order by id),'[]') from public.booking_request_status_notifications n where booking_request_id='${expiryId}' and status='expired'),
      'confirmations',(select count(*) from public.booking_confirmations where booking_request_id='${expiryId}'),
      'ledger',(select jsonb_agg(pg_temp.payment_fixture_operation_json(o) order by o.id) from public.payment_provider_operations o join public.booking_request_capture_work w on w.authorization_claim_id=o.claim_id where w.booking_request_id='${expiryId}'),
      'hold',(select c.status from public.cottage_booking_period_commitments c join public.booking_requests r on r.booking_period_commitment_id=c.id where r.id='${expiryId}'),
      'occupancies',(select jsonb_agg(to_jsonb(o) order by shift_id,service_day) from public.cottage_booking_period_occupancies o join public.booking_requests r on r.booking_period_commitment_id=o.booking_period_commitment_id where r.id='${expiryId}'));`,
          ),
        ),
      };
    };
    const beforeExpiry = await expiryGraph();
    const signatures = [
      "booking_request_payment_required_window(public.booking_requests)",
      "claim_due_booking_request_payment_required_expiries(integer,jsonb)",
      "prepare_booking_request_payment_required_expiry(uuid,jsonb,jsonb)",
      "persist_simulated_payment_effect(jsonb,jsonb)",
      "resolve_simulated_payment_effect(jsonb,text,jsonb)",
      "seal_simulated_payment_absence(jsonb)",
      "validate_payment_provider_observation(jsonb,uuid)",
      "accept_payment_provider_observation(uuid,jsonb)",
      "admit_booking_request_payment_required_expiry(jsonb)",
      "reload_booking_request_payment_operation(jsonb,text,text)",
      "finalize_booking_request_payment_required_expiry(uuid)",
      "booking_request_payment_required_expiry_completed(uuid)",
      "get_booking_request_payment_facts(uuid)",
    ];
    const definitions = signatures.map((signature) =>
      harness.runSql(
        paymentEvidenceSql +
          `select pg_get_functiondef('public.${signature}'::regprocedure);`,
      ),
    );
    const clocked = definitions.map((definition) =>
      definition.replaceAll(
        "clock_timestamp()",
        "public.live_payment_expiry_now()",
      ),
    );
    try {
      harness.runSql(
        paymentEvidenceSql +
          `create function public.live_payment_expiry_now() returns timestamptz language sql volatile security definer set search_path='' as $$select payment_required_deadline from public.booking_request_capture_work where booking_request_id='${expiryId}'$$;`,
      );
      for (const definition of clocked)
        harness.runSql(paymentEvidenceSql + definition);
      // Both pages stay mounted across the real fixed deadline and later scheduled observations.
      await expect(page.getByRole("status")).toContainText(
        "deadline has passed",
        { timeout: 15000 },
      );
      await expect(expiryNotice.getByRole("status")).toContainText(
        "deadline has passed",
        { timeout: 15000 },
      );
      await captureViews("payment-required-elapsed", expiryReference);
      harness.runSql(
        paymentEvidenceSql +
          `set role service_role;select pg_temp.expiry_execute(pg_temp.expiry_prepare('${expiryId}','${identity}',jsonb_build_object('action','release','authorizationLifecycleId',public.get_booking_request_payment_facts('${expiryId}')->>'originalLifecycleId','recoveryOperationId',null))->'permit','indeterminate','expiry-release-indeterminate');`,
      );
      // Model a provider which still cannot establish the existing release outcome.
      const unresolvedQuery = clocked[4].replace(
        "  if jsonb_typeof(target_result#>'{evidence,occurredAt}')",
        "  return winner.result;\n  if jsonb_typeof(target_result#>'{evidence,occurredAt}')",
      );
      expect(unresolvedQuery).not.toBe(clocked[4]);
      harness.runSql(paymentEvidenceSql + unresolvedQuery);
      expect((await triggerScheduled(baseURL, "/__scheduled")).ok).toBe(true);
      await expect(page.getByRole("status")).toContainText(
        "Support needs to review this payment",
        { timeout: 15000 },
      );
      await expect(expiryNotice.getByRole("status")).toContainText(
        "Support needs to review this payment",
        { timeout: 15000 },
      );
      await expect(page.getByRole("button")).toHaveCount(0);
      const attention = await expiryGraph();
      expect(attention.expiry.state).toBe("quarantined");
      expect(attention.request.status).toBe("accepted");
      expect(attention.capture).toEqual(beforeExpiry.capture);
      expect(attention.occupancies).toEqual(beforeExpiry.occupancies);
      expect(attention.hold).toBe("pending_hold");
      expect(attention.confirmations).toBe(0);
      expect(attention.notices).toHaveLength(0);
      expect(
        attention.availability.units.find(
          (unit: { id: string }) => unit.id === shift.id,
        ).available,
      ).toBe(false);
      expect(
        attention.calendar.units.find(
          (unit: { id: string }) => unit.id === shift.id,
        ).calendarState,
      ).toBe("pending_hold");
      await captureViews("payment-expiry-quarantined", expiryReference);
      // The actual scheduled handler cannot restart an uncertain release after quarantine.
      harness.runSql(paymentEvidenceSql + clocked[4]);
      expect((await triggerScheduled(baseURL, "/__scheduled")).ok).toBe(true);
      await expect(page.getByRole("status")).toContainText(
        "Payment needs review",
      );
      expect(await expiryGraph()).toEqual(attention);
      await captureViews("payment-expiry-quarantined", expiryReference);
      expect(observeFailure()).toEqual(recovered);
    } finally {
      for (const definition of definitions)
        harness.runSql(paymentEvidenceSql + definition);
      harness.runSql(
        paymentEvidenceSql +
          "drop function if exists public.live_payment_expiry_now();",
      );
    }
    await otherCustomer.auth.signOut();
  }
  await ownerContext.close();
});
