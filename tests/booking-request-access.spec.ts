import { writeFile } from "node:fs/promises";
import { observeRecordHeading } from "./fixtures/record-heading";
import { accessMessages } from "../src/i18n/access-messages";
import { triggerScheduled } from "./fixtures/trigger-scheduled";
import { openHeaderPanel } from "./fixtures/site-header";

// SQL arrangement mirrors admission, isolated effect, and explicit recording.
const paymentEvidenceSql =
  "-- BEGIN PAYMENT EVIDENCE FIXTURE\n" +
  readFileSync("supabase/fixtures/payment-evidence.sql", "utf8") +
  "\n-- END PAYMENT EVIDENCE FIXTURE\n";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import * as OTPAuth from "otpauth";
import { selectPaymentRequiredExpiry } from "../src/booking-request/booking-request-payment-required-expiry";
import { bookingRequestPaymentFactsFrom } from "../src/booking-request/supabase-booking-request-payment-observation";
import { bookingTermsFixture } from "../src/booking-request/booking-terms-fixture";
import { paidConfirmationNotice } from "../src/notification/paid-confirmation-notice";
import { expect, test, type Page, type Route } from "@playwright/test";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";

type AccessBrowserFixture = {
  bookingCottageName: string;
  bookingOwnerPhone: string;
  exactAddress: string;
  customerPhone: string;
  secondaryCustomerPhone: string;
};

const { accessBrowserFixture } = createRequire(import.meta.url)(
  "../scripts/lib/access-browser-fixtures.mjs",
) as {
  accessBrowserFixture(
    project: string,
    owner: "booking-request",
  ): AccessBrowserFixture;
};

const { createLocalSupabaseConcurrencyHarness } = createRequire(
  import.meta.url,
)("../scripts/local-supabase-concurrency-harness.mjs") as {
  createLocalSupabaseConcurrencyHarness(): {
    guardDisposableLocalDatabase(): void;
    runSql(sql: string): string;
  };
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
  if (testInfo.project.name === "worker") {
    // Hosted CI peaked at a rounded 1.5m on Worker; 180s leaves about 90s of headroom.
    test.setTimeout(180_000);
  }
  const target = new URL(process.env.SUPABASE_URL ?? "invalid:");
  if (
    process.env.APP_ENVIRONMENT !== "test" ||
    target.protocol !== "http:" ||
    target.hostname !== "127.0.0.1"
  ) {
    throw new Error("Booking Request journey requires isolated local fixtures");
  }
  const bookingFixture = accessBrowserFixture(
    testInfo.project.name,
    "booking-request",
  );
  const ownerPhone = bookingFixture.bookingOwnerPhone;
  const cottageName = bookingFixture.bookingCottageName;
  const exactAddress = bookingFixture.exactAddress;
  const customerPhone = bookingFixture.customerPhone;
  const offset = { mobile: 4, desktop: 5, worker: 6 }[testInfo.project.name];
  if (!customerPhone || !offset) {
    throw new Error("Booking fixture is unmapped");
  }
  // A failed attempt leaves real holds on its service days, so each retry takes the next pair.
  const dayOffset = offset + 2 * testInfo.retry;

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
  const { data: publications, error: publicationError } =
    await fixtureOwner.rpc("get_current_cottage_publication", {
      target_profile_id: profile.id,
      target_locale: "en",
    });
  expect(publicationError).toBeNull();
  expect(publications).toHaveLength(1);
  expect(Array.isArray(publications[0].media_ids)).toBe(true);
  expect(publications[0].media_ids.length).toBeGreaterThan(0);
  const expectedCoverSrc = `/api/cottage-media/${publications[0].media_ids[0]}`;
  const observeCoverIdentity = async (
    surface: Page,
    locale: "en" | "ar" | "ckb",
    reference: string,
  ) => {
    const configuredViewport = surface.viewportSize();
    if (!configuredViewport)
      throw new Error("Cover observation requires a configured viewport");
    const identity = surface
      .getByRole("main")
      .locator(".booking-cottage-identity");
    await expect(identity).toHaveCount(1);
    const image = identity.locator("img");
    await expect(image).toHaveCount(1);
    await expect(image).toHaveJSProperty(
      "src",
      new URL(expectedCoverSrc, surface.url()).href,
    );
    await expect(image).toHaveAttribute("alt", "");
    await expect
      .poll(() =>
        image.evaluate((element) => {
          const image = element as HTMLImageElement;
          return image.complete && image.naturalWidth > 0;
        }),
      )
      .toBe(true);
    await expect(
      surface.getByRole("main").getByText(cottageName, { exact: true }),
    ).toHaveCount(1);
    await expect(
      identity.getByText(cottageName, { exact: true }),
    ).toBeVisible();
    await expect(identity.locator("bdi")).toHaveText(reference);
    await expect(identity.locator("a, button")).toHaveCount(0);
    await expect(surface.locator("html")).toHaveAttribute(
      "dir",
      locale === "en" ? "ltr" : "rtl",
    );
    await surface.evaluate(() => document.fonts.ready);
    await expect
      .poll(() =>
        identity.evaluate((row, viewport) => {
          const image = row.querySelector("img")!;
          const text = row.querySelector(
            ".booking-cottage-identity-text, .confirmed-booking-identity-text",
          )!;
          const imageBox = image.getBoundingClientRect();
          const textBox = text.getBoundingClientRect();
          const rtl = getComputedStyle(row).direction === "rtl";
          const side = viewport.width <= 640 ? 64 : 80;
          const boxes = [row, image, text, ...text.children].map((element) =>
            element.getBoundingClientRect(),
          );
          return {
            photoSize:
              Math.abs(imageBox.width - side) < 1 &&
              Math.abs(imageBox.height - side) < 1,
            inlineStart: rtl
              ? imageBox.left >= textBox.right
              : imageBox.right <= textBox.left,
            centered:
              Math.abs(
                imageBox.top +
                  imageBox.height / 2 -
                  (textBox.top + textBox.height / 2),
              ) < 1,
            completeIdentity: text.scrollWidth <= text.clientWidth + 1,
            fitsViewport:
              innerWidth <= viewport.width + 1 &&
              document.documentElement.scrollWidth <= viewport.width + 1 &&
              boxes.every(
                (box) => box.left >= -1 && box.right <= viewport.width + 1,
              ),
          };
        }, configuredViewport),
      )
      .toEqual({
        photoSize: true,
        inlineStart: true,
        centered: true,
        completeIdentity: true,
        fitsViewport: true,
      });
  };
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
  const requestedDay = serviceDay(dayOffset);
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
  const harness = createLocalSupabaseConcurrencyHarness();
  harness.guardDisposableLocalDatabase();
  // A retry reuses both phones inside the provider's OTP rate limit: age their
  // last-code stamps instead of waiting for or weakening it.
  expect(
    harness.runSql(`with aged as (
      update auth.users set confirmation_sent_at = now() - interval '1 hour'
      where phone in ('${customerPhone.slice(1)}', '${ownerPhone.slice(1)}')
      returning id
    ) select count(*) from aged;`),
  ).toBe("2");

  const slug = `cottage-${profile.id.replaceAll("-", "")}`;
  const query = new URLSearchParams({
    from: requestedDay,
    to: requestedDay,
    guests: "4",
    selection: `${requestedDay}:shift:${shift.position}`,
  });
  expect(shifts.map((item) => item.position)).toEqual([1, 2]);
  const staleQuery = new URLSearchParams(query);
  staleQuery.set("selection", `${requestedDay}:shift:3`);
  await page.goto(`/en/cottages/${slug}?${staleQuery.toString()}`);
  const missingPeriod = page.getByText(
    "A selected period is no longer offered. Clear that day's selection and choose again.",
    { exact: true },
  );
  await expect(missingPeriod).toBeVisible();
  const periodClearControl = page
    .getByRole("complementary")
    .getByRole("button", { name: "Clear selection", exact: true });
  await expect(periodClearControl).toHaveCount(1);
  await periodClearControl.focus();
  await expect(periodClearControl).toBeFocused();
  await periodClearControl.press("Enter");
  await expect(page).toHaveURL(
    (url) => url.searchParams.getAll("selection").length === 0,
  );
  await expect(periodClearControl).toHaveCount(0);
  await expect(missingPeriod).toHaveCount(0);
  await expect(
    page
      .getByRole("complementary")
      .getByRole("button", { name: "Get exact quote", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("complementary").getByRole("heading", {
      name: "Choose your Booking Period",
      exact: true,
    }),
  ).toBeFocused();
  await page.goto(`/en/cottages/${slug}?${query.toString()}`);
  expect(new URL(page.url()).searchParams.getAll("selection")).toEqual([
    `${requestedDay}:shift:${shift.position}`,
  ]);
  const discoveryCopy = {
    en: {
      from: "From Service Day",
      to: "To Service Day",
      guests: "Guests",
      search: "Search available cottages",
      view: "View cottage",
      quote: "Get exact quote",
      title: "Your exact Booking Quote",
    },
    ar: {
      from: "من تاريخ",
      to: "إلى تاريخ",
      guests: "عدد الضيوف",
      search: "ابحث عن البيوت المتاحة",
      view: "اعرض البيت",
      quote: "عرض السعر الدقيق",
      title: "عرض سعر الحجز الدقيق",
    },
    ckb: {
      from: "لە بەرواری",
      to: "تا بەرواری",
      guests: "ژمارەی میوان",
      search: "گەڕان بۆ کۆتێجی بەردەست",
      view: "کۆتێجەکە ببینە",
      quote: "پێشنیاری نرخی ورد",
      title: "پێشنیاری نرخی وردی حجزکردن",
    },
  };
  // The visitor's own click path, so the quote page is the one discovery leads to.
  const reachQuoteFromDiscovery = async (locale: "en" | "ar" | "ckb") => {
    const copy = discoveryCopy[locale];
    const { data: publicProfile, error: publicProfileError } =
      await fixtureOwner.rpc("get_public_cottage_profile", {
        target_locale: locale,
        target_slug: slug,
        requested_search: {
          from: requestedDay,
          to: requestedDay,
          guests: 4,
          selections: [],
          amenities: [],
        },
      });
    if (publicProfileError) throw publicProfileError;
    const unit = (
      publicProfile.inventory as {
        serviceDay: string;
        kind: string;
        position?: number;
        name: string;
        available: boolean;
      }[]
    ).find(
      (item) =>
        item.serviceDay === requestedDay &&
        item.kind === "shift" &&
        item.position === shift.position,
    );
    if (!unit) throw new Error("Published shift is missing from the cottage");
    expect(unit.available).toBe(true);

    await page.goto(`/${locale}`);
    await page.getByLabel(copy.from, { exact: true }).fill(requestedDay);
    await page.getByLabel(copy.to, { exact: true }).fill(requestedDay);
    await page.getByLabel(copy.guests, { exact: true }).fill("4");
    await page.getByRole("button", { name: copy.search }).click();
    await expect(page).toHaveURL(
      (url) => url.pathname === `/${locale}/results` && url.search !== "",
    );
    const card = page.locator("article").filter({
      has: page.locator(`a[href^="/${locale}/cottages/${slug}?"]`),
    });
    await expect(card).toHaveCount(1);
    await card.getByRole("link", { name: copy.view }).click();
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === `/${locale}/cottages/${slug}` && url.search !== "",
    );
    const periodToggleControl = page
      .getByRole("complementary")
      .getByRole("button", { name: unit.name, exact: true });
    await periodToggleControl.focus();
    await expect(periodToggleControl).toBeFocused();
    const periodToggleSource = await periodToggleControl.elementHandle();
    if (!periodToggleSource) throw new Error("Focus source is missing");
    await periodToggleControl.press("Enter");
    await expect(
      page.getByRole("link", { name: copy.quote, exact: true }),
    ).toBeVisible();
    await expect(periodToggleControl).toBeEnabled();
    await expect(periodToggleControl).toBeFocused();
    expect(
      await periodToggleSource.evaluate(
        (source) => document.activeElement === source,
      ),
    ).toBe(true);
    await periodToggleSource.dispose();

    await page.getByRole("link", { name: copy.quote }).click();
    await expect(page).toHaveURL(
      (url) => url.pathname === `/${locale}/request/${slug}`,
    );
    const quoteUrl = new URL(page.url());
    for (const key of ["from", "to", "guests"]) {
      expect(quoteUrl.searchParams.get(key)).toBe(query.get(key));
    }
    expect(quoteUrl.searchParams.getAll("selection")).toEqual(
      query.getAll("selection"),
    );
    await expect(page.locator("html")).toHaveAttribute(
      "dir",
      locale === "en" ? "ltr" : "rtl",
    );
    await expect(page.getByRole("heading", { name: copy.title })).toBeVisible();
  };
  for (const locale of testInfo.project.name === "mobile"
    ? (["ar", "ckb", "en"] as const)
    : (["en"] as const)) {
    await reachQuoteFromDiscovery(locale);
  }
  await expect(page.getByText("IQD 5,000", { exact: true })).toBeVisible();
  await expect(page.getByText("IQD 185,000", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Verify your phone to continue" }),
  ).toBeVisible();
  await page.getByLabel("Iraqi phone number").fill(customerPhone);
  const inlineSendControl = page.getByRole("button", {
    name: "Send verification code",
  });
  await inlineSendControl.focus();
  await expect(inlineSendControl).toBeFocused();
  await inlineSendControl.press("Enter");
  const verificationCode = page.getByLabel("Verification code");
  await expect(verificationCode).toBeVisible();

  await verificationCode.fill("123456");
  const inlineVerifyControl = page.getByRole("button", {
    name: "Verify",
    exact: true,
  });
  await inlineVerifyControl.focus();
  await expect(inlineVerifyControl).toBeFocused();
  const inlineRequestUrl = page.url();
  const inlineRequestFrame = page.getByRole("region", {
    name: "Send your Booking Request",
    exact: true,
  });
  const originalRequestFrame = await inlineRequestFrame.elementHandle();
  if (!originalRequestFrame) throw new Error("Inline request frame is missing");
  await inlineVerifyControl.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Send your Booking Request" }),
  ).toBeVisible();

  // Same-route completion refreshes the account header before switching language.
  await expect(
    page
      .getByRole("banner")
      .getByRole("button", { name: "Account", exact: true }),
  ).toBeAttached();
  await expect(page).toHaveURL(inlineRequestUrl);
  await expect(inlineRequestFrame).toBeFocused();
  expect(
    await originalRequestFrame.evaluate(
      (frame) => frame.isConnected && frame === document.activeElement,
    ),
  ).toBe(true);
  await expect(page.getByLabel("Customer name")).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("inline-completion-focus-en.png"),
    fullPage: true,
  });
  await originalRequestFrame.dispose();
  const arabic = page
    .getByRole("banner")
    .getByRole("link", { name: "العربية" });
  await openHeaderPanel(page, "language");
  await expect(arabic).toHaveAttribute("href", /^\/ar\/request\//);
  await arabic.click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(
    page.getByRole("heading", { name: "أرسل طلب الحجز" }),
  ).toBeVisible();
  await openHeaderPanel(page, "language");
  await page.getByRole("banner").getByRole("link", { name: "English" }).click();
  await expect(
    page.getByRole("heading", { name: "Send your Booking Request" }),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Continue an existing enquiry" }),
  ).toHaveCSS("border-top-width", "0px");
  await page.getByLabel("Customer name").fill("Browser Customer");
  await page.getByLabel(/accept the preserved House Rules/i).check();
  await page.getByLabel(/accept the cancellation policy/i).check();
  await page.getByLabel(/accept the marketplace booking terms/i).check();
  const requestSubmitControl = page.getByRole("button", {
    name: "Send Booking Request",
    exact: true,
  });
  await requestSubmitControl.focus();
  await expect(requestSubmitControl).toBeFocused();
  const submitRouteUrl = page.url();
  let releaseSubmitResponse: () => void = () => {};
  const submitRelease = new Promise<void>((resolve) => {
    releaseSubmitResponse = resolve;
  });
  const holdSubmitResponse = async (route: Route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    await submitRelease;
    await route.fulfill({ response });
  };
  await page.route(submitRouteUrl, holdSubmitResponse);
  try {
    const submitRequest = page.waitForRequest(
      (request) =>
        request.url() === submitRouteUrl && request.method() === "POST",
    );
    await page.keyboard.press("Enter");
    await submitRequest;
    const requestForm = page.getByRole("form", {
      name: "Send your Booking Request",
    });
    const pendingSubmit = requestForm.locator('button[type="submit"]');
    await expect(pendingSubmit).toBeDisabled();
    await expect(pendingSubmit).toHaveAttribute("aria-busy", "true");
    await requestForm.evaluate((form) =>
      (form as HTMLFormElement).requestSubmit(),
    );
    await expect(pendingSubmit).toBeDisabled();
    await expect(pendingSubmit).toHaveAttribute("aria-busy", "true");
    releaseSubmitResponse();
    await expect(
      page.getByRole("heading", { name: "Booking Request pending" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", {
        name: "View and manage this request",
        exact: true,
      }),
    ).toBeFocused();
  } finally {
    releaseSubmitResponse();
    await page.unroute(submitRouteUrl, holdSubmitResponse);
  }

  await expect(page.getByText(/does not reserve/)).toHaveCount(0);
  await expect(page.getByText("Owner response deadline")).toBeVisible();
  expect(await page.locator("body").innerText()).not.toContain(exactAddress);
  expect(await page.content()).not.toContain(ownerPhone);
  const requestReference = await page
    .getByText(/^RC-REQ-[A-F0-9]{16}$/)
    .innerText();
  expect(requestReference).toMatch(/^RC-REQ-[A-F0-9]{16}$/);
  const coverResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === expectedCoverSrc &&
      response.request().resourceType() === "image",
  );
  const unpaidResponse = await page.goto(
    `/en/booking-requests/${requestReference}`,
  );
  expect(unpaidResponse?.ok()).toBe(true);
  const unpaidResponseBody = await unpaidResponse!.text();
  expect(unpaidResponseBody).not.toContain(exactAddress);
  expect(unpaidResponseBody).not.toContain(ownerPhone);
  const progress = page.getByRole("list", { name: "Booking Request progress" });
  await expect(progress).toBeVisible();
  await expect(page.getByText("IQD 185,000", { exact: true })).toBeVisible();
  await expect(page.getByText(requestReference, { exact: true })).toBeVisible();
  await observeCoverIdentity(page, "en", requestReference);
  const loadedCoverResponse = await coverResponse;
  expect(loadedCoverResponse.ok()).toBe(true);
  const coverHeaders = await loadedCoverResponse.allHeaders();
  expect(coverHeaders["cache-control"]).toContain("private");
  expect(coverHeaders["cache-control"]).toContain("no-store");
  await expect(
    page
      .getByText("Customer Total", { exact: true })
      .locator("..")
      .locator("dd"),
  ).toHaveText("IQD 185,000");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const footer = document.querySelector(
          ".customer-booking-request-actions",
        );
        const withdraw = footer?.querySelector("button");
        const messages = document.querySelector(".customer-request-messages");
        const row = messages?.querySelector(".request-follow-up");
        const heading = row?.querySelector("h2");
        const action = row?.querySelector("button");
        if (!footer || !withdraw || !messages || !row || !heading || !action)
          throw new Error("Pending request actions are missing");
        const footerBox = footer.getBoundingClientRect();
        const withdrawBox = withdraw.getBoundingClientRect();
        const headingBox = heading.getBoundingClientRect();
        const actionBox = action.getBoundingClientRect();
        const rowStyle = getComputedStyle(row);
        const phone = innerWidth <= 640;
        return {
          withdrawWidth: phone
            ? Math.abs(withdrawBox.width - footerBox.width) < 1
            : withdrawBox.width < footerBox.width / 2 &&
              Math.abs(withdrawBox.right - footerBox.right) < 1,
          messagesRow: phone
            ? actionBox.top >= headingBox.bottom &&
              Math.abs(
                actionBox.width -
                  (row.clientWidth -
                    parseFloat(rowStyle.paddingInlineStart) -
                    parseFloat(rowStyle.paddingInlineEnd)),
              ) < 1
            : actionBox.left >= headingBox.right,
          liftedMessages: getComputedStyle(messages).boxShadow !== "none",
        };
      }),
    )
    .toEqual({ withdrawWidth: true, messagesRow: true, liftedMessages: true });
  await expect(progress.getByRole("listitem")).toHaveCount(4);
  await expect(
    progress.getByRole("listitem").filter({ hasText: "Owner decision" }),
  ).toHaveAttribute("aria-current", "step");
  await page.screenshot({
    path: test.info().outputPath("progress-en.png"),
    fullPage: true,
  });
  await page.goto(`/ar/booking-requests/${requestReference}`);
  const arabicProgress = page.getByRole("list", { name: "تقدّم طلب الحجز" });
  await expect(arabicProgress).toBeVisible();
  await expect(arabicProgress.locator('[aria-current="step"]')).toContainText(
    "قرار المالك",
  );
  await page.screenshot({
    path: test.info().outputPath("progress-ar.png"),
    fullPage: true,
  });
  await page.goto(`/ckb/booking-requests/${requestReference}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "دۆخی داواکاری حجز",
  );
  const soraniProgress = page.getByRole("list", {
    name: "پێشکەوتنی داواکاری حجز",
  });
  await expect(soraniProgress).toBeVisible();
  await expect(page.getByText(requestReference, { exact: true })).toBeVisible();
  for (const locale of ["en", "ar", "ckb"] as const) {
    const requestPath = `/${locale}/booking-requests/${requestReference}`;
    await page.goto(requestPath);
    const returnLink = await observeRecordHeading(
      page,
      testInfo,
      accessMessages[locale].backToBookings,
      `/${locale}/bookings`,
      `heading-customer-request-${locale}-a11y`,
    );
    await observeCoverIdentity(page, locale, requestReference);
    if (
      (testInfo.project.name === "desktop" && locale === "en") ||
      (testInfo.project.name === "mobile" && locale === "ar")
    )
      await page.screenshot({
        path: testInfo.outputPath(`heading-customer-request-${locale}.png`),
      });
    await returnLink.press("Enter");
    await expect(page).toHaveURL(`/${locale}/bookings`);
    await page.goto(requestPath);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  }
  await page.goto(`/en/booking-requests/${requestReference}`);
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
  await expect(ownerPage).toHaveURL(/\/en\/owner\/cottages$/);
  const ownerNotice = ownerPage.getByRole("article", {
    name: requestReference,
  });
  await expect(ownerNotice).toBeVisible();
  await expect(ownerNotice).toContainText("Browser Customer");
  await expect(ownerNotice).not.toContainText(/provider|payment|phone|@/i);
  await expect(ownerNotice).toContainText("4 guests");
  await expect(ownerNotice).toContainText("IQD 180,000");
  await expect(ownerNotice).toContainText(/Answer within/);
  await ownerPage.goto(`/en/owner/booking-requests/${requestReference}`);
  const ownerFullRequest = ownerPage.getByRole("article", {
    name: requestReference,
  });
  await expect(ownerFullRequest).toContainText("Marketplace commission");
  await expect(ownerFullRequest).toContainText("Expected net amount");
  await expect(ownerFullRequest).toContainText("House Rules");
  await expect(ownerFullRequest).not.toContainText(
    /terms version|policy version/i,
  );
  await expect(ownerFullRequest).toContainText("(Cottage Shift)");
  const ownerHeadingViewport = ownerPage.viewportSize()!;
  await ownerPage.setViewportSize(page.viewportSize()!);
  for (const locale of ["en", "ar", "ckb"] as const) {
    const requestPath = `/${locale}/owner/booking-requests/${requestReference}`;
    await ownerPage.goto(requestPath);
    const returnLink = await observeRecordHeading(
      ownerPage,
      testInfo,
      accessMessages[locale].backToBookings,
      `/${locale}/bookings?workspace=owner`,
      `heading-owner-request-${locale}-a11y`,
    );
    await observeCoverIdentity(ownerPage, locale, requestReference);
    if (testInfo.project.name === "mobile" && locale === "ckb")
      await ownerPage.screenshot({
        path: testInfo.outputPath("heading-owner-request-ckb.png"),
      });
    await returnLink.press("Enter");
    await expect(ownerPage).toHaveURL(`/${locale}/bookings?workspace=owner`);
    await ownerPage.goto(requestPath);
    await expect(ownerPage.getByRole("heading", { level: 1 })).toBeVisible();
  }
  await ownerPage.setViewportSize(ownerHeadingViewport);
  await ownerPage.goto("/en/owner/cottages");

  await openHeaderPanel(page, "menu");
  await page
    .getByRole("banner")
    .getByRole("menuitem", { name: "Support" })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "support is not operating",
  );
  await page
    .getByRole("main")
    .getByRole("link", { name: "My customer bookings" })
    .click();
  await expect(
    page.getByRole("heading", { name: "My bookings" }),
  ).toBeVisible();
  await page.goto(`/en/booking-requests/${requestReference}`);

  await openHeaderPanel(ownerPage, "menu");
  await ownerPage
    .getByRole("banner")
    .getByRole("menuitem", { name: "Support" })
    .click();
  // The owner list carries one status per request, earlier attempts included, so
  // wait for the Support page before reading its single status.
  await expect(ownerPage).toHaveURL(/\/en\/support$/);
  await expect(ownerPage.getByRole("status")).toContainText(
    "support is not operating",
  );
  await ownerPage
    .getByRole("main")
    .getByRole("link", { name: "Bookings for my cottages" })
    .click();
  await expect(
    ownerPage.getByRole("heading", { name: "Bookings for my cottages" }),
  ).toBeVisible();
  await ownerPage.goto("/en/owner/cottages");

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
      .getByRole("button", { name: "رفض", exact: true })
      .click();
    await arabicNotice
      .getByLabel("سبب الرفض")
      .selectOption("cottage_unavailable");
    await arabicNotice
      .getByLabel("ملاحظة اختيارية للعميل")
      .fill("صيانة مجدولة للمسبح.");
    const declineArControl = arabicNotice.getByRole("button", {
      name: "رفض الطلب كاملاً",
    });
    await declineArControl.focus();
    await expect(declineArControl).toBeFocused();
    await declineArControl.press("Enter");
    await expect(
      arabicNotice.getByText("مرفوض", { exact: true }),
    ).toBeVisible();
    await expect(
      ownerPage.locator("#owner-booking-requests-heading"),
    ).toBeFocused();

    await ownerPage.reload();
    await expect(
      arabicNotice.getByText("إشعار الحالة", { exact: true }),
    ).toBeVisible();
    await page.goto(`/ar/booking-requests/${requestReference}`);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(
      page.getByText("البيت غير متاح", { exact: true }),
    ).toBeVisible();
    const secondReference = await submitAnotherRequest("ckb");
    await page.goto(`/ckb/booking-requests/${secondReference}`);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    // The sentence starts with the label's letters, so the label is asserted together with the sentence's first word.
    await expect(page.locator(".status-banner")).toContainText("چاوەڕێچاوەڕێی");
    const withdrawCkbControl = page.getByRole("button", {
      name: "کشاندنەوەی داواکاری چاوەڕێ",
    });
    await withdrawCkbControl.focus();
    await expect(withdrawCkbControl).toBeFocused();
    await withdrawCkbControl.press("Enter");
    await expect(page.locator(".status-banner")).toContainText("کشێنراوەتەوە");
    await expect(page.getByRole("main")).toBeFocused();

    await page.reload();
    await expect(
      page.getByText("ئاگادارکردنەوەی دۆخ", { exact: true }),
    ).toBeVisible();
  } else if (testInfo.project.name === "desktop") {
    await ownerNotice
      .getByRole("button", { name: "Decline", exact: true })
      .click();
    await ownerNotice
      .getByLabel("Decline reason")
      .selectOption("cannot_accommodate_request");
    await ownerNotice
      .getByLabel("Optional note to the Customer")
      .fill("The requested party cannot be accommodated safely.");
    const declineEnControl = ownerNotice.getByRole("button", {
      name: "Decline complete request",
    });
    await declineEnControl.focus();
    await expect(declineEnControl).toBeFocused();
    await declineEnControl.press("Enter");
    await expect(
      ownerNotice.getByText("Declined", { exact: true }),
    ).toBeVisible();
    await expect(
      ownerPage.locator("#owner-booking-requests-heading"),
    ).toBeFocused();

    await ownerPage.reload();
    await expect(
      ownerNotice.getByText("Status notification", { exact: true }),
    ).toBeVisible();
    await page.goto(`/en/booking-requests/${requestReference}`);
    await expect(
      page.getByText("Cannot accommodate this request", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("The requested party cannot be accommodated safely.", {
        exact: true,
      }),
    ).toBeVisible();

    const processingReference = await submitAnotherRequest("en");
    await page.goto(`/en/booking-requests/${processingReference}`);
    await page.route(page.url(), async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const response = await route.fetch();
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      await route.fulfill({ response });
    });
    const withdrawEnControl = page.getByRole("button", {
      name: "Withdraw pending request",
    });
    await withdrawEnControl.focus();
    await expect(withdrawEnControl).toBeFocused();
    await withdrawEnControl.press("Enter");
    await expect(page.locator(".status-banner")).toContainText("Processing");
    await expect(page.locator(".status-banner")).toContainText("Withdrawn");
    await expect(page.getByRole("main")).toBeFocused();

    const resubmittedReference = await submitAnotherRequest("en");
    await page.goto(`/en/booking-requests/${resubmittedReference}`);
    await expect(page.locator(".status-banner")).toContainText("Pending");
  } else if (testInfo.project.name === "worker") {
    await page.goto(`/en/booking-requests/${requestReference}`);
    await expect(
      page.getByRole("button", { name: "Withdraw pending request" }),
    ).toBeVisible();
    const ownerDetailPage = await ownerContext.newPage();
    try {
      await ownerDetailPage.goto(
        `/en/owner/booking-requests/${requestReference}`,
      );
      const ownerMainSource = await ownerDetailPage
        .getByRole("main")
        .elementHandle();
      if (!ownerMainSource)
        throw new Error("Owner detail main source is missing");
      const ownerAcceptControl = ownerDetailPage.getByRole("button", {
        name: "Accept complete request",
        exact: true,
      });
      await ownerAcceptControl.focus();
      await expect(ownerAcceptControl).toBeFocused();
      await ownerAcceptControl.press("Enter");
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
      await expect(
        ownerDetailPage
          .getByText("Payment confirmation pending", { exact: true })
          .first(),
      ).toBeVisible();
      expect(
        await ownerMainSource.evaluate(
          (source) => source === document.querySelector("main"),
        ),
      ).toBe(true);
      await expect(ownerDetailPage.getByRole("main")).toBeFocused();

      const ownerBookingLink = {
        en: "Open confirmed booking",
        ar: "فتح الحجز المؤكد",
        ckb: "کردنەوەی حجزی پشتڕاستکراو",
      } as const;
      const termsLabel = {
        en: "Booking terms",
        ar: "شروط الحجز",
        ckb: "مەرجەکانی حجز",
      } as const;
      const locales = [
        {
          locale: "en",
          pending: "Payment confirmation pending",
          confirmed: "Booking confirmed",
          paidHeading: "Confirmed booking",
          incomplete:
            "Some practical access or contact details are unavailable.",
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
      async function assertPaymentViews(
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
          await customerView.setViewportSize({ width: 390, height: 844 });
          await ownerView.setViewportSize({ width: 390, height: 844 });
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
            await customerView
              .locator("summary")
              .filter({ hasText: termsLabel[copy.locale] })
              .click();
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
            await ownerView
              .locator("summary")
              .filter({ hasText: termsLabel[copy.locale] })
              .click();
            await expect(
              ownerView.getByText(bookingTermsFixture("en").body),
            ).toBeVisible();
            for (const surface of [customerView, ownerView]) {
              const deliveryTitle = {
                en: "Notifications about this request",
                ar: "إشعارات هذا الطلب",
                ckb: "ئاگادارکردنەوەکانی ئەم داواکارییە",
              }[copy.locale];
              const requestDelivery = surface.getByRole("region", {
                name: deliveryTitle,
              });
              await expect(
                requestDelivery.getByRole("listitem"),
              ).not.toHaveCount(0);
              await expect(requestDelivery.getByRole("status")).toHaveCount(0);
              const conversation = surface.getByRole("button", {
                name: {
                  en: "Open conversation",
                  ar: "فتح المحادثة",
                  ckb: "گفتوگۆ بکەرەوە",
                }[copy.locale],
              });
              if (
                state === "paid-confirmed" &&
                reference === requestReference &&
                copy.locale === "en" &&
                surface === customerView
              ) {
                const originalRequestUrl = surface.url();
                await conversation.focus();
                await expect(conversation).toBeFocused();
                await conversation.press("Enter");
                await expect(surface).toHaveURL(
                  /\/en\/messages\/[0-9a-f-]{36}/,
                );
                await expect(
                  surface.getByRole("heading", {
                    name: cottageName,
                    exact: true,
                  }),
                ).toBeVisible();
                await expect(
                  surface.getByRole("heading", {
                    name: cottageName,
                    exact: true,
                    level: 1,
                  }),
                ).toBeFocused();
                await surface.goto(originalRequestUrl);
                await expect(
                  surface.getByRole("heading", { name: copy.paidHeading }),
                ).toBeVisible();
              }
              // A raw browser button computes weight 400 and radius 0px here.
              await expect(conversation).toHaveCSS("font-weight", "700");
              await expect(conversation).not.toHaveCSS("border-radius", "0px");
              // An unstyled section computes border width 0px and radius 0px.
              await expect(requestDelivery).toHaveCSS(
                "border-top-width",
                "1px",
              );
              await expect(requestDelivery).not.toHaveCSS(
                "border-radius",
                "0px",
              );
              const bookingCard = surface.getByRole("region").filter({
                has: surface.getByRole("heading", { level: 1 }),
              });
              for (const followUp of [conversation, requestDelivery]) {
                await expect
                  .poll(async () => {
                    const [card, box, viewportWidth] = await Promise.all([
                      bookingCard.boundingBox(),
                      followUp.boundingBox(),
                      surface.evaluate(
                        () => document.documentElement.clientWidth,
                      ),
                    ]);
                    return (
                      box!.x >= Math.max(card!.x, 1) &&
                      box!.x + box!.width <=
                        Math.min(card!.x + card!.width, viewportWidth - 1)
                    );
                  })
                  .toBe(true);
              }
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
                await expect(
                  surface.getByText(value, { exact: true }),
                ).toHaveCSS("direction", "ltr");
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
            const customerStatus = customerView.getByRole("region").filter({
              has: customerView.getByRole("heading", { level: 1 }),
            });
            for (const surface of [customerStatus, currentOwnerNotice]) {
              await expect(surface.getByRole("status")).toContainText(
                copy.attention,
              );
              await expect(
                surface.getByText(copy.paymentDeadline, { exact: true }),
              ).toBeVisible();
              await expect(surface.getByRole("status")).toContainText(
                copy.held,
              );
              await expect(surface.getByRole("button")).toHaveCount(0);
            }
            await expect(customerView.locator("body")).not.toContainText(
              "Synthetic private fixture address",
            );
            await expect(currentOwnerNotice).not.toContainText(
              /providerReference|diagnostic_reason|idempotency/i,
            );
          }
          if (
            state !== "paid-confirmed" &&
            state !== "paid-confirmed-incomplete"
          )
            await expect(currentOwnerNotice.getByRole("button")).toHaveCount(0);
          const originalConfirmedCover =
            state === "paid-confirmed" && reference === requestReference;
          const confirmedReference = originalConfirmedCover
            ? await customerView
                .locator(".confirmed-booking-identity-text bdi")
                .innerText()
            : null;
          for (const viewport of [
            { width: 390, height: 844 },
            { width: 1440, height: 1000 },
            ...(originalConfirmedCover ? [{ width: 320, height: 844 }] : []),
          ]) {
            for (const surface of [customerView, ownerView]) {
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
              if (originalConfirmedCover && confirmedReference !== null) {
                await observeCoverIdentity(
                  surface,
                  copy.locale,
                  confirmedReference,
                );
                if (
                  surface === ownerView &&
                  ((copy.locale === "en" && viewport.width === 1440) ||
                    (copy.locale === "ar" && viewport.width === 390))
                ) {
                  await surface.evaluate(() => {
                    if (document.activeElement instanceof HTMLElement)
                      document.activeElement.blur();
                  });
                  await surface
                    .locator("header.page-heading")
                    .scrollIntoViewIfNeeded();
                  await surface.screenshot({
                    path: testInfo.outputPath(
                      copy.locale === "en"
                        ? "booking-cover-confirmed-en-desktop.png"
                        : "booking-cover-confirmed-ar-phone.png",
                    ),
                  });
                }
              }
            }
          }
          // Drain page requests before closing their local proxy streams.
          await Promise.all([
            customerView.waitForLoadState("networkidle"),
            ownerView.waitForLoadState("networkidle"),
          ]);
          await customerView.close();
          await ownerView.close();
        }
      }
      await assertPaymentViews("capture-processing");
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
      await expect(
        ownerDetailPage.getByRole("heading", {
          name: "Confirmed booking",
          exact: true,
        }),
      ).toBeVisible({ timeout: 15000 });
      expect(
        await ownerMainSource.evaluate(
          (source) => source === document.querySelector("main"),
        ),
      ).toBe(true);
      await expect(ownerDetailPage.getByRole("main")).toBeFocused();
      await ownerMainSource.dispose();

      // The upgrade backfill helper shares identity with live producers. Exercise
      // the actual authenticated pages and unchanged financial parser with both
      // receiptless request events and receipt-bearing preparation events present.
      const mixedNoticeIdentity = () =>
        harness.runSql(
          `select jsonb_agg(jsonb_build_object('id',e.id,'kind',e.event_kind,'receiptId',e.receipt_id) order by e.id) from public.booking_notification_events e join public.booking_requests q on q.id=e.booking_request_id where q.booking_request_reference='${requestReference}'`,
        );
      const mixedBeforeBackfill = mixedNoticeIdentity();
      harness.runSql(
        `select public.ensure_booking_request_notification_events(id) from public.booking_requests where booking_request_reference='${requestReference}';`,
      );
      expect(mixedNoticeIdentity()).toBe(mixedBeforeBackfill);
      const mixedNotices = JSON.parse(mixedBeforeBackfill) as Array<{
        kind: string;
        receiptId: string | null;
      }>;
      expect(
        mixedNotices.filter((n) => n.kind === "request_accepted"),
      ).toHaveLength(2);
      expect(
        mixedNotices
          .filter((n) => n.kind === "request_accepted")
          .every((n) => n.receiptId === null),
      ).toBe(true);
      expect(
        mixedNotices.filter((n) => n.kind === "preparation_reminder"),
      ).toHaveLength(2);
      expect(
        mixedNotices
          .filter((n) => n.kind === "preparation_reminder")
          .every((n) => typeof n.receiptId === "string"),
      ).toBe(true);
      await assertPaymentViews("paid-confirmed");
      const originalPrivateDirections = JSON.parse(
        harness.runSql(
          `select to_jsonb(private_directions) from public.owner_application_cottage_profiles where id='${profile.id}';`,
        ),
      ) as string | null;
      try {
        harness.runSql(
          `update public.owner_application_cottage_profiles set private_directions=null where id='${profile.id}';`,
        );
        await assertPaymentViews("paid-confirmed-incomplete");
      } finally {
        const restoredPrivateDirections =
          originalPrivateDirections === null
            ? "null"
            : `'${originalPrivateDirections.replaceAll("'", "''")}'`;
        harness.runSql(
          `update public.owner_application_cottage_profiles set private_directions=${restoredPrivateDirections} where id='${profile.id}';`,
        );
      }
      type PaidIdentity = {
        bookingRequestId: string;
        bookingRequestReference: string;
        bookingReference: string;
        receiptId: string;
        recipientUserId: string;
        recipientRole: "customer";
        locale: "en" | "ar" | "ckb";
      };
      const paidIdentity = () => {
        const identities = JSON.parse(
          harness.runSql(
            `select coalesce(jsonb_agg(jsonb_build_object(
            'bookingRequestId',requests.id,
            'bookingRequestReference',requests.booking_request_reference,
            'bookingReference',commitments.commitment_reference,
            'receiptId',receipts.id,
            'recipientUserId',receipts.recipient_user_id,
            'recipientRole',receipts.recipient_role,
            'locale',snapshots.acceptance_locale
          )), '[]'::jsonb)
          from public.booking_requests requests
          join public.booking_confirmations confirmations on confirmations.booking_request_id=requests.id
          join public.booking_receipts receipts on receipts.booking_confirmation_id=confirmations.id and receipts.recipient_role='customer' and receipts.recipient_user_id=requests.customer_user_id
          join public.booking_snapshots snapshots on snapshots.id=requests.booking_snapshot_id and snapshots.id=confirmations.booking_snapshot_id and snapshots.id=receipts.booking_snapshot_id and snapshots.customer_user_id=requests.customer_user_id
          join public.cottage_booking_period_commitments commitments on commitments.id=confirmations.booking_period_commitment_id and commitments.id=requests.booking_period_commitment_id and commitments.customer_user_id=requests.customer_user_id
          where requests.booking_request_reference='${requestReference}';`,
          ),
        ) as PaidIdentity[];
        expect(identities).toHaveLength(1);
        expect(identities[0]).toBeTruthy();
        return identities[0];
      };
      const identityBeforeRetry = paidIdentity();
      const authenticatedCustomerId = harness.runSql(
        `select id from auth.users where phone='${customerPhone.slice(1)}';`,
      );
      expect(identityBeforeRetry).toMatchObject({
        bookingRequestReference: requestReference,
        recipientUserId: authenticatedCustomerId,
        recipientRole: "customer",
      });
      const noticePayload = JSON.stringify(
        paidConfirmationNotice(identityBeforeRetry),
      ).replaceAll("'", "''");
      const failedNotice = JSON.parse(
        harness.runSql(`set role service_role;
        select public.ensure_booking_confirmation_notification_work(
          '${identityBeforeRetry.receiptId}','${identityBeforeRetry.locale}',
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
      const confirmationRetryControl = paidDetails.getByRole("button", {
        name: "Retry confirmation notice",
      });
      await confirmationRetryControl.focus();
      await expect(confirmationRetryControl).toBeFocused();
      await confirmationRetryControl.press("Enter");
      await expect(paidDetails.getByRole("status")).toHaveText("Pending");
      await expect(
        paidDetails.getByRole("button", { name: "Retry confirmation notice" }),
      ).toHaveCount(0);
      await expect(paidDetails.getByRole("status")).toBeFocused();

      await expect(
        paidDetails.getByText("IQD 185,000", { exact: true }),
      ).toBeVisible();
      expect(paidIdentity()).toEqual(identityBeforeRetry);
      const notificationSourceCount = Number(
        harness.runSql(`select
        (select count(*) from public.booking_receipts) +
        (select count(*) from public.booking_notification_events);`),
      );
      expect(Number.isSafeInteger(notificationSourceCount)).toBe(true);
      const tickBudget = Math.ceil(notificationSourceCount / 50) + 1;
      let attemptedTicks = 0;
      let targetState: string | null = null;
      while (attemptedTicks < tickBudget && targetState !== "delivered") {
        attemptedTicks += 1;
        const scheduled = await triggerScheduled(baseURL, "/__scheduled");
        if (!scheduled.ok) {
          throw new Error(
            `Booking confirmation scheduler tick ${attemptedTicks}/${tickBudget} failed with target ${targetState ?? "pending"}`,
          );
        }
        const exactWork = JSON.parse(
          harness.runSql(`select coalesce((select jsonb_build_object(
          'state',work.state
        ) from public.booking_confirmation_notification_work work
        where work.notification_id='${identityBeforeRetry.receiptId}'
          and work.event_id is null), 'null'::jsonb);`),
        ) as { state: string } | null;
        if (!exactWork) {
          throw new Error(
            `Booking confirmation work is missing after ${attemptedTicks}/${tickBudget} ticks`,
          );
        }
        targetState = exactWork.state;
      }
      if (targetState !== "delivered") {
        throw new Error(
          `Booking confirmation remained ${targetState ?? "missing"} after ${attemptedTicks}/${tickBudget} ticks`,
        );
      }
      await page.goto(`/en/booking-requests/${requestReference}`);
      await expect(
        page.getByRole("heading", { name: "Confirmed booking" }),
      ).toBeVisible();
      await expect(page.getByRole("status")).toContainText("Delivered");
      expect(paidIdentity()).toEqual(identityBeforeRetry);
      await page
        .getByRole("link", { name: accessMessages.en.backToBookings })
        .click();
      await expect(
        page.getByRole("heading", { name: "My bookings" }),
      ).toBeVisible();
      const customerHistoryLink = page.locator(
        `a[href="/en/booking-requests/${requestReference}"]`,
      );
      await expect(
        page.locator(".list-rows > li").filter({ has: customerHistoryLink }),
      ).toContainText(identityBeforeRetry.bookingReference);
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
      await ownerPage
        .getByRole("link", { name: accessMessages.en.backToBookings })
        .click();
      const ownerHistoryLink = ownerPage.locator(
        `a[href="/en/owner/booking-requests/${requestReference}"]`,
      );
      await expect(
        ownerPage.locator(".list-rows > li").filter({ has: ownerHistoryLink }),
      ).toContainText(identityBeforeRetry.bookingReference);
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
      const failureRecorded = JSON.parse(
        harness.runSql(
          paymentEvidenceSql +
            `set role service_role;
      with leased as materialized (
        select public.lease_booking_request_capture_work('${failureId}',
          '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb) result
      ), executed as materialized (
        select leased.result->'permit' permit,
          pg_temp.capture_execute(leased.result->'permit','failed') result
        from leased
      )
      select public.record_booking_request_capture_failure('${failureId}',
        (permit->>'leaseGeneration')::bigint, (permit->>'leaseToken')::uuid,
        result) from executed;`,
        ),
      );
      expect(failureRecorded.status).toBe("payment-required");
      // Both existing pages must refresh from the request's persisted failure evidence.
      await expect(page.getByRole("status")).toContainText("Payment Required", {
        timeout: 15000,
      });
      await expect(failureNotice.getByRole("status")).toContainText(
        "Payment Required",
        { timeout: 15000 },
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
      await assertPaymentViews("payment-required-open", failureReference);
      expect((await triggerScheduled(baseURL, "/__scheduled")).ok).toBe(true);
      expect(observeFailure()).toEqual(terminal);
      // Only the current notice reaches the adapter; the ones the request moved past are suppressed.
      expect(
        JSON.parse(
          harness.runSql(
            `select coalesce(jsonb_agg(jsonb_build_array(e.event_kind,e.recipient_role,w.state,(select count(*) from public.fictional_booking_confirmation_notification_effects f where f.event_id=e.id)) order by e.event_kind,e.recipient_role),'[]') from public.booking_notification_events e join public.booking_requests q on q.id=e.booking_request_id left join public.booking_confirmation_notification_work w on w.event_id=e.id where q.booking_request_reference='${failureReference}' and e.receipt_id is null;`,
          ),
        ),
      ).toEqual([
        ["request_accepted", "cottage_owner", "suppressed", 0],
        ["request_accepted", "customer", "suppressed", 0],
        ["request_new", "cottage_owner", "suppressed", 0],
        ["request_payment_required", "customer", "delivered", 1],
      ]);

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
          { timeout: 15000 },
        );
        await assertPaymentViews("payment-required-elapsed", failureReference);
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
      const otherPhone = bookingFixture.secondaryCustomerPhone;
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
        const paymentRecoveryControl = page.getByRole("button", {
          name: "Use simulated replacement payment",
          exact: true,
        });
        await paymentRecoveryControl.focus();
        await expect(paymentRecoveryControl).toBeFocused();
        const customerMainSource = await page.getByRole("main").elementHandle();
        if (!customerMainSource)
          throw new Error("Customer detail main focus source is missing");
        await paymentRecoveryControl.press("Enter");
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
        expect(
          await customerMainSource.evaluate(
            (source) => source === document.querySelector("main"),
          ),
        ).toBe(true);
        await expect(page.getByRole("main")).toBeFocused();

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
        expect(
          await customerMainSource.evaluate(
            (source) => source === document.querySelector("main"),
          ),
        ).toBe(true);
        await expect(page.getByRole("main")).toBeFocused();
        await customerMainSource.dispose();
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
      await assertPaymentViews("paid-confirmed", failureReference);

      // A separate future Shift proves unpaid expiry without changing either confirmed booking above.
      const expiryDay = serviceDay(dayOffset + 1);
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
      const expiryFailureRecorded = JSON.parse(
        harness.runSql(
          paymentEvidenceSql +
            `set role service_role;
      with leased as materialized (
        select public.lease_booking_request_capture_work('${expiryId}','${identity}') result
      ), executed as materialized (
        select leased.result->'permit' permit,
          pg_temp.capture_execute(leased.result->'permit','failed') result
        from leased
      )
      select public.record_booking_request_capture_failure('${expiryId}',
        (permit->>'leaseGeneration')::bigint, (permit->>'leaseToken')::uuid,
        result) from executed;`,
        ),
      );
      expect(expiryFailureRecorded.status).toBe("payment-required");
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
      // The due claim (signatures[1]) treats only this request as due at the pinned deadline, so an
      // earlier attempt's unpaid request stays on the database clock.
      const clocked = definitions.map((definition, index) =>
        definition.replaceAll(
          "clock_timestamp()",
          index === 1
            ? `(case when work.booking_request_id='${expiryId}' then public.live_payment_expiry_now() else clock_timestamp() end)`
            : "public.live_payment_expiry_now()",
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
        await assertPaymentViews("payment-required-elapsed", expiryReference);
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
        await expect(
          page
            .getByRole("region")
            .filter({
              has: page.getByRole("heading", {
                name: "Booking Request status",
                exact: true,
              }),
            })
            .getByRole("button"),
        ).toHaveCount(0);
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
        await assertPaymentViews("payment-expiry-quarantined", expiryReference);
        // The actual scheduled handler cannot restart an uncertain release after quarantine.
        harness.runSql(paymentEvidenceSql + clocked[4]);
        expect((await triggerScheduled(baseURL, "/__scheduled")).ok).toBe(true);
        await expect(page.getByRole("status")).toContainText(
          "Payment needs review",
        );
        expect(await expiryGraph()).toEqual(attention);
        await assertPaymentViews("payment-expiry-quarantined", expiryReference);
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
    } finally {
      await ownerDetailPage.close();
    }
  }
  if (testInfo.project.name === "worker")
    await test.step("suspension resolves a waiting request through authoritative local release and delivery once", async () => {
      const pendingDay = serviceDay(dayOffset + 2);
      const opened = await fixtureOwner.rpc(
        "set_cottage_inventory_availability",
        {
          target_profile_id: profile.id,
          target_schedule_revision_id: profile.current_shift_schedule_id,
          target_service_day: pendingDay,
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
      expect(opened.error).toBeNull();
      query.set("from", pendingDay);
      query.set("to", pendingDay);
      query.set("selection", `${pendingDay}:shift:${shift.position}`);
      const reference = await submitAnotherRequest("en");
      const requests = JSON.parse(
        harness.runSql(
          `select jsonb_agg(to_jsonb(requests)) from public.booking_requests requests where booking_request_reference='${reference}';`,
        ),
      );
      expect(requests).toHaveLength(1);
      const request = requests[0];
      expect(request.status).toBe("pending");
      const privileged = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_SECRET_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      );
      const administrator = await privileged.auth.admin.createUser({
        email: `pending-suspension-${randomUUID()}@rentcottage.test`,
        password: "Local-test-password-2026",
        email_confirm: true,
      });
      expect(administrator.error).toBeNull();
      const actorId = administrator.data.user!.id;
      const provisioned = await privileged.rpc(
        "provision_platform_administrator",
        { target_user_id: actorId },
      );
      expect(provisioned.error).toBeNull();
      const readRestriction = () =>
        JSON.parse(
          harness.runSql(`begin; set local role authenticated;
          set local request.jwt.claims='{"sub":"${actorId}","role":"authenticated","aal":"aal2"}';
          select public.get_marketplace_suspension('customer','${request.customer_user_id}'); commit;`),
        );
      const initialRestriction = readRestriction();
      expect(initialRestriction).toMatchObject({
        status: "ready",
        targetKind: "customer",
        targetId: request.customer_user_id,
        state: "active",
      });
      expect(Number.isSafeInteger(initialRestriction.revision)).toBe(true);
      expect(initialRestriction.revision).toBeGreaterThanOrEqual(0);
      const expectedRevision: number = initialRestriction.revision;
      const commandId = randomUUID();
      const suspend = () =>
        JSON.parse(
          harness.runSql(`begin; set local role authenticated;
      set local request.jwt.claims='{"sub":"${actorId}","role":"authenticated","aal":"aal2"}';
      select public.set_marketplace_suspension('customer','${request.customer_user_id}','suspend',${expectedRevision},'Fictional pending suspension','${commandId}'); commit;`),
        );
      const evidence = () =>
        JSON.parse(
          harness.runSql(`select jsonb_build_object(
      'request',(select to_jsonb(rows) from public.booking_requests rows where rows.id='${request.id}'),
      'snapshot',(select to_jsonb(rows) from public.booking_snapshots rows where rows.id='${request.booking_snapshot_id}'),
      'work',(select to_jsonb(rows) from public.booking_request_release_work rows where booking_request_id='${request.id}'),
      'hold',(select to_jsonb(rows) from public.cottage_booking_period_commitments rows where rows.id='${request.booking_period_commitment_id}'),
      'occupancies',(select jsonb_agg(to_jsonb(rows) order by service_day,shift_id) from public.cottage_booking_period_occupancies rows where booking_period_commitment_id='${request.booking_period_commitment_id}'),
      'release',(select coalesce(jsonb_agg(to_jsonb(rows) order by rows.id),'[]') from public.payment_provider_operations rows where payment_lifecycle_id='${request.payment_lifecycle_id}' and operation_kind='release'),
      'effects',(select coalesce(jsonb_agg(to_jsonb(rows) order by rows.id),'[]') from public.fictional_booking_confirmation_notification_effects rows where booking_request_id='${request.id}'),
      'events',(select coalesce(jsonb_agg(jsonb_build_object('event',to_jsonb(events),'work',to_jsonb(work)) order by events.id),'[]') from public.booking_notification_events events left join public.booking_confirmation_notification_work work on work.event_id=events.id where events.booking_request_id='${request.id}'),
      'confirmations',(select coalesce(jsonb_agg(to_jsonb(rows) order by rows.id),'[]') from public.booking_confirmations rows where booking_request_id='${request.id}')
    );`),
        );
      const before = evidence();
      expect(before.hold.status).toBe("pending_hold");
      expect(before.release).toEqual([]);
      let failed = false;
      let failure: unknown;
      try {
        const restricted = suspend();
        expect(restricted.status).toBe("completed");
        expect(restricted.target.releaseSummary).toEqual({
          affected: 1,
          resolved: 0,
          processing: 1,
          quarantined: 0,
        });
        const processing = evidence();
        expect(processing.request.status).toBe("processing");
        expect(processing.work).toMatchObject({
          booking_request_id: request.id,
          suspension_action_id: restricted.actionId,
          outcome: "declined",
          state: "processing",
        });
        expect(processing.hold).toEqual(before.hold);
        expect(processing.occupancies).toEqual(before.occupancies);
        expect(processing.release).toEqual([]);
        expect(suspend()).toMatchObject({
          status: "completed",
          actionId: restricted.actionId,
        });
        expect(evidence()).toEqual(processing);
        harness.runSql(
          `insert into public.account_names (user_id, first_name) values ('${actorId}', 'Sara') on conflict (user_id) do update set first_name=excluded.first_name;`,
        );
        const administratorContext = await browser.newContext({
          baseURL,
          viewport: { width: 390, height: 844 },
        });
        try {
          const administratorPage = await administratorContext.newPage();
          await administratorPage.goto("/en/administrator/access");
          await administratorPage
            .getByLabel("Email")
            .fill(administrator.data.user!.email!);
          await administratorPage
            .getByLabel("Password")
            .fill("Local-test-password-2026");
          await administratorPage
            .getByRole("button", { name: "Continue", exact: true })
            .click();
          const secret = await administratorPage
            .getByTestId("mfa-secret")
            .textContent();
          if (!secret)
            throw new Error(
              "Pending suspension administrator enrollment is unavailable",
            );
          await administratorPage.getByLabel("Authenticator app code").fill(
            new OTPAuth.TOTP({
              secret: OTPAuth.Secret.fromBase32(secret),
            }).generate(),
          );
          await administratorPage
            .getByRole("button", { name: "Verify", exact: true })
            .click();
          await expect(
            administratorPage.getByText(/Administrator access is ready/),
          ).toBeVisible();
          await administratorPage.goto(
            `/ar/administrator/records/account/${request.customer_user_id}`,
          );
          await expect(administratorPage.locator("html")).toHaveAttribute(
            "lang",
            "ar",
          );
          await expect(administratorPage.locator("html")).toHaveAttribute(
            "dir",
            "rtl",
          );
          const customerPanel = administratorPage.getByRole("region", {
            name: "نشاط العميل",
            exact: true,
          });
          await expect(customerPanel.locator(".status-badge")).toHaveText(
            "معلّق",
          );
          const progress = customerPanel.getByRole("group", {
            name: "تقدّم تحرير الدفعات",
            exact: true,
          });
          for (const [label, value] of [
            ["المتأثرة", "1"],
            ["المحسومة", "0"],
            ["قيد المعالجة", "1"],
            ["يحتاج إلى متابعة", "0"],
          ]) {
            await expect(
              progress
                .locator(".fact-list > div")
                .filter({
                  has: administratorPage.getByText(label, { exact: true }),
                })
                .locator("dd"),
            ).toHaveText(value);
          }
          await expect(
            customerPanel
              .getByRole("listitem")
              .filter({ hasText: "Fictional pending suspension" })
              .getByText(actorId, { exact: true }),
          ).toBeVisible();
          const summary = JSON.parse(
            harness.runSql(`begin; set local role authenticated;
          set local request.jwt.claims='{"sub":"${actorId}","role":"authenticated","aal":"aal2"}';
          select public.get_marketplace_suspension('customer','${request.customer_user_id}'); commit;`),
          );
          expect(summary.releaseSummary).toEqual({
            affected: 1,
            resolved: 0,
            processing: 1,
            quarantined: 0,
          });
          expect(summary.actions[0].id).toBe(restricted.actionId);
          expect(evidence()).toEqual(processing);
          const accessibility = await (async () => {
            const savedViewport = administratorPage.viewportSize();
            expect(savedViewport).not.toBeNull();
            const savedZoom = await administratorPage
              .locator("html")
              .evaluate((element) => ({
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
              const reason = customerPanel.getByRole("textbox", {
                name: "السبب",
                exact: true,
              });
              const submit = customerPanel.locator("form").getByRole("button");
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
              const rendered = await customerPanel.evaluate((region) => {
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
                const targets = Array.from(
                  region.querySelectorAll("button,a[href]"),
                )
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
                expect(target.rect.width, target.text).toBeGreaterThanOrEqual(
                  24,
                );
                expect(target.rect.height, target.text).toBeGreaterThanOrEqual(
                  24,
                );
              }
              await administratorPage.setViewportSize({
                width: 320,
                height: savedViewport!.height,
              });
              const narrow = await customerPanel.evaluate((region) => ({
                viewportWidth: innerWidth,
                documentWidth: document.documentElement.clientWidth,
                scrollWidth: document.documentElement.scrollWidth,
                region: region.getBoundingClientRect().toJSON(),
              }));
              expect(narrow.scrollWidth).toBeLessThanOrEqual(
                narrow.documentWidth + 1,
              );
              expect(narrow.region.left).toBeGreaterThanOrEqual(-1);
              expect(narrow.region.right).toBeLessThanOrEqual(
                narrow.viewportWidth + 1,
              );
              await administratorPage.setViewportSize(savedViewport!);
              return {
                minimumTargetCssPixels: 24,
                keyboard: {
                  order: ["labelled reason textarea", "enabled form submit"],
                  reasonFocus,
                  submitFocus,
                },
                rendered,
                narrow,
                savedViewport,
                savedZoom,
              };
            } finally {
              await administratorPage
                .locator("html")
                .evaluate((element, saved) => {
                  if (saved.value)
                    element.style.setProperty(
                      "zoom",
                      saved.value,
                      saved.priority,
                    );
                  else element.style.removeProperty("zoom");
                }, savedZoom);
              await administratorPage.setViewportSize(savedViewport!);
              expect(administratorPage.viewportSize()).toEqual(savedViewport);
              expect(
                await administratorPage.locator("html").evaluate((element) => ({
                  value: element.style.getPropertyValue("zoom"),
                  priority: element.style.getPropertyPriority("zoom"),
                })),
              ).toEqual(savedZoom);
            }
          })();
          const capture = testInfo.outputPath("administrator-ar-mobile.png");
          await administratorPage.screenshot({ path: capture, fullPage: true });
          await testInfo.attach("administrator-ar-mobile", {
            path: capture,
            contentType: "image/png",
          });
          const administratorArMobileStatePath = testInfo.outputPath(
            "administrator-ar-mobile-state.json",
          );
          await writeFile(
            administratorArMobileStatePath,
            JSON.stringify({
              actorId,
              targetId: request.customer_user_id,
              actionId: restricted.actionId,
              requestId: request.id,
              workId: processing.work.id,
              summary,
              accessibility,
              viewport: administratorPage.viewportSize(),
              lang: await administratorPage
                .locator("html")
                .getAttribute("lang"),
              dir: await administratorPage.locator("html").getAttribute("dir"),
            }),
          );
          await testInfo.attach("administrator-ar-mobile-state", {
            path: administratorArMobileStatePath,
            contentType: "application/json",
          });
        } finally {
          await administratorContext.close();
        }
        expect(evidence()).toEqual(processing);
        for (let tick = 0; tick < 2; tick++) {
          const result = await triggerScheduled(baseURL, "/__scheduled");
          expect(result.ok, await result.text()).toBe(true);
        }
        const resolved = evidence();
        expect(resolved.request).toMatchObject({
          id: request.id,
          status: "declined",
          decline_reason: "other",
          decline_note: null,
        });
        expect(resolved.snapshot).toEqual(before.snapshot);
        expect(resolved.work).toMatchObject({
          id: processing.work.id,
          state: "complete",
          suspension_action_id: restricted.actionId,
        });
        expect(resolved.hold).toMatchObject({
          id: before.hold.id,
          status: "released_hold",
        });
        expect(
          resolved.occupancies.every((row: { active: boolean }) => !row.active),
        ).toBe(true);
        expect(resolved.confirmations).toEqual([]);
        expect(resolved.release).toHaveLength(1);
        expect(resolved.release[0]).toMatchObject({
          provider: "fictional-payments",
          environment: "local-test",
          current_outcome: "succeeded",
          operation_kind: "release",
        });
        expect(resolved.release[0].movement_reference).toEqual(
          expect.any(String),
        );
        const terminal = resolved.events.filter(
          (row: { event: { event_kind: string } }) =>
            row.event.event_kind === "request_declined",
        );
        expect(terminal).toHaveLength(2);
        const customerDelivery = terminal.find(
          (row: { event: { recipient_user_id: string } }) =>
            row.event.recipient_user_id === request.customer_user_id,
        );
        expect(customerDelivery).toMatchObject({
          event: { recipient_role: "customer" },
          work: { state: "delivered" },
        });
        const delivered = resolved.effects.filter((row: { event_id: string }) =>
          terminal.some(
            (event: { event: { id: string } }) =>
              event.event.id === row.event_id,
          ),
        );
        expect(delivered).toHaveLength(2);
        for (const effect of delivered)
          expect(effect).toMatchObject({
            supplier: "fictional-notifications",
            environment: "local-test",
          });
        await page.goto(`/en/booking-requests/${reference}`);
        await expect(page.getByRole("main")).toContainText("Declined");
        await expect(page.getByRole("main")).not.toContainText(
          "Fictional pending suspension",
        );
        await page.reload();
        const repeated = await triggerScheduled(baseURL, "/__scheduled");
        expect(repeated.ok, await repeated.text()).toBe(true);
        expect(suspend()).toMatchObject({
          status: "completed",
          actionId: restricted.actionId,
          target: {
            releaseSummary: {
              affected: 1,
              resolved: 1,
              processing: 0,
              quarantined: 0,
            },
          },
        });
        expect(evidence()).toEqual(resolved);
      } catch (error) {
        failed = true;
        failure = error;
      } finally {
        try {
          const committed = JSON.parse(
            harness.runSql(`select coalesce(jsonb_agg(to_jsonb(actions)),'[]')
            from private.marketplace_suspension_actions actions where command_id='${commandId}';`),
          );
          expect(committed.length).toBeLessThanOrEqual(1);
          const suspension = committed[0];
          if (suspension)
            expect(suspension).toMatchObject({
              command_id: commandId,
              actor_user_id: actorId,
              target_kind: "customer",
              account_user_id: request.customer_user_id,
              action: "suspend",
              reason: "Fictional pending suspension",
              expected_revision: expectedRevision,
              resulting_revision: expectedRevision + 1,
            });
          const current = readRestriction();
          expect(current.status).toBe("ready");
          const retainedBeforeRestoration = evidence();
          let reactivationActionId: string | null = null;
          if (current.state === "suspended") {
            expect(
              suspension,
              "Only this invocation's restriction can be restored",
            ).toBeDefined();
            expect(current.revision).toBe(suspension.resulting_revision);
            expect(current.actions[0]).toMatchObject({
              id: suspension.id,
              commandId,
              actorUserId: actorId,
              action: "suspend",
            });
            const reactivated = JSON.parse(
              harness.runSql(`begin; set local role authenticated;
              set local request.jwt.claims='{"sub":"${actorId}","role":"authenticated","aal":"aal2"}';
              select public.set_marketplace_suspension('customer','${request.customer_user_id}','reactivate',${current.revision},'Fictional pending customer fixture restored','${randomUUID()}'); commit;`),
            );
            expect(reactivated.status).toBe("completed");
            reactivationActionId = reactivated.actionId;
          } else expect(current.state).toBe("active");
          const finalRestriction = readRestriction();
          expect(finalRestriction).toMatchObject({
            status: "ready",
            targetKind: "customer",
            targetId: request.customer_user_id,
            state: "active",
          });
          expect(Number.isSafeInteger(finalRestriction.revision)).toBe(true);
          expect(finalRestriction.revision).toBeGreaterThanOrEqual(
            expectedRevision,
          );
          expect(finalRestriction.revision).toBe(
            reactivationActionId ? current.revision + 1 : current.revision,
          );
          if (suspension)
            expect(finalRestriction.actions).toContainEqual(
              expect.objectContaining({
                id: suspension.id,
                commandId,
                actorUserId: actorId,
              }),
            );
          if (reactivationActionId)
            expect(finalRestriction.actions[0]).toMatchObject({
              id: reactivationActionId,
              actorUserId: actorId,
              action: "reactivate",
              expectedRevision: current.revision,
              resultingRevision: finalRestriction.revision,
            });
          const retainedAfterRestoration = evidence();
          expect(retainedAfterRestoration).toEqual(retainedBeforeRestoration);
          const suspensionRetainedPendingGraphPath = testInfo.outputPath(
            "suspension-retained-pending-graph.json",
          );
          await writeFile(
            suspensionRetainedPendingGraphPath,
            JSON.stringify({
              actorId,
              commandId,
              expectedRevision,
              reference,
              suspensionActionId: suspension?.id ?? null,
              reactivationActionId,
              finalRestriction,
              evidence: retainedAfterRestoration,
            }),
          );
          await testInfo.attach("suspension-retained-pending-graph", {
            path: suspensionRetainedPendingGraphPath,
            contentType: "application/json",
          });
        } catch (error) {
          if (failed)
            testInfo.annotations.push({
              type: "fixture restoration failed",
              description:
                error instanceof Error ? error.message : String(error),
            });
          else {
            failed = true;
            failure = error;
          }
        }
      }
      if (failed) throw failure;
    });
  await ownerContext.close();
});
