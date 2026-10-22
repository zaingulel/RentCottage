import { expect, test, type Locator, type Page } from "@playwright/test";
import { accessMessages } from "../src/i18n/access-messages";
import { cottageProfileMessages } from "../src/i18n/cottage-profile-messages";
import { cottageShiftScheduleMessages } from "../src/i18n/cottage-shift-schedule-messages";
import { cottagePricingAvailabilityMessages } from "../src/i18n/cottage-pricing-availability-messages";
import { openHeaderPanel } from "./fixtures/site-header";
import { writeFile } from "node:fs/promises";
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { crc32 } from "node:zlib";
import * as OTPAuth from "otpauth";
import { createClient } from "@supabase/supabase-js";
import {
  type OwnedAccessJourney,
  prepareOwnedAccessJourney,
} from "../scripts/access-journey-playwright";

const { uuidPattern } = createRequire(import.meta.url)(
  "../scripts/lib/access-journey-fixtures.mjs",
) as { uuidPattern: RegExp };
const { createLocalSupabaseConcurrencyHarness } = createRequire(
  import.meta.url,
)("../scripts/local-supabase-concurrency-harness.mjs") as {
  createLocalSupabaseConcurrencyHarness(): {
    guardDisposableLocalDatabase(): void;
    runSql(sql: string): string;
  };
};

type BrowserLocale = "en" | "ar" | "ckb";

type AccessBrowserFixture = {
  exactAddress: string;
  reviewLegalName: string;
  reviewOwnerPhone: string;
  bookingOwnerPhone: string;
  bookingCottageName: string;
};

const {
  accessBrowserFixture,
  ACCESS_REVIEW_DOCUMENT_FILENAME: reviewDocumentFilename,
} = createRequire(import.meta.url)(
  "../scripts/lib/access-browser-fixtures.mjs",
) as {
  accessBrowserFixture(project: string): AccessBrowserFixture;
  ACCESS_REVIEW_DOCUMENT_FILENAME: string;
};
type AccessFixtureUser = {
  id: string;
  email?: string | null;
  phone?: string | null;
};
const { findAccessFixtureUser, listAllAccessFixtureUsers } = createRequire(
  import.meta.url,
)("../scripts/lib/access-fixture-users.mjs") as {
  findAccessFixtureUser(
    users: AccessFixtureUser[],
    phone: string,
  ): AccessFixtureUser | undefined;
  listAllAccessFixtureUsers(admin: unknown): Promise<AccessFixtureUser[]>;
};

type BrowserApplicationFixture = {
  privacyNote: string;
  documentsSection: string;
  documentRules: string;
  documentTitles: readonly [string, string, string, string];
  legalName: string;
  cottageName: string;
  governorate: string;
  approximateLocation: string;
  exactAddress: string;
  capacity: string;
  bedrooms: string;
  bathrooms: string;
  description: string;
  houseRules: string;
  garden: string;
  parking: string;
  saveDraft: string;
  saved: string;
  submit: string;
  incompleteTitle: string;
  submittedStatus: string;
  upload: string;
  replace: string;
  uploaded: string;
  invalidDocument: string;
  syntheticLayoutAlert: string;
};

const browserFixtures: Record<
  BrowserLocale,
  {
    access: {
      phone: string;
      sendCode: string;
      code: string;
      verify: string;
      enroll: string;
    };
    application: BrowserApplicationFixture;
    review: {
      title: string;
      createLink: string;
      openDocument: string;
    };
  }
> = {
  en: {
    access: {
      phone: "Iraqi phone number",
      sendCode: "Send verification code",
      code: "Verification code",
      verify: "Verify",
      enroll: "Start owner application",
    },
    application: {
      privacyNote:
        "Verification files are never published or translated. Secure links expire within 60 seconds and every access is recorded.",
      documentsSection: "Private verification documents",
      documentRules: "PDF, JPEG, or PNG · maximum 5 MB",
      documentTitles: [
        "Identity evidence",
        "Authority-to-rent evidence",
        "Licence or exemption evidence",
        "Payout-account evidence",
      ],
      legalName: "Legal name",
      cottageName: "Cottage name",
      governorate: "Governorate",
      approximateLocation: "Approximate public area",
      exactAddress: "Exact private address",
      capacity: "Guest capacity",
      bedrooms: "Bedrooms",
      bathrooms: "Bathrooms",
      description: "Cottage description",
      houseRules: "House Rules",
      garden: "Garden",
      parking: "Parking",
      saveDraft: "Save draft",
      saved: "Draft saved.",
      submit: "Submit application",
      incompleteTitle: "Complete these items before submitting:",
      submittedStatus: "Submitted for review",
      upload: "Upload document",
      replace: "Replace document",
      uploaded: "Private document saved.",
      invalidDocument: "Choose a PDF, JPEG, or PNG no larger than 5 MB.",
      syntheticLayoutAlert:
        "Synthetic geometry fixture: this intentionally long private-document validation detail must wrap across several lines so the shared feedback row is measured under unequal content heights.",
    },
    review: {
      title: "Submitted Owner Applications",
      createLink: "Create secure link",
      openDocument: "Open secure document",
    },
  },
  ar: {
    access: {
      phone: "رقم الهاتف العراقي",
      sendCode: "أرسل رمز التحقق",
      code: "رمز التحقق",
      verify: "تحقق",
      enroll: "ابدأ طلب الانضمام كمالك",
    },
    application: {
      privacyNote:
        "لا تُنشر وثائق التحقق ولا تُرسل للترجمة. تنتهي صلاحية الرابط الآمن خلال 60 ثانية ويُسجّل كل وصول.",
      documentsSection: "وثائق التحقق الخاصة",
      documentRules: "PDF أو JPEG أو PNG · بحد أقصى 5 ميغابايت",
      documentTitles: [
        "إثبات الهوية",
        "إثبات صلاحية التأجير",
        "إثبات الترخيص أو الإعفاء",
        "إثبات حساب التحويل",
      ],
      legalName: "الاسم القانوني",
      cottageName: "اسم البيت",
      governorate: "المحافظة",
      approximateLocation: "المنطقة التقريبية العامة",
      exactAddress: "العنوان الدقيق الخاص",
      capacity: "سعة الضيوف",
      bedrooms: "غرف النوم",
      bathrooms: "الحمّامات",
      description: "وصف البيت",
      houseRules: "قواعد البيت",
      garden: "حديقة",
      parking: "موقف سيارات",
      saveDraft: "احفظ المسودة",
      saved: "حُفظت المسودة.",
      submit: "أرسل الطلب",
      incompleteTitle: "أكمل هذه العناصر قبل الإرسال:",
      submittedStatus: "أُرسل للمراجعة",
      upload: "ارفع الوثيقة",
      replace: "استبدل الوثيقة",
      uploaded: "حُفظت الوثيقة الخاصة.",
      invalidDocument: "اختر PDF أو JPEG أو PNG بحجم لا يتجاوز 5 ميغابايت.",
      syntheticLayoutAlert:
        "تركيبة هندسية اصطناعية: هذه التفاصيل الطويلة لاختبار تخطيط التحقق من الوثيقة الخاصة يجب أن تلتف عبر عدة أسطر لقياس صف الملاحظات المشتركة بارتفاعات محتوى مختلفة.",
    },
    review: {
      title: "طلبات المالك المرسلة",
      createLink: "أنشئ رابطاً آمناً",
      openDocument: "افتح الوثيقة الآمنة",
    },
  },
  ckb: {
    access: {
      phone: "ژمارە تەلەفۆنی عێراقی",
      sendCode: "کۆدی پشتڕاستکردنەوە بنێرە",
      code: "کۆدی پشتڕاستکردنەوە",
      verify: "پشتڕاست بکەرەوە",
      enroll: "داواکاری خاوەن دەست پێ بکە",
    },
    application: {
      privacyNote:
        "بەڵگەکانی پشتڕاستکردنەوە بڵاوناکرێنەوە و وەرناگێڕدرێن. بەستەری پارێزراو لە ماوەی 60 چرکەدا بەسەر دەچێت و هەر دەستگەیشتنێک تۆمار دەکرێت.",
      documentsSection: "بەڵگە تایبەتەکانی پشتڕاستکردنەوە",
      documentRules: "PDF یان JPEG یان PNG · تا 5 مێگابایت",
      documentTitles: [
        "بەڵگەی ناسنامە",
        "بەڵگەی مافی بەکرێدان",
        "بەڵگەی مۆڵەت یان معافبوون",
        "بەڵگەی هەژماری پارەدان",
      ],
      legalName: "ناوی یاسایی",
      cottageName: "ناوی ماڵ",
      governorate: "پارێزگا",
      approximateLocation: "ناوچەی گشتیی نزیکەیی",
      exactAddress: "ناونیشانی وردی تایبەت",
      capacity: "گنجایشی میوان",
      bedrooms: "ژووری نوستن",
      bathrooms: "حەمام",
      description: "وەسفی ماڵ",
      houseRules: "یاساکانی ماڵ",
      garden: "باخچە",
      parking: "وەستانگە",
      saveDraft: "ڕەشنووس پاشەکەوت بکە",
      saved: "ڕەشنووس پاشەکەوت کرا.",
      submit: "داواکاری بنێرە",
      incompleteTitle: "پێش ناردن ئەم خاڵانە تەواو بکە:",
      submittedStatus: "بۆ پێداچوونەوە نێردرا",
      upload: "بەڵگە باربکە",
      replace: "بەڵگە بگۆڕە",
      uploaded: "بەڵگەی تایبەت پاشەکەوت کرا.",
      invalidDocument: "PDF یان JPEG یان PNG تا 5 مێگابایت هەڵبژێرە.",
      syntheticLayoutAlert:
        "تاقیکردنەوەی ئەندازیاری دەستکرد: ئەم وردەکارییە درێژەیەی پشتڕاستکردنەوەی بەڵگەی تایبەت دەبێت لە چەند دێڕێکدا بپێچرێتەوە بۆ پێوانەکردنی ڕیزی هاوبەشی تێبینییەکان بە بەرزی ناهاوشێوەی ناوەڕۆک.",
    },
    review: {
      title: "داواکارییە نێردراوەکانی خاوەن",
      createLink: "بەستەری پارێزراو دروست بکە",
      openDocument: "بەڵگەنامە پارێزراوەکە بکەرەوە",
    },
  },
};

const auditClient = createClient(
  process.env.SUPABASE_URL ?? "",
  process.env.SUPABASE_SECRET_KEY ?? "",
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const cleanCottagePhoto = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function pngChunk(type: string, data: Buffer) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, checksum]);
}

const pngSignature = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const endOfPngHeader = 33;
const locatedCottagePhoto = Buffer.concat([
  cleanCottagePhoto.subarray(0, endOfPngHeader),
  pngChunk(
    "eXIf",
    Buffer.from(
      "4d4d002a00000008000201120003000000010001000088250004000000010000002600000000000400010002000000024e00000000020005000000030000005c00030002000000024500000000040005000000030000007400000000" +
        "0000000000000001".repeat(6),
      "hex",
    ),
  ),
  pngChunk(
    "tEXt",
    Buffer.from("Comment\0Fictional location: Null Island 0N 0E", "latin1"),
  ),
  cleanCottagePhoto.subarray(endOfPngHeader),
]);

function assertIsolatedLocalAccessDatabase() {
  const target = new URL(process.env.SUPABASE_URL ?? "invalid:");
  if (
    process.env.APP_ENVIRONMENT !== "test" ||
    target.protocol !== "http:" ||
    target.hostname !== "127.0.0.1"
  ) {
    throw new Error(
      "Discovery fixture mutation requires the isolated local access database",
    );
  }
}

async function setWorkerTranslationRuntimeReady(productionReady: boolean) {
  const { error } = await auditClient
    .from("cottage_translation_runtime_control")
    .update(
      productionReady
        ? {
            production_ready: true,
            approved_evaluation_artifact_digest: "a".repeat(64),
            production_approval_digest: "b".repeat(64),
            provider_terms_approval_reference: "worker-access-fixture",
            native_review_approval_reference: "worker-access-fixture",
            quality_threshold_approval_reference: "worker-access-fixture",
            ordinary_model: "deterministic-fixture",
            ordinary_effort: "none",
            ordinary_prompt_version: "worker-access-v1",
            stronger_model: "deterministic-fixture",
            stronger_effort: "none",
            stronger_prompt_version: "worker-access-v1",
            judge_model: "deterministic-fixture",
            judge_effort: "none",
            judge_prompt_version: "worker-access-v1",
            monthly_request_limit: 100,
            monthly_token_limit: 100_000,
            monthly_spend_microusd_limit: 1_000_000,
          }
        : { production_ready: false },
    )
    .eq("singleton", true);
  if (error) throw error;
}

async function prepareWorkerTranslations(reviewCycleId: string) {
  await setWorkerTranslationRuntimeReady(true);
  try {
    for (const targetLanguage of ["ar", "ckb"] as const) {
      const { data: attempt, error: beginError } = await auditClient.rpc(
        "begin_cottage_profile_translation_execution",
        {
          target_review_cycle_id: reviewCycleId,
          target_language: targetLanguage,
          target_route: "ordinary",
          target_lease_milliseconds: 50_000,
        },
      );
      if (beginError) throw beginError;
      const { data: completed, error: completionError } = await auditClient.rpc(
        "complete_cottage_profile_translation_execution",
        {
          target_attempt_id: attempt.id,
          target_lease_token: attempt.lease_token,
          translated_description: `${targetLanguage} reviewed description`,
          translated_house_rules: `${targetLanguage} reviewed House Rules`,
          returned_provider: "worker-access-fixture",
          returned_model: "deterministic-fixture",
          returned_effort: "test",
          returned_prompt_version: "worker-access-v1",
        },
      );
      if (completionError) throw completionError;
      expect(completed).toBe(true);
    }
  } finally {
    await setWorkerTranslationRuntimeReady(false);
  }
}

function expectedEmailDigest(email: string) {
  return createHmac("sha256", process.env.PRIVILEGED_AUDIT_HMAC_KEY ?? "")
    .update(email.trim().toLowerCase())
    .digest("hex");
}

async function administratorId(email: string) {
  const users = await listAllAccessFixtureUsers(auditClient.auth.admin);
  const userId = users.find((user) => user.email === email)?.id;
  if (!userId) throw new Error(`No test administrator exists for ${email}`);
  return userId;
}

async function bookingFixtureCoverPhotoPath(fixture: AccessBrowserFixture) {
  const owner = findAccessFixtureUser(
    await listAllAccessFixtureUsers(auditClient.auth.admin),
    fixture.bookingOwnerPhone,
  );
  if (!owner) throw new Error("Booking fixture owner is unavailable");
  const { data: publications, error: publicationError } = await auditClient
    .from("cottage_publication_snapshots")
    .select("profile_id")
    .eq("name", fixture.bookingCottageName);
  if (publicationError) throw publicationError;
  const profileIds = new Set(publications.map(({ profile_id }) => profile_id));
  if (profileIds.size !== 1)
    throw new Error("Booking fixture Cottage Profile is not exactly one");
  const { data: photos, error: photoError } = await auditClient
    .from("cottage_profile_photos")
    .select("id")
    .eq("profile_id", [...profileIds][0])
    .eq("owner_user_id", owner.id)
    .eq("state", "ready");
  if (photoError) throw photoError;
  if (photos.length !== 1)
    throw new Error("Booking fixture Cottage Profile photo is not exactly one");
  return `/api/cottage-profile-photos/${photos[0].id}`;
}

async function currentAudit(
  actorUserId: string,
  attemptedAfter: string,
  stage: "primary" | "mfa",
  outcome: "succeeded" | "failed",
) {
  const { data, error } = await auditClient
    .from("privileged_sign_in_attempts")
    .select("id, actor_user_id, email_digest, attempted_at")
    .eq("actor_user_id", actorUserId)
    .eq("stage", stage)
    .eq("outcome", outcome)
    .gte("attempted_at", attemptedAfter)
    .order("attempted_at", { ascending: false })
    .limit(1)
    .single();
  if (error) throw error;
  return data;
}

async function currentDocumentAccessAudit(
  actorUserId: string,
  occurredAfter: string,
) {
  const { data, error } = await auditClient
    .from("owner_verification_document_audit")
    .select(
      "id, document_id, actor_user_id, actor_subject_id, action, object_path, occurred_at",
    )
    .eq("actor_subject_id", actorUserId)
    .eq("action", "access_granted")
    .gte("occurred_at", occurredAfter)
    .order("occurred_at", { ascending: false })
    .limit(1)
    .single();
  if (error) throw error;
  return data;
}

function quoteCustomerPhone(projectName: string) {
  const phones: Record<string, string> = {
    mobile: "+9647592600000",
    desktop: "+9647592600001",
    worker: "+9647592600002",
  };
  const phone = phones[projectName];
  if (!phone) throw new Error(`Unmapped Playwright project: ${projectName}`);
  return phone;
}

async function openOwnerApplication(
  page: Page,
  locale: BrowserLocale,
  phone: string,
) {
  const copy = browserFixtures[locale].access;
  await page.goto(`/${locale}/owner/access`);
  await page.getByLabel(copy.phone).fill(phone);
  await page.getByRole("button", { name: copy.sendCode }).click();
  await page.getByLabel(copy.code).fill("123456");
  await page.getByRole("button", { name: copy.verify }).click();
  const step = accessMessages[locale];
  await expect(
    page.getByRole("heading", { name: step.accountNameStepTitle }),
  ).toBeVisible();
  await page.getByLabel(step.firstName, { exact: true }).fill("Avan");
  await page.getByRole("button", { name: step.saveAndContinue }).click();
  await expect(page.getByRole("button", { name: copy.enroll })).toBeVisible();
  await page.getByRole("button", { name: copy.enroll }).click();
  await expect(page).toHaveURL(new RegExp(`/${locale}/owner/application$`));
}

async function saveOwnerApplicationDraft(
  page: Page,
  copy: BrowserApplicationFixture,
  values: {
    legalName: string;
    cottageName: string;
    governorate: string;
    approximateLocation: string;
    exactAddress: string;
    capacity: string;
    bedrooms: string;
    bathrooms: string;
    description: string;
    houseRules: string;
  },
) {
  for (const [label, value] of [
    [copy.legalName, values.legalName],
    [copy.cottageName, values.cottageName],
    [copy.governorate, values.governorate],
    [copy.approximateLocation, values.approximateLocation],
    [copy.exactAddress, values.exactAddress],
    [copy.capacity, values.capacity],
    [copy.bedrooms, values.bedrooms],
    [copy.bathrooms, values.bathrooms],
    [copy.description, values.description],
    [copy.houseRules, values.houseRules],
  ]) {
    await page.getByLabel(label).fill(value);
  }
  for (const label of [copy.garden, copy.parking]) {
    await page.getByLabel(label).check();
  }
  const draftControl = page.getByRole("button", { name: copy.saveDraft });
  await draftControl.focus();
  await expect(draftControl).toBeFocused();
  const draftSource = await draftControl.elementHandle();
  if (!draftSource) throw new Error("Focus source is missing");
  await draftControl.press("Enter");
  await expect(page.getByRole("status")).toContainText(copy.saved);
  await expect(draftControl).toBeFocused();
  expect(
    await draftSource.evaluate((source) => document.activeElement === source),
  ).toBe(true);
  await draftSource.dispose();

  await page.reload();
}

async function tabTo(page: Page, target: Locator) {
  const budget = await page.evaluate(
    () =>
      document.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ).length + 5,
  );
  for (let index = 0; index < budget; index += 1) {
    await page.keyboard.press("Tab");
    if (
      await target.evaluate((element) => document.activeElement === element)
    ) {
      await expect(target).toBeFocused();
      expect(
        await target.evaluate((element) => {
          const style = getComputedStyle(element);
          const outlineColor = style.outlineColor.replaceAll(" ", "");
          const opaqueOutline =
            style.outlineStyle !== "none" &&
            Number.parseFloat(style.outlineWidth) > 0 &&
            outlineColor !== "transparent" &&
            outlineColor !== "rgba(0,0,0,0)";
          return opaqueOutline || style.boxShadow !== "none";
        }),
      ).toBe(true);
      return;
    }
  }
  throw new Error("Keyboard focus did not reach the expected control");
}

async function expectCottageProfileSectionTitlesAligned(
  page: Page,
  sectionNames: readonly string[],
) {
  const editor = page.locator("section.cottage-profile-editor");
  for (const sectionName of sectionNames) {
    await expect(
      editor.getByRole("group", { name: sectionName, exact: true }),
    ).toBeVisible();
  }
  const fieldsets = editor.locator(":scope > .cottage-profile-form > fieldset");
  await expect(fieldsets).toHaveCount(sectionNames.length);
  await expect
    .poll(() =>
      fieldsets.evaluateAll((sections) => {
        const rtl = document.documentElement.dir === "rtl";
        const inlineStart = (rect: DOMRect) => (rtl ? rect.right : rect.left);
        const stacked = window.matchMedia("(max-width: 47.5rem)").matches;
        const padding = 20;
        return sections.map((fieldset) => {
          const heading = fieldset.querySelector(
            ":scope > .cottage-profile-section-heading",
          );
          const card = fieldset.querySelector(
            ":scope > .cottage-profile-field-card.card",
          );
          const titleId = fieldset.getAttribute("aria-labelledby");
          const title = titleId ? document.getElementById(titleId) : null;
          const firstLabel = card?.querySelector(":scope > label");
          if (
            !heading ||
            !card ||
            !title ||
            !heading.contains(title) ||
            !firstLabel
          )
            return false;
          const headingRect = heading.getBoundingClientRect();
          const cardRect = card.getBoundingClientRect();
          const labelRect = firstLabel.getBoundingClientRect();
          const labelInset = Math.abs(
            inlineStart(labelRect) - inlineStart(cardRect),
          );
          return (
            (stacked
              ? cardRect.top >= headingRect.bottom &&
                Math.abs(inlineStart(headingRect) - inlineStart(cardRect)) <=
                  0.5
              : Math.abs(headingRect.top - cardRect.top) <= 0.5 &&
                (rtl
                  ? cardRect.right <= headingRect.left
                  : cardRect.left >= headingRect.right)) &&
            Math.abs(labelInset - padding - 1) <= 0.5 &&
            Math.abs(labelRect.top - cardRect.top - padding - 1) <= 0.5 &&
            labelRect.left >= cardRect.left &&
            labelRect.right <= cardRect.right
          );
        });
      }),
    )
    .toEqual(sectionNames.map(() => true));
}

async function expectCottageProfileActionHierarchy(
  page: Page,
  actionNames: readonly [string, string, string],
  projectName: string,
) {
  const editor = page.locator("section.cottage-profile-editor");
  for (const name of actionNames) {
    await expect(
      editor.getByRole("button", { name, exact: true }),
    ).toBeVisible();
  }
  const metrics = await Promise.all(
    actionNames.map((name) =>
      editor.getByRole("button", { name, exact: true }).evaluate((button) => {
        const parent = button.parentElement;
        if (!parent) throw new Error("Cottage Profile action has no parent");
        const style = getComputedStyle(button);
        const buttonRect = button.getBoundingClientRect();
        const parentRect = parent.getBoundingClientRect();
        const direction = getComputedStyle(parent).direction;
        return {
          widthRatio: buttonRect.width / parentRect.width,
          logicalEndOffset:
            direction === "rtl"
              ? Math.abs(buttonRect.left - parentRect.left)
              : Math.abs(parentRect.right - buttonRect.right),
          backgroundColor: style.backgroundColor,
          borderColor: style.borderColor,
          borderStyle: style.borderStyle,
          borderWidth: Number.parseFloat(style.borderWidth),
          color: style.color,
        };
      }),
    ),
  );
  const isMobile = projectName === "mobile";
  for (const metric of metrics) {
    if (isMobile) expect(metric.widthRatio).toBeGreaterThanOrEqual(0.98);
    else {
      expect(metric.widthRatio).toBeLessThanOrEqual(0.5);
      expect(metric.logicalEndOffset).toBeLessThanOrEqual(0.5);
    }
  }
  const [save, upload, submit] = metrics;
  for (const primary of [save, submit]) {
    expect(primary.backgroundColor).toBe("rgb(34, 64, 47)");
    expect(primary.color).toBe("rgb(247, 241, 225)");
  }
  expect(upload.backgroundColor).toBe("rgb(255, 252, 245)");
  expect(upload.color).toBe("rgb(34, 64, 47)");
  expect(upload.borderStyle).toBe("solid");
  expect(upload.borderWidth).toBeGreaterThanOrEqual(1);
  expect(upload.borderColor).toBe("rgba(34, 64, 47, 0.3)");
}

function documentActionFor(card: Locator, copy: BrowserApplicationFixture) {
  return card
    .getByRole("button", { name: copy.upload, exact: true })
    .or(card.getByRole("button", { name: copy.replace, exact: true }));
}

const { accessJourneyCases } = createRequire(import.meta.url)(
  "../scripts/lib/access-journey-fixtures.mjs",
) as {
  accessJourneyCases: ReadonlyArray<{
    journey: OwnedAccessJourney;
    title: string;
  }>;
};
type OwnedJourneyCallback = Parameters<typeof test>[2];
const ownedJourneyCallbacks = new Map<
  OwnedAccessJourney,
  OwnedJourneyCallback
>();

function registerOwnedJourney(
  journey: OwnedAccessJourney,
  callback: OwnedJourneyCallback,
) {
  const fixtureCase = accessJourneyCases.find((row) => row.journey === journey);
  if (!fixtureCase || ownedJourneyCallbacks.has(journey)) {
    throw new Error(`Unknown or duplicate owned journey callback: ${journey}`);
  }
  ownedJourneyCallbacks.set(journey, callback);
  if (process.env.ACCESS_JOURNEY_PHASE !== "reverse") {
    test(fixtureCase.title, callback);
  }
}

test.describe.configure({ mode: "serial" });

test("the fictional booking-request back door is unavailable", async ({
  page,
}) => {
  const response = await page.goto("/en/request/garden-house");
  expect(response?.status()).toBe(404);
});

registerOwnedJourney("signin", async ({ page }, testInfo) => {
  const fixture = await prepareOwnedAccessJourney("signin", testInfo);
  await page.goto("/ckb");
  await openHeaderPanel(page, "menu");
  await page
    .getByRole("banner")
    .getByRole("link", { name: "کۆتێجەکەت تۆمار بکە", exact: true })
    .click();
  await expect(page).toHaveURL(/\/ckb\/access\?returnTo=/);
  await page.getByLabel("ژمارە تەلەفۆنی عێراقی").fill(fixture.phone);
  await page.getByRole("button", { name: "کۆدی پشتڕاستکردنەوە بنێرە" }).click();
  await page.getByLabel("کۆدی پشتڕاستکردنەوە").fill("123456");
  await page.getByRole("button", { name: "پشتڕاست بکەرەوە" }).click();

  await expect(page).toHaveURL(/\/ckb\/owner\/application$/);
  await expect(
    page.getByLabel(browserFixtures.ckb.application.legalName),
  ).toHaveValue("Access Journey Draft Owner");
  await expect(
    page.getByRole("button", { name: "زیادکردنی کۆتێج" }),
  ).toHaveCount(0);
});

test("Arabic access renders right to left", async ({ page }) => {
  await page.goto("/ar/owner/access");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByLabel("رقم الهاتف العراقي")).toBeVisible();
});

registerOwnedJourney("owner-submit", async ({ browser, page }, testInfo) => {
  const fixture = await prepareOwnedAccessJourney("owner-submit", testInfo);
  await openOwnerApplication(page, "en", fixture.phone);
  expect(
    (await page.context().cookies()).some((cookie) =>
      cookie.name.startsWith("rentcottage-auth"),
    ),
  ).toBe(true);
  await saveOwnerApplicationDraft(page, browserFixtures.en.application, {
    legalName: "Zana Kareem",
    cottageName: "Garden House",
    governorate: "Erbil",
    approximateLocation: "Shaqlawa countryside",
    exactAddress: "Near the eastern orchard road",
    capacity: "8",
    bedrooms: "3",
    bathrooms: "2",
    description: "A quiet family cottage surrounded by fruit trees.",
    houseRules: "Families only. No amplified music after 10pm.",
  });
  await expect(page.getByLabel("Legal name")).toHaveValue("Zana Kareem");
  await expect(page.getByLabel("Cottage name")).toHaveValue("Garden House");
  await expect(page.getByLabel("Garden")).toBeChecked();
  await expect(page.getByLabel("Parking")).toBeChecked();

  const originalIdentityBytes = Buffer.concat([
    Buffer.from("%PDF-1.7\n"),
    Buffer.alloc(1_099_980),
    Buffer.from("\n%%EOF"),
  ]);
  const evidence = [
    ["Identity evidence", reviewDocumentFilename],
    ["Authority-to-rent evidence", "authority.pdf"],
    ["Licence or exemption evidence", "licence.pdf"],
    ["Payout-account evidence", "payout.pdf"],
  ] as const;
  for (const [label, filename] of evidence) {
    const card = page.getByRole("article", { name: label });
    await card.locator('input[type="file"]').setInputFiles({
      name: filename,
      mimeType: "application/pdf",
      buffer:
        filename === reviewDocumentFilename
          ? originalIdentityBytes
          : Buffer.from("%PDF-1.7\nprivate-test-document\n%%EOF"),
    });
    const uploadControl = card.getByRole("button", { name: "Upload document" });
    await uploadControl.focus();
    await expect(uploadControl).toBeFocused();
    const uploadSource = await uploadControl.elementHandle();
    if (!uploadSource) throw new Error("Focus source is missing");
    await uploadControl.press("Enter");
    await expect(card.getByRole("status")).toContainText(
      browserFixtures.en.application.uploaded,
    );
    await expect(
      card.getByRole("button", { name: "Replace document", exact: true }),
    ).toBeFocused();
    expect(
      await uploadSource.evaluate(
        (source) => document.activeElement === source,
      ),
    ).toBe(true);
    await uploadSource.dispose();

    await expect(
      page.getByRole("article", { name: label }).getByText(filename),
    ).toBeVisible();
  }

  const applicationSubmitControl = page.getByRole("button", {
    name: "Submit application",
  });
  await applicationSubmitControl.focus();
  await expect(applicationSubmitControl).toBeFocused();
  await applicationSubmitControl.press("Enter");
  await expect(
    page.locator(".owner-review-status").getByText("Submitted for review"),
  ).toBeVisible();
  await expect(page.getByLabel("Legal name")).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Submit application" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", {
      name: "Prepare your Owner Application",
      exact: true,
    }),
  ).toBeFocused();

  await expect(page.getByRole("button", { name: /publish/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /booking/i })).toHaveCount(0);

  await expect(page.getByRole("link", { name: /secure link/i })).toHaveCount(0);

  assertIsolatedLocalAccessDatabase();
  const users = await listAllAccessFixtureUsers(auditClient.auth.admin);
  const ownedUser = findAccessFixtureUser(users, fixture.phone);
  const ownerUserId = ownedUser?.id;
  if (!ownerUserId || !uuidPattern.test(ownerUserId)) {
    throw new Error("Owned submitted user is missing or malformed");
  }
  const database = createLocalSupabaseConcurrencyHarness();
  database.guardDisposableLocalDatabase();
  const applications = JSON.parse(
    database.runSql(`select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'owner_user_id', owner_user_id, 'status', status
    )), '[]'::jsonb) from public.owner_applications
    where owner_user_id = '${ownerUserId}'::uuid;`),
  ) as { id: string; owner_user_id: string; status: string }[];
  if (
    applications.length !== 1 ||
    applications[0].owner_user_id !== ownerUserId ||
    applications[0].status !== "submitted" ||
    !uuidPattern.test(applications[0].id)
  ) {
    throw new Error("Owned application was not submitted");
  }
  const application = applications[0];
  const applicationId = application.id;
  const documents = JSON.parse(
    database.runSql(`select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'application_id', application_id, 'kind', kind,
      'object_path', object_path, 'original_filename', original_filename,
      'size_bytes', size_bytes
    )), '[]'::jsonb) from public.owner_verification_documents
    where application_id = '${applicationId}'::uuid;`),
  ) as {
    id: string;
    application_id: string;
    kind: string;
    object_path: string;
    original_filename: string;
    size_bytes: number;
  }[];
  if (documents.length !== evidence.length) {
    throw new Error("Owned verification documents are incomplete");
  }
  const identityDocument = documents.find((row) => row.kind === "identity");
  const alternateDocument = documents.find(
    (row) => row.kind === "authority_to_rent",
  );
  if (
    !identityDocument?.id ||
    !uuidPattern.test(identityDocument.id) ||
    identityDocument.application_id !== applicationId ||
    !identityDocument.object_path ||
    identityDocument.original_filename !== reviewDocumentFilename ||
    identityDocument.size_bytes !== originalIdentityBytes.length ||
    !alternateDocument?.object_path ||
    !uuidPattern.test(alternateDocument.id) ||
    alternateDocument.application_id !== applicationId
  ) {
    throw new Error("Owned identity or alternate document is malformed");
  }
  const identityDocumentId = identityDocument.id;

  const administratorEmail = `review-${ownerUserId}@rentcottage.test`;
  const { data: administrator, error: createError } =
    await auditClient.auth.admin.createUser({
      email: administratorEmail,
      password: "Local-test-password-2026",
      email_confirm: true,
    });
  if (createError || !administrator.user?.id) {
    throw new Error("Owned administrator creation failed", {
      cause: createError,
    });
  }
  const administratorId = administrator.user.id;
  const provision = await auditClient.rpc("provision_platform_administrator", {
    target_user_id: administratorId,
  });
  if (provision.error) throw provision.error;

  const administratorContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    viewport: page.viewportSize() ?? undefined,
  });
  try {
    const administratorPage = await administratorContext.newPage();
    await administratorPage.goto("/en/administrator/access");
    await administratorPage.getByLabel("Email").fill(administratorEmail);
    await administratorPage
      .getByLabel("Password")
      .fill("Local-test-password-2026");
    await administratorPage.getByRole("button", { name: "Continue" }).click();
    const secret = await administratorPage
      .getByTestId("mfa-secret")
      .textContent();
    if (!secret) throw new Error("Owned administrator MFA enrollment failed");
    await administratorPage.getByLabel("Authenticator app code").fill(
      new OTPAuth.TOTP({
        secret: OTPAuth.Secret.fromBase32(secret),
      }).generate(),
    );
    await administratorPage.getByRole("button", { name: "Verify" }).click();
    await expect(
      administratorPage.getByRole("heading", { name: "Add your first name" }),
    ).toBeVisible();
    await administratorPage
      .getByLabel("First name", { exact: true })
      .fill("Sara");
    await administratorPage
      .getByRole("button", { name: "Save and continue" })
      .click();
    await expect(
      administratorPage.getByText(/Administrator access is ready/),
    ).toBeVisible();
    const administratorMain = administratorPage.getByRole("main");
    for (const [name, href] of [
      [
        "Review submitted Owner Applications",
        "/en/administrator/owner-applications",
      ],
      ["Manage Cottage Profiles", "/en/administrator/cottages"],
      ["Records", "/en/administrator/records"],
    ]) {
      await expect(
        administratorMain.getByRole("link", { name }),
      ).toHaveAttribute("href", href);
    }
    await expect(
      administratorPage.locator("#site-header-account-button .account-avatar"),
    ).toHaveText("S");

    async function openOwnedIdentity(
      locale: BrowserLocale,
      filename: string,
      objectPath: string,
      expectedBytes: Buffer,
    ) {
      await administratorPage.goto(
        `/${locale}/administrator/owner-applications/${applicationId}`,
      );
      await expect(administratorPage.locator("html")).toHaveAttribute(
        "dir",
        locale === "en" ? "ltr" : "rtl",
      );
      const row = administratorPage
        .locator(".administrator-review-documents li")
        .filter({ hasText: filename });
      await expect(row).toHaveCount(1);
      const createLink = row.getByRole("button", {
        name: browserFixtures[locale].review.createLink,
      });
      await tabTo(administratorPage, createLink);
      await administratorPage.keyboard.press("Enter");
      const link = row.getByRole("link", {
        name: browserFixtures[locale].review.openDocument,
      });
      await expect(link).toBeVisible();
      await expect(createLink).toBeFocused();
      const href = await link.getAttribute("href");
      if (!href) throw new Error("Owned secure link has no URL");
      const signedUrl = new URL(href, administratorPage.url());
      expect(decodeURIComponent(signedUrl.pathname)).toContain(
        `/owner-verification/${objectPath}`,
      );

      const { data: grant, error: grantError } = await auditClient
        .from("owner_verification_document_access_grants")
        .select(
          "id, document_id, document_subject_id, actor_user_id, actor_subject_id, object_path, status, completed_at",
        )
        .eq("document_id", identityDocumentId)
        .eq("actor_subject_id", administratorId)
        .eq("object_path", objectPath)
        .order("prepared_at", { ascending: false })
        .limit(1)
        .single();
      if (grantError || !grant?.id || !grant.completed_at) {
        throw new Error("Owned document grant is missing", {
          cause: grantError,
        });
      }
      expect(grant).toMatchObject({
        document_id: identityDocumentId,
        document_subject_id: identityDocumentId,
        actor_user_id: administratorId,
        actor_subject_id: administratorId,
        object_path: objectPath,
        status: "completed",
      });
      const { data: accessAudit, error: auditError } = await auditClient
        .from("owner_verification_document_audit")
        .select(
          "access_grant_id, document_id, actor_user_id, actor_subject_id, action, object_path, access_expires_at",
        )
        .eq("access_grant_id", grant.id)
        .single();
      if (auditError || !accessAudit?.access_expires_at) {
        throw new Error("Owned document access audit is missing", {
          cause: auditError,
        });
      }
      expect(accessAudit).toMatchObject({
        access_grant_id: grant.id,
        document_id: identityDocumentId,
        actor_user_id: administratorId,
        actor_subject_id: administratorId,
        action: "access_granted",
        object_path: objectPath,
      });
      expect(
        new Date(accessAudit.access_expires_at).getTime() -
          new Date(grant.completed_at).getTime(),
      ).toBe(60_000);

      let resolveOpened!: (result: {
        status: number;
        contentType: string | undefined;
        bytes: Buffer;
      }) => void;
      let rejectOpened!: (error: unknown) => void;
      const openedResponse = new Promise<{
        status: number;
        contentType: string | undefined;
        bytes: Buffer;
      }>((resolve, reject) => {
        resolveOpened = resolve;
        rejectOpened = reject;
      });
      const timeout = setTimeout(
        () =>
          rejectOpened(new Error("Owned document navigation was not routed")),
        15_000,
      );
      await administratorContext.route(signedUrl.href, async (route) => {
        try {
          expect(route.request().method()).toBe("GET");
          expect(route.request().isNavigationRequest()).toBe(true);
          expect(route.request().url()).toBe(signedUrl.href);
          const response = await route.fetch();
          const bytes = await response.body();
          await route.fulfill({ response });
          resolveOpened({
            status: response.status(),
            contentType: response.headers()["content-type"],
            bytes,
          });
        } catch (error) {
          rejectOpened(error);
          await route.abort();
        }
      });
      try {
        const documentPage = administratorContext.waitForEvent("page", {
          timeout: 15_000,
        });
        const opening = Promise.all([documentPage, openedResponse]);
        await tabTo(administratorPage, link);
        await administratorPage.keyboard.press("Enter");
        const [openedPage, opened] = await opening;
        expect(opened.status).toBe(200);
        expect(opened.contentType).toContain("application/pdf");
        expect(opened.bytes).toEqual(expectedBytes);
        await openedPage.close();
      } finally {
        clearTimeout(timeout);
        await administratorContext.unroute(signedUrl.href);
      }
      return signedUrl;
    }

    const submittedLink = await openOwnedIdentity(
      "en",
      reviewDocumentFilename,
      identityDocument.object_path,
      originalIdentityBytes,
    );
    const tamperedLink = new URL(submittedLink);
    tamperedLink.pathname = tamperedLink.pathname.replace(
      identityDocument.object_path,
      alternateDocument.object_path,
    );
    if (tamperedLink.pathname === submittedLink.pathname) {
      throw new Error("Owned signed-link object path could not be changed");
    }
    expect(
      (await administratorPage.request.get(tamperedLink.href)).status(),
    ).not.toBe(200);

    await administratorPage.goto(
      `/en/administrator/owner-applications/${applicationId}`,
    );
    await administratorPage
      .getByRole("button", { name: "Start review" })
      .click();
    await expect(
      administratorPage
        .locator(
          ".administrator-review-detail > .page-heading .application-status",
        )
        .first(),
    ).toHaveText("Under review");
    await openOwnedIdentity(
      "ar",
      reviewDocumentFilename,
      identityDocument.object_path,
      originalIdentityBytes,
    );

    await administratorPage.goto(
      `/en/administrator/owner-applications/${applicationId}`,
    );
    const informationRequest = administratorPage
      .locator("form.review-action-card")
      .filter({ hasText: "Request missing information" });
    await informationRequest
      .getByLabel("Reason")
      .fill("Replace identity evidence.");
    await informationRequest.getByLabel("Identity evidence").check();
    await informationRequest
      .getByRole("button", { name: "Request missing information" })
      .click();
    await expect(
      administratorPage
        .locator(
          ".administrator-review-detail > .page-heading .application-status",
        )
        .first(),
    ).toHaveText("Needs information");
    await administratorPage.reload();
    const { count: grantsBeforeDenial, error: beforeDenialError } =
      await auditClient
        .from("owner_verification_document_access_grants")
        .select("id", { count: "exact", head: true })
        .eq("document_id", identityDocument.id)
        .eq("actor_subject_id", administratorId);
    if (beforeDenialError || grantsBeforeDenial === null) {
      throw new Error("Owned grant count before denial is unavailable", {
        cause: beforeDenialError,
      });
    }
    const deniedRow = administratorPage
      .locator(".administrator-review-documents li")
      .filter({ hasText: reviewDocumentFilename });
    await deniedRow
      .getByRole("button", { name: browserFixtures.en.review.createLink })
      .click();
    await expect(
      deniedRow.getByText(
        "You do not have permission to access this private document.",
      ),
    ).toBeVisible();
    await expect(
      deniedRow.getByRole("link", {
        name: browserFixtures.en.review.openDocument,
      }),
    ).toHaveCount(0);
    const { count: grantsAfterDenial, error: afterDenialError } =
      await auditClient
        .from("owner_verification_document_access_grants")
        .select("id", { count: "exact", head: true })
        .eq("document_id", identityDocument.id)
        .eq("actor_subject_id", administratorId);
    if (afterDenialError || grantsAfterDenial === null) {
      throw new Error("Owned grant count after denial is unavailable", {
        cause: afterDenialError,
      });
    }
    expect(grantsAfterDenial).toBe(grantsBeforeDenial);

    await page.reload();
    await expect(
      page.locator(".owner-review-status").getByText("Needs information"),
    ).toBeVisible();
    const replacementCard = page
      .locator(".owner-response-card")
      .getByRole("article", { name: "Identity evidence" });
    const replacementBytes = Buffer.from(
      "%PDF-1.7\nowned replacement identity\n%%EOF",
    );
    await replacementCard.locator('input[type="file"]').setInputFiles({
      name: "replacement-identity.pdf",
      mimeType: "application/pdf",
      buffer: replacementBytes,
    });
    await replacementCard
      .getByRole("button", { name: "Replace document" })
      .click();
    await expect(replacementCard.getByRole("status")).toContainText(
      browserFixtures.en.application.uploaded,
    );
    await expect(
      replacementCard.getByText("replacement-identity.pdf"),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Send requested information" })
      .click();
    await expect(
      page.locator(".owner-review-status").getByText("Under review"),
    ).toBeVisible();
    const replacements = JSON.parse(
      database.runSql(`select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'application_id', application_id, 'kind', kind,
        'object_path', object_path, 'original_filename', original_filename,
        'size_bytes', size_bytes
      )), '[]'::jsonb) from public.owner_verification_documents
      where application_id = '${applicationId}'::uuid and kind = 'identity';`),
    ) as typeof documents;
    const replacement = replacements[0];
    if (
      replacements.length !== 1 ||
      replacement?.id !== identityDocument.id ||
      !replacement.object_path ||
      replacement.original_filename !== "replacement-identity.pdf" ||
      replacement.size_bytes !== replacementBytes.length
    ) {
      throw new Error("Owned replacement evidence is malformed");
    }
    expect(replacement.object_path).not.toBe(identityDocument.object_path);
    await openOwnedIdentity(
      "ckb",
      "replacement-identity.pdf",
      replacement.object_path,
      replacementBytes,
    );
  } finally {
    await administratorContext.close();
  }
});

registerOwnedJourney("owner-layout", async ({ page }, testInfo) => {
  const fixture = await prepareOwnedAccessJourney("owner-layout", testInfo);
  await openOwnerApplication(page, "en", fixture.phone);

  for (const locale of ["en", "ar", "ckb"] as const) {
    if (locale !== "en") await page.goto(`/${locale}/owner/application`);
    const copy = browserFixtures[locale].application;
    const direction = locale === "en" ? "ltr" : "rtl";
    await expect(page.locator("html")).toHaveAttribute("dir", direction);
    await expect(page.getByText(copy.privacyNote)).toBeVisible();

    await saveOwnerApplicationDraft(page, copy, {
      legalName: "Synthetic Owner",
      cottageName: "Synthetic Cottage",
      governorate: "Erbil",
      approximateLocation: "Synthetic area",
      exactAddress: "Synthetic private address",
      capacity: "8",
      bedrooms: "3",
      bathrooms: "2",
      description: "Synthetic cottage description for visual verification.",
      houseRules: "Synthetic test rules.",
    });

    const save = page.getByRole("button", { name: copy.saveDraft });
    const submit = page.getByRole("button", { name: copy.submit });
    await expect(submit).toHaveAttribute("type", "submit");
    expect(
      await submit.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      ),
    ).not.toBe(
      await save.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      ),
    );
    await tabTo(page, save);
    if (locale === "en") {
      await submit.click();
      await expect(
        page.getByRole("alert").filter({ hasText: copy.incompleteTitle }),
      ).toContainText(copy.incompleteTitle);
      await page.reload();
    }

    const cards = copy.documentTitles.map((title) =>
      page.getByRole("article", { name: title }),
    );
    const invalidDocuments: { index: number; title: string }[] = [];
    for (let index = 0; index < cards.length; index += 1) {
      const card = cards[index];
      const validDocument = index % 2 === 0;
      const title = copy.documentTitles[index];
      const fileControl = card.getByLabel(`${title}: ${copy.documentRules}`);
      const filename = validDocument
        ? `short-${locale}-${index}.pdf`
        : `synthetic-long-invalid-evidence-filename-that-must-not-register-${locale}-${index}.txt`;
      await tabTo(page, fileControl);
      await fileControl.setInputFiles({
        name: filename,
        mimeType: validDocument ? "application/pdf" : "text/plain",
        buffer: Buffer.from("%PDF-1.7\nvisual fixture\n%%EOF"),
      });
      expect(
        await fileControl.evaluate(
          (input) => (input as HTMLInputElement).files?.[0]?.name,
        ),
      ).toBe(filename);
      const documentAction = documentActionFor(card, copy);
      await tabTo(page, documentAction);
      await documentAction.click();
      if (validDocument) {
        await expect(card.getByRole("status")).toContainText(copy.uploaded);
        await expect(card.getByText(filename)).toBeVisible();
      } else {
        await expect(card.getByRole("alert")).toContainText(
          copy.invalidDocument,
        );
        invalidDocuments.push({ index, title });
      }
    }

    for (let index = 1; index < cards.length; index += 2) {
      const invalid = cards[index].getByRole("alert");
      await invalid.evaluate((element, syntheticLayoutAlert) => {
        element.textContent = `${element.textContent} ${syntheticLayoutAlert}`;
      }, copy.syntheticLayoutAlert);
      await expect(invalid).toContainText(copy.syntheticLayoutAlert);
    }

    for (let index = 0; index < cards.length; index += 2) {
      const success = cards[index].getByRole("status");
      const invalid = cards[index + 1].getByRole("alert");
      const [successHeight, invalidHeight] = await Promise.all(
        [success, invalid].map((status) =>
          status.evaluate((element) => element.getBoundingClientRect().height),
        ),
      );
      expect(invalidHeight).toBeGreaterThan(successHeight);
    }

    if (testInfo.project.name !== "mobile") {
      for (let index = 0; index < cards.length; index += 2) {
        const [left, right] = await Promise.all(
          [cards[index], cards[index + 1]].map((card) =>
            card.evaluate((element) => {
              const top = element.getBoundingClientRect().top;
              const file = element.querySelector('input[type="file"]');
              const action = element.querySelector("button");
              const status = element.querySelector(
                '[role="status"], [role="alert"]',
              );
              if (!file || !action || !status)
                throw new Error("Missing card region");
              return {
                file: file.getBoundingClientRect().top - top,
                action: action.getBoundingClientRect().top - top,
                status: status.getBoundingClientRect().top - top,
              };
            }),
          ),
        );
        expect(Math.abs(left.file - right.file)).toBeLessThanOrEqual(1);
        expect(Math.abs(left.action - right.action)).toBeLessThanOrEqual(1);
        expect(Math.abs(left.status - right.status)).toBeLessThanOrEqual(1);
      }
    } else {
      const viewport = page.viewportSize();
      if (!viewport) throw new Error("Mobile viewport is unavailable");
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      ).toBe(true);
      for (const card of cards) {
        await card.locator('input[type="file"]').scrollIntoViewIfNeeded();
        const box = await card.locator('input[type="file"]').boundingBox();
        expect(box?.x).toBeGreaterThanOrEqual(0);
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
          viewport.width,
        );
      }
    }

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("dir", direction);
    await expect(page.getByText(copy.privacyNote)).toBeVisible();

    for (const { index, title } of invalidDocuments) {
      const card = page.getByRole("article", { name: title });
      const fileControl = card.getByLabel(`${title}: ${copy.documentRules}`);
      const filename = `retried-long-evidence-filename-that-wraps-${locale}-${index}.pdf`;
      await tabTo(page, fileControl);
      await fileControl.setInputFiles({
        name: filename,
        mimeType: "application/pdf",
        buffer: Buffer.from("%PDF-1.7\nvisual retry fixture\n%%EOF"),
      });
      const documentAction = documentActionFor(card, copy);
      await tabTo(page, documentAction);
      await documentAction.click();
      await expect(card.getByRole("status")).toContainText(copy.uploaded);
      await expect(card.getByText(filename)).toBeVisible();
    }

    await tabTo(page, submit);
    if (locale === "ckb") {
      await page.keyboard.press("Enter");
      await expect(
        page.locator(".owner-review-status").getByText(copy.submittedStatus),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: copy.submit })).toHaveCount(
        0,
      );
      await expect(
        page.getByRole("button", { name: copy.replace }),
      ).toHaveCount(0);
    }
  }
});

test("an approved owner continues the first Cottage Profile and submits a private photo-backed working copy", async ({
  page,
  request,
}, testInfo) => {
  const phoneByProject: Record<string, string> = {
    mobile: "+9647510000000",
    desktop: "+9647510000001",
    worker: "+9647510000002",
  };
  const phone = phoneByProject[testInfo.project.name];
  if (!phone) throw new Error("Approved owner browser fixture is unmapped");
  const checkDraftProgressLayout =
    testInfo.project.name === "mobile" || testInfo.project.name === "desktop";
  const originalViewport = page.viewportSize()!;

  await page.goto("/en/owner/access");
  await page.getByLabel("Iraqi phone number").fill(phone);
  await page.getByRole("button", { name: "Send verification code" }).click();
  await page.getByLabel("Verification code").fill("123456");
  const approvedOwnerVerify = page.getByRole("button", {
    name: "Verify",
    exact: true,
  });
  await approvedOwnerVerify.focus();
  await expect(approvedOwnerVerify).toBeFocused();
  await approvedOwnerVerify.press("Enter");
  await expect(page).toHaveURL(/\/en\/owner\/cottages$/);

  await expect(
    page.getByRole("heading", { name: "Your cottages" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your cottages", exact: true }),
  ).toBeFocused();
  await expect(page.getByText("Started in Owner Application")).toBeVisible();
  await page.getByRole("button", { name: "Add a cottage" }).click();
  await expect(page.getByRole("link", { name: "Continue setup" })).toHaveCount(
    2,
  );
  await page.reload();
  await expect(page.getByRole("link", { name: "Continue setup" })).toHaveCount(
    2,
  );

  const additionalProfile = page
    .getByRole("article")
    .filter({ hasNotText: "Started in Owner Application" });
  await additionalProfile.getByRole("link", { name: "Continue setup" }).click();
  await page.getByRole("button", { name: "Abandon draft" }).click();
  await expect(page.getByText("Abandoned", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "This private Cottage Profile is abandoned and remains available as a read-only record.",
    ),
  ).toBeVisible();
  await expect(page.getByLabel("Cottage name")).toBeDisabled();
  const additionalPath = new URL(page.url()).pathname.replace(/^\/en/, "");
  await page.goto(`/ar${additionalPath}`);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByText("متروك", { exact: true })).toBeVisible();
  await expect(
    page.getByText("ملف الكوخ الخاص هذا متروك ويبقى متاحاً كسجل للقراءة فقط."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "استعادة المسودة" }),
  ).toHaveCount(0);
  await page.goto("/en/owner/cottages");

  const applicationProfile = page
    .getByRole("article")
    .filter({ hasText: "Started in Owner Application" });
  await applicationProfile
    .getByRole("link", { name: "Continue setup" })
    .click();
  await expect(
    page.getByText(
      "Exact address, coordinates and directions stay private and are never shown in the public listing.",
    ),
  ).toBeVisible();
  await page.getByLabel("Cottage name").fill("Shaqlawa Orchard Cottage");
  await page.getByLabel("Guest capacity").fill("10");
  await page.getByLabel("Bedrooms").fill("4");
  await page.getByLabel("Bathrooms").fill("3");
  await page.context().grantPermissions(["geolocation"]);
  await page
    .context()
    .setGeolocation({ latitude: 36.408333, longitude: 44.385834 });
  const locationControl = page.getByRole("button", {
    name: "Use this device\'s location",
  });
  await locationControl.focus();
  await expect(locationControl).toBeFocused();
  const locationSource = await locationControl.elementHandle();
  if (!locationSource) throw new Error("Focus source is missing");
  await locationControl.press("Enter");
  await expect(page.getByLabel("Latitude")).toHaveValue("36.408333");
  await expect(page.getByLabel("Longitude")).toHaveValue("44.385834");
  await expect(locationControl).toBeFocused();
  expect(
    await locationSource.evaluate(
      (source) => document.activeElement === source,
    ),
  ).toBe(true);
  await locationSource.dispose();

  await page.getByLabel("Latitude").fill("36.408333");
  await page.getByLabel("Longitude").fill("44.385834");
  await page.getByLabel("I checked this point is the cottage").check();
  await page
    .getByLabel("Private directions")
    .fill("Continue past the orchard gate.");
  await page.getByLabel("Wi-Fi").check();
  await page.getByLabel("Source language").selectOption("en");
  await page
    .getByLabel("Source description")
    .fill("A warm stone and wood cottage beside a private orchard.");
  await page
    .getByLabel("Source House Rules")
    .fill("Respect neighbours and leave the cottage tidy.");
  await page.getByRole("button", { name: "Save private draft" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Private draft saved." }),
  ).toBeVisible();

  const profilePath = new URL(page.url()).pathname.replace(/^\/en/, "");
  await page.goto("/en/owner/cottages");
  const savedDraftCard = page.getByRole("article").filter({
    has: page.locator(`a[href="/en${profilePath}"]`),
  });
  await expect(
    savedDraftCard.getByText("12 of 13 requirements complete", { exact: true }),
  ).toBeVisible();
  await expect(
    savedDraftCard.getByText(
      "Next: add or check your photos. You need 1–12 ready photos.",
      { exact: true },
    ),
  ).toBeVisible();
  const checkCottageListPresentation = async (locale: BrowserLocale) => {
    const copy = {
      en: { add: "Add a cottage", guests: "10 guests", bedrooms: "4 bedrooms" },
      ar: { add: "إضافة كوخ", guests: "10 ضيوف", bedrooms: "4 غرف نوم" },
      ckb: {
        add: "زیادکردنی کۆتێج",
        guests: "١٠ میوان",
        bedrooms: "٤ ژووری نوستن",
      },
    }[locale];
    const heading = page.locator(".cottage-profile-overview > header");
    const add = heading.getByRole("button", { name: copy.add, exact: true });
    const card = page
      .getByRole("article")
      .filter({ has: page.locator(`a[href="/${locale}${profilePath}"]`) });
    const action = card.getByRole("link");
    await expect(card.getByText(copy.guests, { exact: true })).toBeVisible();
    await expect(card.getByText(copy.bedrooms, { exact: true })).toBeVisible();
    await expect(add).toBeVisible();
    await expect
      .poll(() =>
        heading.evaluate((element) => {
          const copy = element
            .querySelector(".cottage-profile-overview-heading-copy")!
            .getBoundingClientRect();
          const form = element.querySelector("form")!.getBoundingClientRect();
          return {
            fits:
              document.documentElement.scrollWidth <=
              document.documentElement.clientWidth,
            placed:
              innerWidth <= 640
                ? form.top >= copy.bottom &&
                  (getComputedStyle(element).direction === "rtl"
                    ? Math.abs(form.right - copy.right) <= 1
                    : Math.abs(form.left - copy.left) <= 1)
                : Math.abs(form.bottom - copy.bottom) <= 1 &&
                  (form.left >= copy.right || form.right <= copy.left),
          };
        }),
      )
      .toEqual({ fits: true, placed: true });
    await heading.getByRole("heading", { level: 1 }).click();
    await expect
      .poll(() =>
        action.evaluate((element) => ({
          focused: element.matches(":focus-visible"),
          decoration: getComputedStyle(element).textDecorationLine,
        })),
      )
      .toEqual({ focused: false, decoration: "none" });
    const restingWidth = await page.evaluate(() => innerWidth);
    await page.screenshot({
      path: testInfo.outputPath(
        `cottage-list-resting-${locale}-${restingWidth}-${testInfo.project.name}.png`,
      ),
      fullPage: true,
    });
    await tabTo(page, add);
    await expect(add).toBeFocused();
    await tabTo(page, action);
    await expect(action).toBeFocused();
    expect(
      await action.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const card = element.closest("article")!.getBoundingClientRect();
        const style = getComputedStyle(element);
        const perimeter =
          Number.parseFloat(style.outlineWidth) +
          Number.parseFloat(style.outlineOffset);
        return {
          target: rect.height >= 44 && rect.width >= 44,
          focus:
            element.matches(":focus-visible") &&
            style.outlineStyle === "solid" &&
            style.boxShadow !== "none",
          unclipped:
            rect.left - perimeter >= card.left &&
            rect.right + perimeter <= card.right &&
            rect.top - perimeter >= card.top &&
            rect.bottom + perimeter <= card.bottom,
          arrow: getComputedStyle(
            element.querySelector(".cottage-profile-card-arrow")!,
          ).transform,
        };
      }),
    ).toEqual({
      target: true,
      focus: true,
      unclipped: true,
      arrow: locale === "en" ? "none" : "matrix(-1, 0, 0, 1, 0, 0)",
    });
  };
  if (checkDraftProgressLayout) {
    await checkCottageListPresentation("en");
    await page.screenshot({
      path: testInfo.outputPath(
        `draft-progress-partial-en-${testInfo.project.name}.png`,
      ),
      fullPage: true,
    });
    await page.setViewportSize({ width: 320, height: originalViewport.height });
    await expect
      .poll(() =>
        page.evaluate(() => ({
          width: innerWidth,
          fits:
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        })),
      )
      .toEqual({ width: 320, fits: true });
    await checkCottageListPresentation("en");
    for (const [locale, count, next] of [
      [
        "ar",
        "اكتمل 12 من 13 متطلبًا",
        "التالي: أضف صورك أو تحقق منها. تحتاج إلى 1–12 صورة جاهزة.",
      ],
      [
        "ckb",
        "١٢ لە ١٣ پێداویستی تەواو کراوە",
        "دواتر: وێنەکانت زیاد بکە یان بیانپشکنە. پێویستت بە ١–١٢ وێنەی ئامادەیە.",
      ],
    ] as const) {
      await page.goto(`/${locale}/owner/cottages`);
      const card = page
        .getByRole("article")
        .filter({ has: page.locator(`a[href="/${locale}${profilePath}"]`) });
      await expect(card.getByText(count, { exact: true })).toBeVisible();
      await expect(card.getByText(next, { exact: true })).toBeVisible();
      await checkCottageListPresentation(locale);
      await page.screenshot({
        path: testInfo.outputPath(
          `cottage-list-${locale}-320-${testInfo.project.name}.png`,
        ),
        fullPage: true,
      });
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await expect
        .poll(() =>
          card.evaluate((card) => {
            const track = card
              .querySelector(".cottage-profile-draft-progress-track")!
              .getBoundingClientRect();
            const fill = card
              .querySelector(".cottage-profile-draft-progress-track > span")!
              .getBoundingClientRect();
            return {
              width: innerWidth,
              fits:
                document.documentElement.scrollWidth <=
                document.documentElement.clientWidth,
              direction: getComputedStyle(card).direction,
              partialFill: fill.width > 0 && fill.width < track.width,
              atReadingEdge: Math.abs(fill.right - track.right) <= 1,
            };
          }),
        )
        .toEqual({
          width: 320,
          fits: true,
          direction: "rtl",
          partialFill: true,
          atReadingEdge: true,
        });
    }
    await page.setViewportSize(originalViewport);
    await page.goto("/ar/owner/cottages");
    await checkCottageListPresentation("ar");
    await page.screenshot({
      path: testInfo.outputPath(`cottage-list-ar-${testInfo.project.name}.png`),
      fullPage: true,
    });
    await page.goto("/en/owner/cottages");
  }
  const continueSetup = savedDraftCard.getByRole("link", {
    name: "Continue setup",
    exact: true,
  });
  await continueSetup.focus();
  await expect(continueSetup).toBeFocused();
  await continueSetup.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/en${profilePath}$`));
  for (const locale of ["en", "ar", "ckb"] as const) {
    const copy = cottageShiftScheduleMessages[locale];
    await page.goto(`/${locale}${profilePath}`);
    await expect(page.locator("html")).toHaveAttribute(
      "dir",
      locale === "en" ? "ltr" : "rtl",
    );
    const scheduleForm = page.locator("form.cottage-shift-schedule-form");
    const morning = scheduleForm.getByRole("group", {
      name: copy.morning,
      exact: true,
    });
    const evening = scheduleForm.getByRole("group", {
      name: copy.evening,
      exact: true,
    });
    const morningStart = morning.getByLabel(copy.startTime, { exact: true });
    const morningEnd = morning.getByLabel(copy.endTime, { exact: true });
    const eveningStart = evening.getByLabel(copy.startTime, { exact: true });
    const eveningEnd = evening.getByLabel(copy.endTime, { exact: true });
    const fullDay = scheduleForm.getByRole("status", {
      name: copy.fullDayAccess,
      exact: true,
    });
    const confirmation = scheduleForm.getByRole("checkbox", {
      name: copy.confirmedTimes,
      exact: true,
    });
    const save = scheduleForm.getByRole("button", {
      name: copy.save,
      exact: true,
    });
    await expect(morningStart).toBeEnabled();
    await expect(eveningEnd).toBeEnabled();
    await expect(scheduleForm.getByRole("group")).toHaveCount(2);
    await expect(morning).toBeVisible();
    await expect(evening).toBeVisible();
    await expect
      .poll(async () => {
        const morningBox = await morning.boundingBox();
        const eveningBox = await evening.boundingBox();
        if (!morningBox || !eveningBox) return false;
        return testInfo.project.name === "mobile"
          ? eveningBox.y >= morningBox.y + morningBox.height
          : Math.abs(morningBox.y - eveningBox.y) < 1 &&
              Math.abs(morningBox.width - eveningBox.width) < 1 &&
              (locale === "en"
                ? morningBox.x < eveningBox.x
                : morningBox.x > eveningBox.x);
      })
      .toBe(true);

    await morning.getByLabel(copy.localName, { exact: true }).fill("Morning");
    await evening.getByLabel(copy.localName, { exact: true }).fill("Evening");
    for (const field of [morningStart, morningEnd, eveningStart, eveningEnd]) {
      await field.fill("");
    }
    await save.click();
    await expect(fullDay).toContainText(copy.invalid);
    await expect(fullDay).toContainText(copy.fullDayEmpty);
    await expect(fullDay.locator("strong")).toHaveCount(0);
    await expect(confirmation).toHaveCount(0);
    await expect(morningStart).toBeFocused();
    await expect(morningStart).toHaveAttribute("aria-invalid", "true");
    const invalidControls = await scheduleForm
      .locator("input[type=time]")
      .evaluateAll((fields) =>
        fields.map((field) => {
          const style = getComputedStyle(field);
          const rect = field.getBoundingClientRect();
          return {
            invalid: field.getAttribute("aria-invalid"),
            color: style.color,
            background: style.backgroundColor,
            border: style.borderColor,
            borderWidth: style.borderWidth,
            width: rect.width,
            height: rect.height,
          };
        }),
      );
    await testInfo.attach(`${locale}-schedule-invalid-controls`, {
      body: JSON.stringify(invalidControls, null, 2),
      contentType: "application/json",
    });
    expect(invalidControls).toHaveLength(4);
    for (const control of invalidControls) {
      expect(control.invalid).toBe("true");
      expect(control.width).toBeGreaterThanOrEqual(24);
      expect(control.height).toBeGreaterThanOrEqual(24);
    }

    await morningStart.fill("09:00");
    await morningEnd.fill("15:00");
    await eveningStart.fill("14:00");
    await eveningEnd.fill("02:00");
    await save.click();
    await expect(fullDay).toContainText(copy.overlap);
    await expect(fullDay.locator("strong")).toHaveCount(0);
    await expect(confirmation).toHaveCount(0);

    // The ordered groups never sort reversed input into a valid schedule.
    await morningStart.fill("18:00");
    await morningEnd.fill("02:00");
    await eveningStart.fill("08:00");
    await eveningEnd.fill("12:00");
    await save.click();
    await expect(fullDay).toContainText(copy.startOrder);
    await expect(eveningStart).toHaveAttribute("aria-invalid", "true");
    await expect(fullDay.locator("strong")).toHaveCount(0);
    await expect(confirmation).toHaveCount(0);

    await morningStart.fill("09:00");
    await morningEnd.fill("09:00");
    await eveningStart.fill("17:00");
    await eveningEnd.fill("02:00");
    await expect(fullDay).toContainText(copy.invalid);
    await morningEnd.fill("15:00");
    await eveningEnd.fill("17:00");
    await expect(fullDay).toContainText(copy.invalid);
    await eveningEnd.fill("02:00");
    await expect(fullDay.locator("strong")).toHaveText(
      copy.accessRange.replace("{start}", "09:00").replace("{end}", "02:00") +
        ` ${copy.nextDay}`,
    );
    await expect(fullDay).toContainText(
      copy.includingGap.replace("{start}", "15:00").replace("{end}", "17:00"),
    );
    await expect(fullDay).toContainText(copy.fullDayBetweenShifts);
    await expect(
      scheduleForm.getByText(copy.clockFormat, { exact: true }),
    ).toBeVisible();
    await expect(
      scheduleForm.locator('bdi[dir="ltr"]').filter({ hasText: /^UTC\+3$/ }),
    ).toBeVisible();
    await expect(
      morning.locator('bdi[dir="auto"]').filter({ hasText: /^Morning$/ }),
    ).toBeVisible();
    await expect(fullDay.locator('strong bdi[dir="ltr"]')).toHaveText([
      "09:00",
      "02:00",
    ]);

    await confirmation.check();
    await eveningStart.fill("15:00");
    await expect(confirmation).not.toBeChecked();
    await expect(fullDay.locator("strong")).toHaveText(
      copy.accessRange.replace("{start}", "09:00").replace("{end}", "02:00") +
        ` ${copy.nextDay}`,
    );
    await expect(fullDay.locator("dd > span")).toHaveCount(0);
    await confirmation.check();
    await eveningStart.fill("17:00");
    await eveningEnd.fill("09:00");
    await expect(confirmation).not.toBeChecked();
    await expect(fullDay.locator("strong")).toHaveText(
      copy.accessRange.replace("{start}", "09:00").replace("{end}", "09:00") +
        ` ${copy.nextDay}`,
    );
    await expect(fullDay.locator('strong bdi[dir="ltr"]')).toHaveText([
      "09:00",
      "09:00",
    ]);

    await test.step("enabled schedule confirmation has a visible focus indicator with at least 3:1 contrast", async () => {
      for (const state of ["normal", "error", "focus"] as const) {
        await expect(confirmation).toBeEnabled();
        if (state === "error") {
          await save.click();
          await expect(confirmation).toHaveAttribute("aria-invalid", "true");
          await expect(fullDay).toContainText(copy.requiredConfirmation);
        }
        if (state === "focus") {
          await save.focus();
          await page.keyboard.press("Shift+Tab");
          await expect(confirmation).toBeFocused();
          await expect(confirmation).toHaveJSProperty("disabled", false);
          expect(
            await confirmation.evaluate((control) =>
              control.matches(":focus-visible"),
            ),
          ).toBe(true);
        }
        const measurements = await scheduleForm
          .locator('input:not([type="hidden"]), button')
          .evaluateAll((controls) => {
            function rgb(value: string) {
              const match = value.match(
                /^rgba?\((\d+(?:\.\d+)?), (\d+(?:\.\d+)?), (\d+(?:\.\d+)?)(?:, (\d+(?:\.\d+)?))?\)$/,
              );
              if (!match)
                throw new Error(`Unresolved rendered sRGB color: ${value}`);
              return {
                channels: [
                  Number(match[1]),
                  Number(match[2]),
                  Number(match[3]),
                ],
                alpha: match[4] === undefined ? 1 : Number(match[4]),
              };
            }
            function opaqueSurface(element: Element | null): string {
              for (
                let ancestor = element;
                ancestor;
                ancestor = ancestor.parentElement
              ) {
                const style = getComputedStyle(ancestor);
                if (style.backgroundImage !== "none")
                  throw new Error(
                    "Adjacent surface has an unresolved background image",
                  );
                const color = rgb(style.backgroundColor);
                if (color.alpha === 1) return style.backgroundColor;
                if (color.alpha !== 0)
                  throw new Error(
                    "Adjacent surface has an unresolved translucent background",
                  );
              }
              throw new Error(
                "No opaque adjacent surface for schedule control",
              );
            }
            function luminance(value: string) {
              const color = rgb(value);
              if (color.alpha !== 1)
                throw new Error(`Contrast color is translucent: ${value}`);
              const linear = color.channels.map((channel) => {
                const srgb = channel / 255;
                return srgb <= 0.04045
                  ? srgb / 12.92
                  : ((srgb + 0.055) / 1.055) ** 2.4;
              });
              return (
                0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
              );
            }
            function contrast(first: string, second: string) {
              const values = [luminance(first), luminance(second)];
              return (
                (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05)
              );
            }
            return controls.map((control) => {
              const style = getComputedStyle(control);
              const adjacent = opaqueSurface(control.parentElement);
              const background = opaqueSurface(control);
              const target = control.matches('input[type="checkbox"]')
                ? control.parentElement
                : control;
              if (!target) throw new Error("Schedule control has no target");
              const rect = target.getBoundingClientRect();
              const innerBand = style.boxShadow.match(/rgba?\([^)]+\)/g)?.[1];
              return {
                name: control.getAttribute("name") ?? control.textContent,
                enabled: !control.matches(":disabled"),
                invalid: control.getAttribute("aria-invalid"),
                focusVisible: control.matches(":focus-visible"),
                width: rect.width,
                height: rect.height,
                foreground: style.color,
                background,
                adjacent,
                textContrast: contrast(style.color, background),
                border: style.borderTopColor,
                borderWidth: style.borderTopWidth,
                borderContrast:
                  rgb(style.borderTopColor).alpha === 1
                    ? contrast(style.borderTopColor, adjacent)
                    : null,
                boxShadow: style.boxShadow,
                innerBandContrast:
                  innerBand && rgb(innerBand).alpha === 1
                    ? contrast(innerBand, adjacent)
                    : null,
                outline: style.outlineColor,
                outlineStyle: style.outlineStyle,
                outlineWidth: style.outlineWidth,
                outlineOffset: style.outlineOffset,
                outlineContrast:
                  style.outlineStyle !== "none" &&
                  style.outlineStyle !== "hidden" &&
                  Number.parseFloat(style.outlineWidth) > 0 &&
                  rgb(style.outlineColor).alpha === 1
                    ? contrast(style.outlineColor, adjacent)
                    : null,
              };
            });
          });
        const measurementsPath = testInfo.outputPath(
          `${locale}-schedule-${state}-controls.json`,
        );
        await writeFile(
          measurementsPath,
          JSON.stringify(measurements, null, 2),
        );
        await testInfo.attach(`${locale}-schedule-${state}-controls`, {
          path: measurementsPath,
          contentType: "application/json",
        });
        expect(measurements).toHaveLength(8);
        for (const control of measurements) {
          expect(control.enabled).toBe(true);
          expect(control.width).toBeGreaterThanOrEqual(24);
          expect(control.height).toBeGreaterThanOrEqual(24);
        }
        if (state === "focus") {
          const focused = measurements.find(
            (control) => control.name === "confirmedTimes",
          );
          if (!focused)
            throw new Error("Enabled confirmation was not measured");
          expect(focused.focusVisible).toBe(true);
          expect(focused.outlineStyle).toBe("solid");
          expect(focused.outlineWidth).toBe("2px");
          expect(focused.outlineOffset).toBe("4px");
          expect(focused.outline).toBe("rgb(255, 252, 245)");
          expect(focused.boxShadow).toBe(
            "rgb(255, 252, 245) 0px 0px 0px 2px, rgb(34, 64, 47) 0px 0px 0px 4px",
          );
          expect(focused.innerBandContrast).toBeGreaterThanOrEqual(3);
        }
        if (
          (state === "normal" || state === "focus") &&
          ((locale === "en" && testInfo.project.name === "desktop") ||
            (locale === "ar" && testInfo.project.name === "mobile"))
        ) {
          const screenshotName = `${locale}-${testInfo.project.name}-schedule-${state}`;
          const screenshotPath = testInfo.outputPath(`${screenshotName}.png`);
          await scheduleForm.screenshot({ path: screenshotPath });
          await testInfo.attach(screenshotName, {
            path: screenshotPath,
            contentType: "image/png",
          });
        }
      }
    });

    await page.keyboard.press("Space");
    await expect(confirmation).toBeChecked();
    const scheduleControl = save;
    await scheduleControl.focus();
    await expect(scheduleControl).toBeFocused();
    const scheduleSource = await scheduleControl.elementHandle();
    if (!scheduleSource) throw new Error("Focus source is missing");
    await scheduleControl.press("Enter");
    await expect(
      scheduleForm.getByRole("status").filter({ hasText: copy.saved }),
    ).toBeVisible();
    await expect(scheduleControl).toBeFocused();
    expect(
      await scheduleSource.evaluate(
        (source) => document.activeElement === source,
      ),
    ).toBe(true);
    await scheduleSource.dispose();

    await expect(confirmation).not.toBeChecked();
    await page.reload();
    await expect(morningStart).toHaveValue("09:00");
    await expect(morningEnd).toHaveValue("15:00");
    await expect(eveningStart).toHaveValue("17:00");
    await expect(eveningEnd).toHaveValue("09:00");
    await expect(fullDay.locator("strong")).toContainText(copy.nextDay);
    await expect(confirmation).not.toBeChecked();
    await eveningEnd.fill("02:00");
    await expect(confirmation).not.toBeChecked();
    await confirmation.check();
    await morning.getByLabel(copy.localName, { exact: true }).fill("Morning ");
    await expect(confirmation).not.toBeChecked();
    await confirmation.check();
    await save.click();
    await expect(
      scheduleForm.getByRole("status").filter({ hasText: copy.saved }),
    ).toBeVisible();
    await expect(confirmation).not.toBeChecked();
    await eveningStart.fill("15:00");
    await confirmation.check();
    await save.click();
    await expect(
      scheduleForm.getByRole("status").filter({ hasText: copy.saved }),
    ).toBeVisible();
    await expect(confirmation).not.toBeChecked();
    await page.reload();
    await expect(eveningStart).toHaveValue("15:00");
    await expect(eveningEnd).toHaveValue("02:00");
    await expect(fullDay.locator("strong")).toHaveText(
      copy.accessRange.replace("{start}", "09:00").replace("{end}", "02:00") +
        ` ${copy.nextDay}`,
    );
  }
  await page.goto(`/en${profilePath}`);

  await page.getByLabel("Choose cottage photo").setInputFiles({
    name: "shaqlawa-orchard-cottage.png",
    mimeType: "image/png",
    buffer: locatedCottagePhoto,
  });
  await page.getByRole("button", { name: "Upload photo" }).click();
  await expect(page.getByText("Photo uploaded.")).toBeVisible();
  await expect(page.getByText("shaqlawa-orchard-cottage.png")).toBeVisible();
  await page.getByRole("button", { name: "Create private preview" }).click();
  const privatePreview = page.getByRole("link", {
    name: "Create private preview",
  });
  await expect(privatePreview).toBeVisible();
  const privatePreviewUrl = await privatePreview.getAttribute("href");
  if (!privatePreviewUrl)
    throw new Error("Private Cottage Profile preview has no URL");
  const previewResponse = await page.request.get(privatePreviewUrl);
  expect(previewResponse.status()).toBe(200);
  expect(previewResponse.headers()["content-type"]).toContain("image/png");
  expect(await previewResponse.body()).toEqual(cleanCottagePhoto);

  await page.getByLabel("Choose cottage photo").setInputFiles({
    name: "shaqlawa-orchard-second.png",
    mimeType: "image/png",
    buffer: cleanCottagePhoto,
  });
  await page.getByRole("button", { name: "Upload photo" }).click();
  await expect(page.getByText("shaqlawa-orchard-second.png")).toBeVisible();
  await expect(page.getByText("Photo uploaded.")).toBeVisible();

  await page.goto("/en/owner/cottages");
  const readyDraftCard = page
    .locator("article.cottage-profile-card")
    .filter({ has: page.locator(`a[href="/en${profilePath}"]`) });
  await expect(
    readyDraftCard.getByText("13 of 13 requirements complete", { exact: true }),
  ).toBeVisible();
  await expect(
    readyDraftCard.getByText("Ready to submit for content approval", {
      exact: true,
    }),
  ).toBeVisible();
  const coverPhotoPath = await readyDraftCard
    .locator("img")
    .getAttribute("src");
  expect(coverPhotoPath).toMatch(
    /^\/api\/cottage-profile-photos\/[0-9a-f-]{36}$/,
  );
  if (!coverPhotoPath) throw new Error("Cover photo has no source");
  const coverPhotoResponse = await page.request.get(coverPhotoPath);
  expect(coverPhotoResponse.status()).toBe(200);
  expect(coverPhotoResponse.headers()["content-type"]).toContain("image/png");
  expect(coverPhotoResponse.headers()["cache-control"]).toContain("private");
  expect(coverPhotoResponse.headers()["cache-control"]).toContain("no-store");
  expect(await coverPhotoResponse.body()).toEqual(cleanCottagePhoto);
  const signedOutCoverPhoto = await request.get(coverPhotoPath);
  expect(signedOutCoverPhoto.status()).toBe(404);
  expect(await signedOutCoverPhoto.text()).toBe(
    "Cottage Profile photo is unavailable",
  );
  if (checkDraftProgressLayout) {
    await page.screenshot({
      path: testInfo.outputPath(
        `draft-progress-ready-en-${testInfo.project.name}.png`,
      ),
      fullPage: true,
    });
    await page.goto("/ar/owner/cottages");
    const readyArabicCard = page.getByRole("article").filter({
      has: page.locator(`a[href="/ar${profilePath}"]`),
    });
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(
      readyArabicCard.getByText("اكتمل 13 من 13 متطلبًا", { exact: true }),
    ).toBeVisible();
    await expect(
      readyArabicCard.getByText("جاهز للإرسال للموافقة على المحتوى", {
        exact: true,
      }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(
        `draft-progress-ready-ar-${testInfo.project.name}.png`,
      ),
      fullPage: true,
    });
    await page.goto("/en/owner/cottages");
  }
  const reviewAndSubmit = readyDraftCard.getByRole("link", {
    name: "Review and submit",
    exact: true,
  });
  await reviewAndSubmit.focus();
  await expect(reviewAndSubmit).toBeFocused();
  await reviewAndSubmit.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/en${profilePath}$`));

  await page.reload();
  await expect(page.getByLabel("Source language")).toHaveValue("en");
  await expect(page.getByText("shaqlawa-orchard-cottage.png")).toBeVisible();
  await expectCottageProfileSectionTitlesAligned(page, [
    "Public working-copy details",
    "Private arrival details",
    "Owner source content",
  ]);
  await expectCottageProfileActionHierarchy(
    page,
    ["Save private draft", "Upload photo", "Submit for content approval"],
    testInfo.project.name,
  );
  for (const [locale, direction, heading, sectionNames, actionNames] of [
    [
      "ar",
      "rtl",
      "ملف الكوخ",
      [
        "تفاصيل نسخة العمل العامة",
        "تفاصيل الوصول الخاصة",
        "محتوى المالك الأصلي",
      ],
      ["حفظ المسودة الخاصة", "رفع الصورة", "الإرسال للموافقة على المحتوى"],
    ],
    [
      "ckb",
      "rtl",
      "پرۆفایلی کۆتێج",
      [
        "وردەکارییە گشتییەکانی کۆپی کار",
        "وردەکارییە تایبەتەکانی گەیشتن",
        "ناوەڕۆکی سەرچاوەی خاوەن",
      ],
      [
        "پاشەکەوتکردنی ڕەشنووسی تایبەت",
        "بارکردنی وێنە",
        "ناردن بۆ پەسەندکردنی ناوەڕۆک",
      ],
    ],
  ] as const) {
    await page.goto(`/${locale}${profilePath}`);
    await expect(page.locator("html")).toHaveAttribute("dir", direction);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: cottageShiftScheduleMessages[locale].title,
      }),
    ).toBeVisible();
    await expectCottageProfileSectionTitlesAligned(page, sectionNames);
    await expectCottageProfileActionHierarchy(
      page,
      actionNames,
      testInfo.project.name,
    );
  }

  await page.goto(`/en${profilePath}`);
  await page
    .getByRole("button", { name: "Submit for content approval" })
    .click();
  await expect(page.getByText("Submitted for content approval")).toBeVisible();
  await expect(page.getByLabel("Cottage name")).toBeDisabled();
  await expect(
    page
      .getByRole("group", { name: "Morning", exact: true })
      .getByLabel("Local name (optional)", { exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save schedule" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("heading", { name: "Preserved submitted owner source" }),
  ).toBeVisible();
  const submittedSource = page
    .getByRole("heading", { name: "Preserved submitted owner source" })
    .locator("..");
  await expect(
    submittedSource.getByText(
      "A warm stone and wood cottage beside a private orchard.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Language review" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Production translation and publication are disabled until the approved adapter is available.",
    ),
  ).toBeVisible();
  for (const [locale, title, status, disabled] of [
    [
      "en",
      "Language review",
      "In review",
      "Production translation and publication are disabled until the approved adapter is available.",
    ],
    [
      "ar",
      "مراجعة اللغات",
      "قيد المراجعة",
      "الترجمة والنشر للإنتاج معطّلان حتى يتوفر المحول المعتمد.",
    ],
    [
      "ckb",
      "پێداچوونەوەی زمان",
      "لە پێداچوونەوەدایە",
      "وەرگێڕان و بڵاوکردنەوەی بەرهەم تا بەردەستبوونی پەیوەندیکەری پەسەندکراو ناچالاکە.",
    ],
  ] as const) {
    await page.goto(`/${locale}${profilePath}`);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByText(status, { exact: true })).toBeVisible();
    await expect(page.getByText(disabled)).toBeVisible();
    const scheduleCopy = cottageShiftScheduleMessages[locale];
    const submittedSchedule = page.locator("form.cottage-shift-schedule-form");
    await expect(
      page.getByText(scheduleCopy.readOnly, { exact: true }),
    ).toBeVisible();
    await expect(
      submittedSchedule
        .getByRole("group", { name: scheduleCopy.morning, exact: true })
        .getByLabel(scheduleCopy.startTime, { exact: true }),
    ).toBeDisabled();
    await expect(
      submittedSchedule
        .getByRole("group", { name: scheduleCopy.evening, exact: true })
        .getByLabel(scheduleCopy.endTime, { exact: true }),
    ).toBeDisabled();
    await expect(
      submittedSchedule.getByRole("button", {
        name: scheduleCopy.save,
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      submittedSchedule.getByRole("checkbox", {
        name: scheduleCopy.confirmedTimes,
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      submittedSchedule
        .getByRole("status", { name: scheduleCopy.fullDayAccess, exact: true })
        .locator("strong"),
    ).toHaveText(
      scheduleCopy.accessRange
        .replace("{start}", "09:00")
        .replace("{end}", "02:00") + ` ${scheduleCopy.nextDay}`,
    );
  }
  await page.goto("/en/owner/cottages");
  const submittedCard = page.getByRole("article").filter({
    has: page.locator(`a[href="/en${profilePath}"]`),
  });
  await expect(
    submittedCard.getByText("Submitted for content approval", { exact: true }),
  ).toBeVisible();
  await expect(
    submittedCard.getByText("13 of 13 requirements complete", { exact: true }),
  ).toHaveCount(0);
  await expect(
    submittedCard.getByText("Ready to submit for content approval", {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    submittedCard.getByRole("link", {
      name: "Open Cottage Profile",
      exact: true,
    }),
  ).toHaveAttribute("href", `/en${profilePath}`);
});

test("a Platform Administrator reaches access only after authenticator MFA", async ({
  page,
  request,
}, testInfo) => {
  const reviewFixture = accessBrowserFixture(testInfo.project.name);
  const email = `platform-administrator-${testInfo.project.name}@rentcottage.test`;
  const actorUserId = await administratorId(email);
  const coverPhotoPath = await bookingFixtureCoverPhotoPath(reviewFixture);
  const database = createLocalSupabaseConcurrencyHarness();
  database.guardDisposableLocalDatabase();
  database.runSql(
    `insert into public.account_names (user_id, first_name) values ('${actorUserId}', 'Sara') on conflict (user_id) do update set first_name = excluded.first_name;`,
  );
  const attemptedAfter = new Date().toISOString();
  await page.goto("/en/administrator/access");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("Local-test-password-2026");
  const administratorContinueControl = page.getByRole("button", {
    name: "Continue",
    exact: true,
  });
  await administratorContinueControl.focus();
  await expect(administratorContinueControl).toBeFocused();
  await administratorContinueControl.press("Enter");
  await expect(page.getByLabel("Authenticator app code")).toBeVisible();

  const secret = await page.getByTestId("mfa-secret").textContent();
  if (!secret) throw new Error("MFA enrollment returned no secret");
  const assuranceLevelOneCoverPhoto = await page.request.get(coverPhotoPath);
  expect(assuranceLevelOneCoverPhoto.status()).toBe(404);
  expect(await assuranceLevelOneCoverPhoto.text()).toBe(
    "Cottage Profile photo is unavailable",
  );
  const failedAttemptedAfter = new Date().toISOString();
  await page.getByLabel("Authenticator app code").fill("12");
  await page.getByLabel("Authenticator app code").press("Enter");
  await expect(page.getByText(/code could not be confirmed/)).toBeVisible();

  const failedAudit = await currentAudit(
    actorUserId,
    failedAttemptedAfter,
    "mfa",
    "failed",
  );
  expect(failedAudit.actor_user_id).toBe(actorUserId);
  expect(failedAudit.email_digest).toBe(expectedEmailDigest(email));
  const code = new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(secret),
  }).generate();
  await page.getByLabel("Authenticator app code").fill(code);
  const administratorVerifyControl = page.getByRole("button", {
    name: "Verify",
    exact: true,
  });
  await administratorVerifyControl.focus();
  await expect(administratorVerifyControl).toBeFocused();
  await administratorVerifyControl.press("Enter");

  await expect(page.getByText(/Administrator access is ready/)).toBeVisible();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Administrator access is ready" }),
  ).toBeFocused();
  const assuranceLevelTwoCoverPhoto = await page.request.get(coverPhotoPath);
  expect(assuranceLevelTwoCoverPhoto.status()).toBe(200);
  expect(assuranceLevelTwoCoverPhoto.headers()["content-type"]).toContain(
    "image/png",
  );
  expect(assuranceLevelTwoCoverPhoto.headers()["cache-control"]).toContain(
    "private",
  );
  expect(assuranceLevelTwoCoverPhoto.headers()["cache-control"]).toContain(
    "no-store",
  );
  expect((await assuranceLevelTwoCoverPhoto.body()).subarray(0, 8)).toEqual(
    pngSignature,
  );

  const audit = await currentAudit(
    actorUserId,
    attemptedAfter,
    "mfa",
    "succeeded",
  );
  expect(audit.actor_user_id).toBe(actorUserId);
  expect(audit.email_digest).toBe(expectedEmailDigest(email));
  expect(new Date(audit.attempted_at).getTime()).toBeGreaterThanOrEqual(
    new Date(attemptedAfter).getTime(),
  );

  await page
    .getByRole("link", { name: "Review submitted Owner Applications" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Submitted Owner Applications" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Manage Cottage Profiles" }).click();
  await expect(
    page.getByRole("heading", { name: "Private Cottage Profiles" }),
  ).toBeVisible();
  const administratorNavigation = page.getByRole("navigation", {
    name: "Platform administration",
  });
  await expect(administratorNavigation.getByRole("link")).toHaveText([
    "Review submitted Owner Applications",
    "Manage Cottage Profiles",
    "Payment support history",
    "Booking queues",
    "Booking totals",
    "Records",
  ]);
  await expect
    .poll(() =>
      administratorNavigation.evaluate((navigation) => {
        const links = [...navigation.querySelectorAll("a")].map((link) =>
          link.getBoundingClientRect(),
        );
        return {
          oneLine: links.every(
            (link) => Math.round(link.top) === Math.round(links[0].top),
          ),
          pageStaysPut:
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
          separate: links.every((first, index) =>
            links
              .slice(index + 1)
              .every(
                (second) =>
                  first.right + 6 <= second.left ||
                  second.right + 6 <= first.left ||
                  first.bottom + 6 <= second.top ||
                  second.bottom + 6 <= first.top,
              ),
          ),
        };
      }),
    )
    .toEqual({ oneLine: true, pageStaysPut: true, separate: true });
  const abandonedProfile = page
    .getByRole("article")
    .filter({ hasText: "Abandoned" });
  await abandonedProfile
    .getByRole("link", { name: "Open Cottage Profile" })
    .click();
  const restore = page.getByRole("button", { name: "Restore draft" });
  const reason = page.getByLabel("Administrator reason");
  await expect(reason).toHaveAttribute("required", "");
  await restore.click();
  expect(
    await reason.evaluate(
      (field) => !(field as HTMLTextAreaElement).checkValidity(),
    ),
  ).toBe(true);
  await expect(reason).toBeFocused();
  await expect(page.getByText("Abandoned", { exact: true })).toBeVisible();
  await reason.fill("Browser lifecycle restoration proof");
  await restore.click();
  await expect(
    page.getByRole("status").filter({ hasText: "Cottage Profile restored." }),
  ).toBeVisible();
  await expect(page.getByText("Private draft", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Abandon draft" }),
  ).toBeEnabled();
  await page.getByRole("link", { name: "Manage Cottage Profiles" }).click();
  const submittedProfile = page
    .getByRole("article")
    .filter({ hasText: "Submitted for content approval" })
    .last();
  expect(await submittedProfile.locator("img").getAttribute("src")).toMatch(
    /^\/api\/cottage-profile-photos\/[0-9a-f-]{36}$/,
  );
  const cottageHref = await submittedProfile
    .getByRole("link", { name: "Open Cottage Profile" })
    .getAttribute("href");
  if (!cottageHref)
    throw new Error("Submitted Cottage Profile link is missing");
  const cottagePath = new URL(cottageHref, page.url()).pathname.replace(
    /^\/en/,
    "",
  );
  for (const [locale, title, status, publish] of [
    ["en", "Language review", "In review", "Publish all three languages"],
    ["ar", "مراجعة اللغات", "قيد المراجعة", "نشر اللغات الثلاث"],
    [
      "ckb",
      "پێداچوونەوەی زمان",
      "لە پێداچوونەوەدایە",
      "بڵاوکردنەوەی هەرسێ زمان",
    ],
  ] as const) {
    await page.goto(`/${locale}${cottagePath}`);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByText(status, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: publish })).toBeDisabled();
    await expect(page.getByText("shaqlawa-orchard-cottage.png")).toBeVisible();
  }
  await page.goto(`/en${cottagePath}`);
  await expect(page.getByLabel("Source description")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Delete photo" })).toHaveCount(
    0,
  );
  await expect(page.getByLabel("Choose cottage photo")).toHaveCount(0);
  {
    const profileId = cottagePath.split("/").at(-1);
    if (!profileId) throw new Error("Worker Cottage Profile id is missing");
    const reviewCycleId = await page
      .locator('input[name="reviewCycleId"]')
      .first()
      .inputValue();
    await prepareWorkerTranslations(reviewCycleId);
    await page.reload();
    for (const language of ["English", "العربية", "کوردی سۆرانی"]) {
      const languageCard = page
        .getByRole("article")
        .filter({ has: page.getByRole("heading", { name: language }) });
      const approve = languageCard.getByRole("button", {
        name: "Approve language",
      });
      const decisionForm = approve.locator("xpath=ancestor::form");
      await decisionForm
        .getByLabel("Decision reason")
        .fill("Worker review approved.");
      const actionResponse = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === new URL(page.url()).pathname,
      );
      await approve.click();
      expect((await actionResponse).ok()).toBe(true);
      await page.reload();
    }
    await setWorkerTranslationRuntimeReady(true);
    try {
      await page.reload();
      const publish = page.getByRole("button", {
        name: "Publish all three languages",
      });
      const publicationForm = publish.locator("xpath=ancestor::form");
      await publicationForm
        .getByLabel("Decision reason")
        .fill("Worker publication approved.");
      await expect(publish).toBeEnabled();
      const actionResponse = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === new URL(page.url()).pathname,
      );
      await publish.click();
      expect((await actionResponse).ok()).toBe(true);
      await expect(
        page
          .getByRole("region", { name: "Language review" })
          .getByText("Published", { exact: true }),
      ).toBeVisible();
    } finally {
      await setWorkerTranslationRuntimeReady(false);
    }
    const { data: publication, error: publicationError } = await auditClient
      .from("cottage_publication_snapshots")
      .select("id,review_cycle_id")
      .eq("profile_id", profileId)
      .single();
    if (publicationError) throw publicationError;
    const { data: publicationMedia, error: mediaError } = await auditClient
      .from("cottage_publication_media")
      .select("opaque_id,object_path")
      .eq("publication_id", publication.id)
      .eq("position", 1)
      .single();
    if (mediaError) throw mediaError;
    const { error: locatedUploadError } = await auditClient.storage
      .from("cottage-profile-photos")
      .upload(publicationMedia.object_path, locatedCottagePhoto, {
        contentType: "image/png",
        upsert: true,
      });
    if (locatedUploadError) throw locatedUploadError;
    const opaqueId = publicationMedia.opaque_id;
    const media = await request.get(`/api/cottage-media/${opaqueId}`);
    expect(media.status()).toBe(200);
    expect(media.headers()["content-type"]).toContain("image/png");
    expect(media.headers()["cache-control"]).toContain("private");
    expect(media.headers()["cache-control"]).toContain("no-store");
    expect(media.headers().location).toBeUndefined();
    expect(await media.body()).toEqual(cleanCottagePhoto);

    const { data: publishedArabic, error: publishedArabicError } =
      await auditClient
        .from("cottage_publication_localizations")
        .select("localized_revision_id")
        .eq("publication_id", publication.id)
        .eq("locale", "ar")
        .single();
    if (publishedArabicError) throw publishedArabicError;
    const ownerClient = createClient(
      process.env.SUPABASE_URL ?? "",
      process.env.SUPABASE_PUBLISHABLE_KEY ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data: publishedCycle, error: publishedCycleError } =
      await auditClient
        .from("cottage_profile_review_cycles")
        .select("owner_user_id")
        .eq("id", publication.review_cycle_id)
        .single();
    if (publishedCycleError) throw publishedCycleError;
    const fixtureUsers = await listAllAccessFixtureUsers(
      auditClient.auth.admin,
    );
    const selectedOwner = fixtureUsers.find(
      (user) => user.id === publishedCycle.owner_user_id,
    );
    if (!selectedOwner?.phone) {
      throw new Error("Selected Cottage Profile owner fixture is unavailable");
    }
    const { error: ownerSignInError } =
      await ownerClient.auth.signInWithPassword({
        phone: selectedOwner.phone,
        password: "Local-test-password-2026",
      });
    if (ownerSignInError) throw ownerSignInError;

    const { data: publishedProfile, error: profileError } = await ownerClient
      .from("owner_application_cottage_profiles")
      .select("current_shift_schedule_id")
      .eq("id", profileId)
      .single();
    if (profileError) throw profileError;
    const { data: visibilityShifts, error: shiftsError } = await ownerClient
      .from("cottage_shifts")
      .select("id")
      .eq("schedule_revision_id", publishedProfile.current_shift_schedule_id)
      .order("position");
    if (shiftsError) throw shiftsError;
    if (!visibilityShifts.length)
      throw new Error("Visibility fixture has no shifts");
    const { data: visibilitySchedule, error: scheduleError } = await ownerClient
      .from("cottage_shift_schedule_revisions")
      .select("full_day_bundle_id")
      .eq("id", publishedProfile.current_shift_schedule_id)
      .single();
    if (scheduleError) throw scheduleError;
    const { error: pricingError } = await ownerClient.rpc(
      "save_cottage_inventory_pricing",
      {
        target_profile_id: profileId,
        target_schedule_revision_id: publishedProfile.current_shift_schedule_id,
        requested_prices: {
          units: [
            ...visibilityShifts.map((shift) => ({
              unitId: shift.id,
              unitKind: "shift",
              standardPriceIqd: 180000,
            })),
            {
              unitId: visibilitySchedule.full_day_bundle_id,
              unitKind: "full_day_bundle",
              standardPriceIqd: 300000,
            },
          ],
        },
      },
    );
    if (pricingError) throw pricingError;
    const visibilityDay = new Date(Date.now() + 14 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const { error: openingError } = await ownerClient.rpc(
      "set_cottage_inventory_availability",
      {
        target_profile_id: profileId,
        target_schedule_revision_id: publishedProfile.current_shift_schedule_id,
        target_service_day: visibilityDay,
        requested_states: [
          { unitId: visibilityShifts[0].id, unitKind: "shift", state: "open" },
        ],
      },
    );
    if (openingError) throw openingError;
    const { data: otherMedia, error: otherMediaError } = await auditClient
      .from("cottage_publication_media")
      .select("opaque_id")
      .eq("publication_id", publication.id)
      .eq("position", 2)
      .single();
    if (otherMediaError) throw otherMediaError;
    const hiddenMediaUrl = `/api/cottage-media/${opaqueId}`;
    const retainedMediaUrl = `/api/cottage-media/${otherMedia.opaque_id}`;
    const slug = `cottage-${profileId.replaceAll("-", "")}`;
    const queryString = new URLSearchParams({
      from: visibilityDay,
      to: visibilityDay,
      guests: "2",
    }).toString();
    const requestedSearch = {
      from: visibilityDay,
      to: visibilityDay,
      guests: 2,
      selections: [],
      amenities: [],
    };
    const anonymousClient = createClient(
      process.env.SUPABASE_URL ?? "",
      process.env.SUPABASE_PUBLISHABLE_KEY ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const originals = new Map<
      BrowserLocale,
      {
        description: string;
        houseRules: string;
        name: string;
        capacity: number;
        approximateLocation: string;
      }
    >();
    for (const locale of ["en", "ar", "ckb"] as const) {
      const { data, error } = await anonymousClient.rpc(
        "get_public_cottage_profile",
        {
          target_locale: locale,
          target_slug: slug,
          requested_search: requestedSearch,
        },
      );
      if (error) throw error;
      expect(data.descriptionHidden).toBe(false);
      expect(typeof data.description).toBe("string");
      expect(data.description.length).toBeGreaterThan(0);
      expect(data.mediaIds).toEqual([opaqueId, otherMedia.opaque_id]);
      originals.set(locale, data);
    }
    const controlLocale = testInfo.project.name === "mobile" ? "ar" : "en";
    const visibilityCopy = cottageProfileMessages[controlLocale];
    await page.goto(`/${controlLocale}${cottagePath}`);
    const visibilityPanel = page.getByRole("region", {
      name: visibilityCopy.visibilityTitle,
    });
    const publishedDescription = visibilityPanel.getByRole("group", {
      name: visibilityCopy.visibilityDescription,
    });
    const firstPhoto = visibilityPanel.getByRole("group", {
      name: "shaqlawa-orchard-cottage.png",
    });
    const secondPhoto = visibilityPanel.getByRole("group", {
      name: "shaqlawa-orchard-second.png",
    });
    await expect(
      visibilityPanel.getByLabel(visibilityCopy.lifecycleReason),
    ).toHaveCount(3);
    const descriptionReason = publishedDescription.getByLabel(
      visibilityCopy.lifecycleReason,
    );
    await publishedDescription
      .getByRole("button", { name: visibilityCopy.visibilityHide, exact: true })
      .click();
    await expect(descriptionReason).toBeFocused();
    expect(
      await descriptionReason.evaluate(
        (field) => !(field as HTMLTextAreaElement).checkValidity(),
      ),
    ).toBe(true);
    await expect(
      publishedDescription.getByText(visibilityCopy.visibilityVisible, {
        exact: true,
      }),
    ).toBeVisible();
    await descriptionReason.fill("   ");
    await publishedDescription
      .getByRole("button", { name: visibilityCopy.visibilityHide, exact: true })
      .click();
    await expect(visibilityPanel.getByRole("alert")).toContainText(
      visibilityCopy.reasonInvalid,
    );
    await expect(descriptionReason).toHaveAttribute("aria-invalid", "true");
    const changeVisibility = async (
      group: Locator,
      hidden: boolean,
      reason: string,
    ) => {
      await group.getByLabel(visibilityCopy.lifecycleReason).fill(reason);
      const control = group.getByRole("button", {
        name: hidden
          ? visibilityCopy.visibilityHide
          : visibilityCopy.visibilityRestore,
        exact: true,
      });
      await control.focus();
      await control.press("Enter");
      await expect(
        group.getByText(
          hidden
            ? visibilityCopy.visibilityHidden
            : visibilityCopy.visibilityVisible,
          { exact: true },
        ),
      ).toBeVisible();
      await expect(visibilityPanel.getByRole("status")).toContainText(
        visibilityCopy.visibilitySaved,
      );
      await expect(
        group.getByRole("button", {
          name: hidden
            ? visibilityCopy.visibilityRestore
            : visibilityCopy.visibilityHide,
          exact: true,
        }),
      ).toBeFocused();
    };
    await changeVisibility(
      publishedDescription,
      true,
      "Hide disputed description in every language",
    );
    await changeVisibility(
      firstPhoto,
      true,
      "Hide first published photo for review",
    );
    const hiddenMedia = await request.get(hiddenMediaUrl);
    expect(hiddenMedia.status()).toBe(404);
    expect(hiddenMedia.headers()["cache-control"]).toContain("private");
    expect(hiddenMedia.headers()["cache-control"]).toContain("no-store");
    expect((await request.get(retainedMediaUrl)).status()).toBe(200);
    await firstPhoto
      .getByRole("button", { name: visibilityCopy.preview })
      .click();
    const retainedPreview = firstPhoto.getByRole("link", {
      name: visibilityCopy.preview,
    });
    await expect(retainedPreview).toBeVisible();
    const privatePhotoUrl = await retainedPreview.getAttribute("href");
    if (!privatePhotoUrl)
      throw new Error("Hidden photo private preview is missing");
    expect((await page.request.get(privatePhotoUrl)).status()).toBe(200);
    await secondPhoto
      .getByLabel(visibilityCopy.lifecycleReason)
      .fill("Cannot hide the last approved photo");
    const lastPhotoControl = secondPhoto.getByRole("button", {
      name: visibilityCopy.visibilityHide,
      exact: true,
    });
    await lastPhotoControl.focus();
    await lastPhotoControl.press("Enter");
    await expect(visibilityPanel.getByRole("alert")).toContainText(
      visibilityCopy.visibilityLastPhoto,
    );
    await expect(
      secondPhoto.getByText(visibilityCopy.visibilityVisible, { exact: true }),
    ).toBeVisible();
    await expect(lastPhotoControl).toBeFocused();
    const panelMeasurements = await visibilityPanel.evaluate((panel) => {
      const controls = [...panel.querySelectorAll<HTMLButtonElement>("button")];
      const action = panel.querySelector<HTMLButtonElement>(
        "button.action-secondary",
      );
      if (!action) throw new Error("Visibility action is missing");
      const style = getComputedStyle(action);
      return {
        noOverflow:
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
        targets: controls.every(
          (control) =>
            control.getBoundingClientRect().height >= 44 &&
            control.getBoundingClientRect().width >= 44,
        ),
        color: style.color,
        background: style.backgroundColor,
        focusRing: getComputedStyle(document.activeElement!)
          .boxShadow.match(/rgba?\([^)]+\)/g)
          ?.at(-1),
        focus:
          getComputedStyle(document.activeElement!).outlineStyle !== "none" &&
          getComputedStyle(document.activeElement!).outlineWidth !== "0px",
      };
    });
    expect(panelMeasurements.noOverflow).toBe(true);
    expect(panelMeasurements.targets).toBe(true);
    expect(panelMeasurements.focus).toBe(true);
    const luminance = (color: string) => {
      const channels = color
        .match(/[\d.]+/g)
        ?.slice(0, 3)
        .map(Number);
      if (!channels || channels.length !== 3)
        throw new Error("Visibility contrast color is unavailable");
      const linear = channels.map((channel) =>
        channel / 255 <= 0.04045
          ? channel / 255 / 12.92
          : ((channel / 255 + 0.055) / 1.055) ** 2.4,
      );
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    };
    const contrast = (first: string, second: string) => {
      const values = [luminance(first), luminance(second)].sort(
        (a, b) => b - a,
      );
      return (values[0] + 0.05) / (values[1] + 0.05);
    };
    expect(
      contrast(panelMeasurements.color, panelMeasurements.background),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(panelMeasurements.focusRing ?? "", panelMeasurements.background),
    ).toBeGreaterThanOrEqual(3);
    if (
      testInfo.project.name === "desktop" ||
      testInfo.project.name === "mobile"
    ) {
      await visibilityPanel.screenshot({
        path: testInfo.outputPath(
          `visibility-admin-${controlLocale}-${testInfo.project.name}.png`,
        ),
      });
    }
    const browser = page.context().browser();
    if (!browser)
      throw new Error("Anonymous visibility browser is unavailable");
    const publicContext = await browser.newContext({
      baseURL: new URL(page.url()).origin,
      viewport: page.viewportSize()!,
    });
    const publicPage = await publicContext.newPage();
    try {
      for (const [
        locale,
        hiddenSentence,
        rulesHeading,
        bookingHeading,
        quote,
      ] of [
        [
          "en",
          "The description is temporarily hidden.",
          "House Rules",
          "Choose your Booking Period",
          "Get exact quote",
        ],
        [
          "ar",
          "الوصف مخفي مؤقتًا.",
          "قواعد البيت",
          "اختر فترة الحجز",
          "عرض السعر الدقيق",
        ],
        [
          "ckb",
          "وەسفەکە کاتییانە شاردراوەتەوە.",
          "یاساکانی کۆتێج",
          "ماوەی حجزەکەت هەڵبژێرە",
          "پێشنیاری نرخی ورد",
        ],
      ] as const) {
        const original = originals.get(locale);
        if (!original)
          throw new Error("Published visibility baseline is missing");
        const { data, error } = await anonymousClient.rpc(
          "get_public_cottage_profile",
          {
            target_locale: locale,
            target_slug: slug,
            requested_search: requestedSearch,
          },
        );
        if (error) throw error;
        expect(data).toMatchObject({
          descriptionHidden: true,
          description: null,
          houseRules: original.houseRules,
          name: original.name,
          capacity: original.capacity,
          approximateLocation: original.approximateLocation,
          mediaIds: [otherMedia.opaque_id],
        });
        await publicPage.goto(`/${locale}/cottages/${slug}?${queryString}`);
        await expect(publicPage.locator("html")).toHaveAttribute(
          "dir",
          locale === "en" ? "ltr" : "rtl",
        );
        await expect(
          publicPage.getByText(hiddenSentence, { exact: true }),
        ).toBeVisible();
        await expect(
          publicPage.getByRole("heading", { name: rulesHeading, exact: true }),
        ).toBeVisible();
        await expect(
          publicPage.getByText(original.houseRules, { exact: true }),
        ).toBeVisible();
        await expect(
          publicPage.locator(".profile-main-image img"),
        ).toHaveAttribute("src", retainedMediaUrl);
        expect(await publicPage.content()).not.toContain(hiddenMediaUrl);
        expect(await publicPage.content()).not.toContain(original.description);
        await expect(
          publicPage.getByRole("heading", {
            name: bookingHeading,
            exact: true,
          }),
        ).toBeVisible();
        await publicPage
          .locator('.booking-summary button[aria-pressed="false"]:enabled')
          .first()
          .click();
        await expect(
          publicPage.getByRole("link", { name: quote, exact: true }),
        ).toBeVisible();
        if (
          (locale === "en" && testInfo.project.name === "desktop") ||
          (locale === "ar" && testInfo.project.name === "mobile")
        ) {
          await publicPage.screenshot({
            path: testInfo.outputPath(
              `visibility-public-${locale}-${testInfo.project.name}.png`,
            ),
            fullPage: true,
          });
        }
      }
      await publicPage.goto(`/en/results?${queryString}`);
      const resultCard = publicPage.getByRole("article").filter({
        has: publicPage.locator(`a[href^="/en/cottages/${slug}?"]`),
      });
      await expect(resultCard).toBeVisible();
      await expect(resultCard.locator("img")).toHaveAttribute(
        "src",
        retainedMediaUrl,
      );
      expect(await resultCard.innerHTML()).not.toContain(hiddenMediaUrl);
      await changeVisibility(
        firstPhoto,
        false,
        "Restore first approved photo after review",
      );
      await changeVisibility(
        publishedDescription,
        false,
        "Restore approved description in every language",
      );
      expect((await request.get(hiddenMediaUrl)).status()).toBe(200);
      for (const locale of ["en", "ar", "ckb"] as const) {
        await publicPage.goto(`/${locale}/cottages/${slug}?${queryString}`);
        await expect(
          publicPage.getByText(originals.get(locale)!.description, {
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          publicPage.locator(".profile-main-image img"),
        ).toHaveAttribute("src", hiddenMediaUrl);
      }
      await publicPage.goto(`/en/results?${queryString}`);
      await expect(resultCard.locator("img")).toHaveAttribute(
        "src",
        hiddenMediaUrl,
      );
    } finally {
      await publicContext.close();
    }

    await page.goto(`/en${cottagePath}`);
    {
      const returnUrl = page.url();
      const bookingOwner = findAccessFixtureUser(
        await listAllAccessFixtureUsers(auditClient.auth.admin),
        reviewFixture.bookingOwnerPhone,
      );
      if (!bookingOwner || !uuidPattern.test(bookingOwner.id))
        throw new Error("Verification preservation owner is unavailable");
      const targets = JSON.parse(
        database.runSql(`
        select coalesce(jsonb_agg(jsonb_build_object(
          'applicationId', applications.id, 'profileId', profiles.id,
          'publicationId', profiles.current_publication_id,
          'scheduleId', profiles.current_shift_schedule_id,
          'publicationProfileId', publications.profile_id, 'name', publications.name
        )), '[]'::jsonb)
        from public.owner_applications applications
        join public.owner_application_cottage_profiles profiles
          on profiles.application_id = applications.id
          and profiles.owner_user_id = applications.owner_user_id
        join public.cottage_publication_snapshots publications
          on publications.id = profiles.current_publication_id
        where applications.owner_user_id = '${bookingOwner.id}'::uuid
          and applications.status = 'approved';
      `),
      ) as {
        applicationId: string;
        profileId: string;
        publicationId: string;
        scheduleId: string;
        publicationProfileId: string;
        name: string;
      }[];
      if (
        targets.length !== 1 ||
        ![
          targets[0].applicationId,
          targets[0].profileId,
          targets[0].publicationId,
          targets[0].scheduleId,
        ].every((id) => uuidPattern.test(id)) ||
        targets[0].publicationProfileId !== targets[0].profileId ||
        targets[0].name !== reviewFixture.bookingCottageName
      )
        throw new Error("Verification preservation profile linkage is invalid");
      const target = targets[0];
      const readDocuments = async () => {
        const metadata = JSON.parse(
          database.runSql(`
          select coalesce(jsonb_agg(to_jsonb(document) order by document.id), '[]'::jsonb)
          from public.owner_verification_documents document
          where document.application_id = '${target.applicationId}'::uuid;
        `),
        ) as (Record<string, unknown> & {
          id: string;
          application_id: string;
          object_path: string;
          size_bytes: number;
        })[];
        if (
          !metadata.length ||
          new Set(metadata.map((document) => document.id)).size !==
            metadata.length ||
          metadata.some(
            (document) =>
              !uuidPattern.test(document.id) ||
              document.application_id !== target.applicationId ||
              typeof document.object_path !== "string" ||
              !document.object_path.trim() ||
              !Number.isInteger(document.size_bytes) ||
              document.size_bytes < 1,
          )
        )
          throw new Error(
            "Verification preservation document metadata is incomplete",
          );
        const bytes = new Map<string, Buffer>();
        for (const document of metadata) {
          const { data, error } = await auditClient.storage
            .from("owner-verification")
            .download(document.object_path);
          if (error || !data)
            throw new Error(
              "Verification preservation document download failed",
            );
          const content = Buffer.from(await data.arrayBuffer());
          if (!content.length || content.length !== document.size_bytes)
            throw new Error(
              "Verification preservation document bytes are incomplete",
            );
          bytes.set(document.id, content);
        }
        return { metadata: JSON.stringify(metadata), bytes };
      };
      const baseline = await readDocuments();
      const expectDocumentsPreserved = async () => {
        const current = await readDocuments();
        expect(
          current.metadata === baseline.metadata,
          "Verification document metadata must remain unchanged",
        ).toBe(true);
        expect(
          current.bytes.size === baseline.bytes.size &&
            [...baseline.bytes].every(
              ([id, bytes]) => current.bytes.get(id)?.equals(bytes) === true,
            ),
          "Verification document bytes must remain unchanged",
        ).toBe(true);
      };
      await page.goto(`/en/administrator/cottages/${target.profileId}`);
      const source = page.getByRole("textbox", {
        name: "Source description",
        exact: true,
      });
      const original = await source.inputValue();
      if (!original.trim())
        throw new Error(
          "Verification preservation source description is missing",
        );
      await source.fill(`${original} Verification preservation edit.`);
      const save = page.getByRole("button", {
        name: "Save private draft",
        exact: true,
      });
      const editForm = save.locator("xpath=ancestor::form");
      await editForm
        .getByLabel("Administrator reason")
        .fill("Verify owner document preservation");
      await save.click();
      await expect(
        editForm
          .getByRole("status")
          .filter({ hasText: "Private draft saved." }),
      ).toContainText("Private draft saved.");
      await expectDocumentsPreserved();
      const panel = page.getByRole("region", { name: "Public visibility" });
      const description = panel.getByRole("group", {
        name: "Published description",
      });
      await description
        .getByLabel("Administrator reason")
        .fill("Verify owner document preservation while hidden");
      await description
        .getByRole("button", { name: "Hide", exact: true })
        .click();
      await expect(
        description.getByText("Hidden", { exact: true }),
      ).toBeVisible();
      await expect(panel.getByRole("status")).toContainText(
        "Public visibility saved.",
      );
      await expectDocumentsPreserved();
      await description
        .getByLabel("Administrator reason")
        .fill("Restore description after owner document preservation check");
      await description
        .getByRole("button", { name: "Restore", exact: true })
        .click();
      await expect(
        description.getByText("Visible", { exact: true }),
      ).toBeVisible();
      await expect(panel.getByRole("status")).toContainText(
        "Public visibility saved.",
      );
      await expectDocumentsPreserved();
      await page.goto(returnUrl);
    }

    const reportReason = "The published Arabic meaning is incorrect";
    const { error: reportError } = await ownerClient.rpc(
      "report_current_cottage_translation",
      {
        target_review_cycle_id: publication.review_cycle_id,
        target_localized_revision_id: publishedArabic.localized_revision_id,
        target_reason: reportReason,
      },
    );
    if (reportError) throw reportError;

    await page.reload();
    expect(
      await ownerClient
        .from("owner_application_cottage_profiles")
        .select("current_publication_id,current_shift_schedule_id")
        .eq("id", profileId)
        .single(),
    ).toMatchObject({
      data: {
        current_publication_id: publication.id,
        current_shift_schedule_id: expect.any(String),
      },
      error: null,
    });
    await expect(page.getByText(`Owner report: ${reportReason}`)).toBeVisible();
    const affectedLocalization = page
      .getByRole("article")
      .filter({ hasText: reportReason });
    await expect(
      affectedLocalization.getByRole("button", {
        name: "Route to human review",
      }),
    ).toBeVisible();
    for (const [locale, strongerLabel] of [
      ["en", "Reprocess with stronger model"],
      ["ar", "إعادة المعالجة باستخدام نموذج أقوى"],
      ["ckb", "دووبارە پرۆسەکردن بە مۆدێلی بەهێزتر"],
    ] as const) {
      await page.goto(`/${locale}${cottagePath}`);
      const reportedLocalization = page
        .getByRole("article")
        .filter({ hasText: reportReason });
      await expect(
        reportedLocalization.getByRole("button", {
          name: `${strongerLabel} العربية`,
        }),
      ).toBeVisible();
    }
    await page.goto(`/en${cottagePath}`);
  }
  await page.getByRole("link", { name: "Manage Cottage Profiles" }).click();
  await expect(
    page.getByRole("heading", { name: "Private Cottage Profiles" }),
  ).toBeVisible();
  const publishedCottageCard = page
    .getByRole("article")
    .filter({ has: page.locator(`a[href="${cottageHref}"]`) });
  await expect(
    publishedCottageCard.getByText("Published", { exact: true }),
  ).toBeVisible();
  await expect(
    publishedCottageCard.getByText("Private draft", { exact: true }),
  ).toHaveCount(0);

  await page.goto("/en/administrator/owner-applications");
  const accessedAfter = new Date(Date.now() - 5_000).toISOString();
  for (const locale of ["en", "ar", "ckb"] as const) {
    const copy = browserFixtures[locale].review;
    const direction = locale === "en" ? "ltr" : "rtl";
    await page.goto(`/${locale}/administrator/owner-applications`);
    await expect(page.locator("html")).toHaveAttribute("dir", direction);
    await expect(page.getByRole("heading", { name: copy.title })).toBeVisible();
    const reviewApplication = page
      .locator("article")
      .filter({ hasText: reviewFixture.reviewLegalName });
    await expect(
      reviewApplication.getByText(reviewDocumentFilename),
    ).toBeVisible();
    const identityDocument = reviewApplication
      .locator("li")
      .filter({ hasText: reviewDocumentFilename })
      .first();
    const createLink = identityDocument.getByRole("button", {
      name: copy.createLink,
    });
    const secureLinkControl = createLink;
    await secureLinkControl.focus();
    await expect(secureLinkControl).toBeFocused();
    const secureLinkSource = await secureLinkControl.elementHandle();
    if (!secureLinkSource) throw new Error("Focus source is missing");
    await secureLinkControl.press("Enter");
    const secureLink = identityDocument.getByRole("link", {
      name: copy.openDocument,
    });
    await expect(secureLink).toBeVisible();
    await expect(secureLinkControl).toBeFocused();
    expect(
      await secureLinkSource.evaluate(
        (source) => document.activeElement === source,
      ),
    ).toBe(true);
    await secureLinkSource.dispose();

    const viewport = page.viewportSize();
    if (!viewport) throw new Error("Browser viewport is unavailable");
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
    const controlBox = await createLink.boundingBox();
    expect(controlBox?.x).toBeGreaterThanOrEqual(0);
    expect((controlBox?.x ?? 0) + (controlBox?.width ?? 0)).toBeLessThanOrEqual(
      viewport.width,
    );
    const filenameGeometry = await identityDocument
      .getByText(reviewDocumentFilename)
      .evaluate((element) => {
        const row = element.closest(".administrator-review-document");
        if (!row) throw new Error("Filename is not inside a review row");
        if (!element.textContent) throw new Error("Filename text is missing");
        const rowBox = row.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(element);
        const lineBoxes = [...range.getClientRects()];
        return {
          lineCount: lineBoxes.length,
          staysInsideRow: lineBoxes.every(
            (box) =>
              box.left >= rowBox.left - 1 && box.right <= rowBox.right + 1,
          ),
          wrapsAnywhere: getComputedStyle(element).overflowWrap === "anywhere",
        };
      });
    expect(filenameGeometry.staysInsideRow).toBe(true);
    expect(filenameGeometry.wrapsAnywhere).toBe(true);
    if (testInfo.project.name === "mobile") {
      expect(filenameGeometry.lineCount).toBeGreaterThan(1);
    }
  }
  const finalCopy = browserFixtures.ckb.review;
  const signedUrl = await page
    .locator("article")
    .filter({ hasText: reviewFixture.reviewLegalName })
    .locator("li")
    .filter({ hasText: reviewDocumentFilename })
    .first()
    .getByRole("link", { name: finalCopy.openDocument })
    .getAttribute("href");
  if (!signedUrl) throw new Error("Secure document link has no URL");
  const documentResponse = await page.request.get(signedUrl);
  expect(documentResponse.status()).toBe(200);
  expect(documentResponse.headers()["content-type"]).toContain(
    "application/pdf",
  );
  expect((await documentResponse.body()).subarray(0, 4).toString()).toBe(
    "%PDF",
  );
  const documentAudit = await currentDocumentAccessAudit(
    actorUserId,
    accessedAfter,
  );
  expect(documentAudit.actor_user_id).toBe(actorUserId);
  expect(documentAudit.actor_subject_id).toBe(actorUserId);
  expect(documentAudit.action).toBe("access_granted");
  expect(uuidPattern.test(documentAudit.document_id)).toBe(true);
  expect(decodeURIComponent(new URL(signedUrl).pathname)).toContain(
    `/owner-verification/${documentAudit.object_path}`,
  );

  await page.goto("/en/administrator/owner-applications");
  const applicationCard = page
    .locator("article")
    .filter({ hasText: reviewFixture.reviewLegalName });
  await applicationCard.getByRole("link", { name: "Open application" }).click();
  await expect(
    page.getByRole("heading", { name: "Owner Application review" }),
  ).toBeVisible();
  await expect(page.getByText(reviewFixture.exactAddress)).toBeVisible();

  await page.getByRole("button", { name: "Start review" }).click();
  const currentAdministratorStatus = page
    .locator(".administrator-review-detail > .page-heading")
    .first()
    .locator(".application-status");
  await expect(currentAdministratorStatus).toHaveText("Under review");
  const informationRequest = page
    .locator("form.review-action-card")
    .filter({ hasText: "Request missing information" });
  await informationRequest
    .getByLabel("Reason")
    .fill("Confirm the exact private address and replace identity evidence.");
  await informationRequest.getByLabel("Exact private address").check();
  await informationRequest.getByLabel("Identity evidence").check();
  await informationRequest
    .getByRole("button", { name: "Request missing information" })
    .click();
  await expect(currentAdministratorStatus).toHaveText("Needs information");

  await page.goto("/en/owner/access");
  await expect(
    page.getByRole("heading", {
      name: "This booking is not available to this account. Sign out to use another account.",
    }),
  ).toBeVisible();
  await page
    .getByRole("main")
    .getByRole("button", { name: "Sign out" })
    .click();
  await expect(page).toHaveURL(/\/en$/);
  await page.goto("/en/owner/access");
  await page
    .getByLabel("Iraqi phone number")
    .fill(reviewFixture.reviewOwnerPhone);
  await page.getByRole("button", { name: "Send verification code" }).click();
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page).toHaveURL(/\/en\/owner\/application$/);
  await expect(
    page
      .locator(".owner-review-status")
      .getByText("Needs information", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".owner-response-card")
      .getByText(
        "Confirm the exact private address and replace identity evidence.",
      ),
  ).toBeVisible();
  const ownerResponseCard = page.locator(".owner-response-card");
  await expect(
    ownerResponseCard.getByLabel("Exact private address"),
  ).toBeVisible();
  const replacementCard = ownerResponseCard.getByRole("article", {
    name: "Identity evidence",
  });
  await replacementCard.locator('input[type="file"]').setInputFiles({
    name: "replacement-identity.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\nreplacement identity\n%%EOF"),
  });
  await replacementCard
    .getByRole("button", { name: "Replace document" })
    .click();
  await expect(
    replacementCard.getByText("replacement-identity.pdf"),
  ).toBeVisible();
  await ownerResponseCard
    .getByLabel("Exact private address")
    .fill("Confirmed orchard road");
  await page
    .getByRole("button", { name: "Send requested information" })
    .click();
  await expect(
    page
      .locator(".owner-review-status")
      .getByText("Under review", { exact: true }),
  ).toBeVisible();
});

test("an empty administrator password is recorded as a failed attempt", async ({
  page,
}, testInfo) => {
  const email = `platform-administrator-${testInfo.project.name}@rentcottage.test`;
  const actorUserId = await administratorId(email);
  const attemptedAfter = new Date().toISOString();
  await page.goto("/en/administrator/access");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByText(/sign-in is invalid/)).toBeVisible();
  const audit = await currentAudit(
    actorUserId,
    attemptedAfter,
    "primary",
    "failed",
  );
  expect(audit.actor_user_id).toBe(actorUserId);
  expect(audit.email_digest).toBe(expectedEmailDigest(email));
});

test("failed administrator sign-in gives no privileged access", async ({
  page,
}, testInfo) => {
  const email = `platform-administrator-${testInfo.project.name}@rentcottage.test`;
  const actorUserId = await administratorId(email);
  const attemptedAfter = new Date().toISOString();
  await page.goto("/en/administrator/access");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByText(/sign-in is invalid/)).toBeVisible();
  await expect(page.getByLabel("Authenticator app code")).toHaveCount(0);
  const audit = await currentAudit(
    actorUserId,
    attemptedAfter,
    "primary",
    "failed",
  );
  expect(audit.actor_user_id).toBe(actorUserId);
  expect(audit.email_digest).toBe(expectedEmailDigest(email));
  expect(new Date(audit.attempted_at).getTime()).toBeGreaterThanOrEqual(
    new Date(attemptedAfter).getTime(),
  );
});

test("anonymous discovery uses live approved inventory and preserves its query", async ({
  page,
  baseURL,
  browser,
}, testInfo) => {
  assertIsolatedLocalAccessDatabase();
  const requestedOrigins = new Set<string>();
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol !== "data:" && url.protocol !== "blob:") {
      requestedOrigins.add(url.origin);
    }
  });
  const ownerPhoneByProject: Record<string, string> = {
    mobile: "+9647510000000",
    desktop: "+9647510000001",
    worker: "+9647510000002",
  };
  const ownerPhone = ownerPhoneByProject[testInfo.project.name];
  if (!ownerPhone) throw new Error("Discovery owner fixture is unmapped");
  const fixtureOwner = createClient(
    process.env.SUPABASE_URL ?? "",
    process.env.SUPABASE_PUBLISHABLE_KEY ?? "",
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { error: fixtureSignInError } =
    await fixtureOwner.auth.signInWithPassword({
      phone: ownerPhone,
      password: "Local-test-password-2026",
    });
  if (fixtureSignInError) throw fixtureSignInError;
  const { data: profiles, error: profilesError } = await fixtureOwner
    .from("owner_application_cottage_profiles")
    .select(
      "id,current_publication_id,current_shift_schedule_id,exact_address,exact_latitude,exact_longitude,private_directions",
    )
    .not("current_publication_id", "is", null)
    .order("updated_at", { ascending: false });
  if (profilesError) throw profilesError;
  let fixture;
  const fixtureDiagnostics = [];
  for (const profile of profiles) {
    if (!profile.current_shift_schedule_id || !profile.current_publication_id) {
      fixtureDiagnostics.push({
        publicationId: profile.current_publication_id,
        profileId: profile.id,
        reason: !profile?.current_shift_schedule_id
          ? "missing current Shift Schedule"
          : "publication is not current",
      });
      continue;
    }
    const { data: publication, error: publicationError } = await auditClient
      .from("cottage_publication_snapshots")
      .select("id,profile_id,name,approximate_location")
      .eq("id", profile.current_publication_id)
      .eq("profile_id", profile.id)
      .maybeSingle();
    if (publicationError) throw publicationError;
    if (!publication) {
      fixtureDiagnostics.push({
        publicationId: profile.current_publication_id,
        profileId: profile.id,
        reason: "current publication snapshot is missing",
      });
      continue;
    }
    const { data: englishLocalization, error: englishLocalizationError } =
      await auditClient
        .from("cottage_publication_localizations")
        .select("publication_id")
        .eq("publication_id", publication.id)
        .eq("locale", "en")
        .maybeSingle();
    if (englishLocalizationError) throw englishLocalizationError;
    if (!englishLocalization) {
      fixtureDiagnostics.push({
        publicationId: publication.id,
        profileId: publication.profile_id,
        reason: "missing English localization",
      });
      continue;
    }
    const { data: arabicLocalization, error: arabicLocalizationError } =
      await auditClient
        .from("cottage_publication_localizations")
        .select("description")
        .eq("publication_id", publication.id)
        .eq("locale", "ar")
        .single();
    if (arabicLocalizationError) throw arabicLocalizationError;
    const { data: soraniLocalization, error: soraniLocalizationError } =
      await auditClient
        .from("cottage_publication_localizations")
        .select("description")
        .eq("publication_id", publication.id)
        .eq("locale", "ckb")
        .single();
    if (soraniLocalizationError) throw soraniLocalizationError;
    fixture = {
      name: publication.name,
      approximateLocation: publication.approximate_location,
      arabicDescription: arabicLocalization.description,
      soraniDescription: soraniLocalization.description,
      slug: `cottage-${profile.id.replaceAll("-", "")}`,
      profileId: profile.id,
      exactAddress: profile.exact_address,
      exactLatitude: profile.exact_latitude,
      exactLongitude: profile.exact_longitude,
      privateDirections: profile.private_directions,
      scheduleId: profile.current_shift_schedule_id,
    };
    break;
  }
  expect(fixture, JSON.stringify(fixtureDiagnostics)).toBeDefined();
  if (
    typeof fixture!.exactAddress !== "string" ||
    fixture!.exactAddress.trim() === "" ||
    typeof fixture!.privateDirections !== "string" ||
    fixture!.privateDirections.trim() === "" ||
    typeof fixture!.exactLatitude !== "number" ||
    typeof fixture!.exactLongitude !== "number"
  ) {
    throw new Error(
      "Published Cottage Profile fixture needs private address, directions and coordinates",
    );
  }
  const privateValues = [
    fixture!.exactAddress,
    fixture!.privateDirections,
    String(fixture!.exactLatitude),
    String(fixture!.exactLongitude),
  ];
  const expectPrivateValuesAbsent = async () => {
    for (const privateValue of privateValues) {
      await expect(page.locator("body")).not.toContainText(privateValue);
    }
    const serializedPage = await page.content();
    for (const privateValue of privateValues) {
      expect(serializedPage).not.toContain(privateValue);
    }
  };
  const { data: shifts, error: shiftsError } = await fixtureOwner
    .from("cottage_shifts")
    .select("id,position,name,start_time,end_time")
    .eq("schedule_revision_id", fixture!.scheduleId)
    .order("position");
  if (shiftsError) throw shiftsError;
  const { data: schedule, error: scheduleError } = await fixtureOwner
    .from("cottage_shift_schedule_revisions")
    .select("full_day_bundle_id")
    .eq("id", fixture!.scheduleId)
    .single();
  if (scheduleError) throw scheduleError;
  const firstShift = shifts[0];
  const secondShift = shifts[1];
  const lastShift = shifts.at(-1);
  expect(firstShift).toBeDefined();
  expect(secondShift).toBeDefined();
  expect(lastShift).toBeDefined();
  expect(schedule.full_day_bundle_id).toBeTruthy();
  const serviceDay = (offset: number) => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Baghdad",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(Date.now() + offset * 86_400_000));
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value ?? "";
    return `${value("year")}-${value("month")}-${value("day")}`;
  };
  const firstDay = serviceDay(1);
  const secondDay = serviceDay(2);
  const serviceDayLabel = (day: string) =>
    new Intl.DateTimeFormat("en-IQ", {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(new Date(`${day}T00:00:00Z`));
  const fullDayEndDay =
    lastShift!.end_time < firstShift.start_time ? serviceDay(3) : secondDay;
  const formatEnglishIraqDateTime = (value: string) =>
    new Intl.DateTimeFormat("en-IQ", {
      dateStyle: "medium",
      timeStyle: "short",
      hourCycle: "h23",
      timeZone: "Asia/Baghdad",
    }).format(new Date(value));
  const expectedFullDayAccessRange = `Arrival: ${formatEnglishIraqDateTime(
    `${firstDay}T${firstShift.start_time}+03:00`,
  )} Departure: ${formatEnglishIraqDateTime(
    `${fullDayEndDay}T${lastShift!.end_time}+03:00`,
  )} All times are Iraq local time (UTC+3).`;
  const { error: priceError } = await fixtureOwner.rpc(
    "save_cottage_inventory_pricing",
    {
      target_profile_id: fixture!.profileId,
      target_schedule_revision_id: fixture!.scheduleId,
      requested_prices: {
        units: [
          ...shifts.map((shift) => ({
            unitId: shift.id,
            unitKind: "shift",
            standardPriceIqd: 170000 + shift.position * 10000,
          })),
          {
            unitId: schedule.full_day_bundle_id,
            unitKind: "full_day_bundle",
            standardPriceIqd: 250000,
            dateOverrides: [{ serviceDay: secondDay, priceIqd: 260000 }],
          },
        ],
      },
    },
  );
  if (priceError) throw priceError;
  for (const [requestedDay, requestedStates] of [
    [
      firstDay,
      [
        ...shifts.map((shift) => ({
          unitId: shift.id,
          unitKind: "shift",
          state: "closed",
        })),
        {
          unitId: schedule.full_day_bundle_id,
          unitKind: "full_day_bundle",
          state: "closed",
        },
      ],
    ],
    [
      secondDay,
      [
        ...shifts.map((shift) => ({
          unitId: shift.id,
          unitKind: "shift",
          state: "closed",
        })),
        {
          unitId: schedule.full_day_bundle_id,
          unitKind: "full_day_bundle",
          state: "closed",
        },
      ],
    ],
  ] as const) {
    const { error: availabilityError } = await fixtureOwner.rpc(
      "set_cottage_inventory_availability",
      {
        target_profile_id: fixture!.profileId,
        target_schedule_revision_id: fixture!.scheduleId,
        target_service_day: requestedDay,
        requested_states: requestedStates,
      },
    );
    if (availabilityError) throw availabilityError;
  }

  type CalendarReadback = {
    days: {
      serviceDay: string;
      units: {
        id: string;
        kind: string;
        ownerState: string;
        priceIqd: number | null;
        available: boolean;
      }[];
    }[];
  };
  const { data: closedCalendarData, error: closedCalendarError } =
    await fixtureOwner.rpc("resolve_cottage_inventory_owner_calendar_span", {
      target_profile_id: fixture!.profileId,
      target_schedule_revision_id: fixture!.scheduleId,
      target_from: firstDay,
      target_to: secondDay,
    });
  if (closedCalendarError) throw closedCalendarError;
  const closedCalendar = closedCalendarData as CalendarReadback;
  const originalPrices = closedCalendar.days.flatMap((day) =>
    day.units.map((unit) => ({
      serviceDay: day.serviceDay,
      id: unit.id,
      kind: unit.kind,
      priceIqd: unit.priceIqd,
    })),
  );
  const ownerContext = await browser.newContext({
    baseURL,
    viewport: page.viewportSize(),
  });
  try {
    const ownerPage = await ownerContext.newPage();
    const copy = cottagePricingAvailabilityMessages.en;
    const scheduleCopy = cottageShiftScheduleMessages.en;
    await ownerPage.goto("/en/owner/access");
    await ownerPage.getByLabel("Iraqi phone number").fill(ownerPhone);
    await ownerPage
      .getByRole("button", { name: "Send verification code" })
      .click();
    await ownerPage.getByLabel("Verification code").fill("123456");
    await ownerPage
      .getByRole("button", { name: "Verify", exact: true })
      .click();
    await expect(ownerPage).toHaveURL(/\/en\/owner\/cottages$/);
    await ownerPage.goto(`/en/owner/cottages/${fixture!.profileId}`);
    const month = ownerPage.locator(".cottage-calendar");
    const panel = ownerPage.getByRole("region", {
      name: copy.batchHeading as string,
      exact: true,
    });
    await expect(panel.getByLabel(copy.batchFrom as string)).toBeVisible();
    await month.getByLabel(copy.calendarShowDate as string).fill(firstDay);
    await expect(
      month
        .getByRole("status")
        .filter({ hasText: copy.calendarLoaded as string }),
    ).toBeVisible();
    const unitOptions = panel.getByRole("group", {
      name: copy.batchUnits as string,
    });
    await expect(unitOptions.getByRole("checkbox")).toHaveCount(
      shifts.length + 1,
    );
    const shiftLabels = shifts.map(
      (shift) =>
        `${shifts.length === 3 ? `${scheduleCopy.shift} ${shift.position}` : shift.position === 1 ? scheduleCopy.morning : scheduleCopy.evening}: ${shift.name}`,
    );
    for (const label of [...shiftLabels, scheduleCopy.fullDay])
      await unitOptions
        .getByRole("checkbox", { name: label, exact: true })
        .check();
    await panel.getByLabel(copy.batchFrom as string).fill(firstDay);
    await panel.getByLabel(copy.batchTo as string).fill(secondDay);
    await panel.getByLabel(copy.batchState as string).selectOption("open");
    await panel
      .getByRole("button", { name: copy.batchReview as string, exact: true })
      .click();
    const included = panel.getByRole("list", {
      name: copy.batchIncluded as string,
      exact: true,
    });
    await expect(included.getByRole("listitem")).toHaveCount(
      2 * (shifts.length + 1),
    );
    for (const row of await included.getByRole("listitem").all()) {
      await expect(
        row.getByText(`${copy.batchCurrent}: ${copy.closed}`, { exact: true }),
      ).toBeVisible();
      await expect(
        row.getByText(`${copy.batchProposed}: ${copy.open}`, { exact: true }),
      ).toBeVisible();
    }
    const { error: concurrentBlockError } = await fixtureOwner.rpc(
      "set_cottage_inventory_availability",
      {
        target_profile_id: fixture!.profileId,
        target_schedule_revision_id: fixture!.scheduleId,
        target_service_day: firstDay,
        requested_states: [
          {
            unitId: firstShift.id,
            unitKind: "shift",
            state: "private_blocked",
          },
        ],
      },
    );
    if (concurrentBlockError) throw concurrentBlockError;
    const apply = panel.getByRole("button", {
      name: copy.batchApply as string,
      exact: true,
    });
    await apply.focus();
    await expect(apply).toBeFocused();
    await apply.press("Enter");
    await expect(
      panel.getByRole("alert").filter({ hasText: copy.batchRefused as string }),
    ).toBeVisible();
    await expect(
      panel.getByRole("heading", {
        name: copy.batchHeading as string,
        exact: true,
      }),
    ).toBeFocused();
    const excluded = panel.getByRole("list", {
      name: copy.batchExcluded as string,
      exact: true,
    });
    await expect(excluded.getByRole("listitem")).toHaveCount(2);
    await expect(
      excluded.getByRole("listitem").filter({ hasText: firstShift.name }),
    ).toContainText(copy.reasonStale as string);
    await expect(
      excluded.getByRole("listitem").filter({ hasText: scheduleCopy.fullDay }),
    ).toContainText(copy.reasonComponents as string);
    await expect(
      panel
        .getByRole("list", { name: copy.batchEligible as string, exact: true })
        .getByRole("listitem"),
    ).toHaveCount(2 * (shifts.length + 1) - 2);
    const { data: refusalData, error: refusalError } = await fixtureOwner.rpc(
      "resolve_cottage_inventory_owner_calendar_span",
      {
        target_profile_id: fixture!.profileId,
        target_schedule_revision_id: fixture!.scheduleId,
        target_from: firstDay,
        target_to: secondDay,
      },
    );
    if (refusalError) throw refusalError;
    const refusalReadback = refusalData as CalendarReadback;
    for (const day of refusalReadback.days)
      for (const unit of day.units)
        expect(unit.ownerState).toBe(
          day.serviceDay === firstDay && unit.id === firstShift.id
            ? "private_blocked"
            : "closed",
        );
    expect(
      refusalReadback.days.flatMap((day) =>
        day.units.map((unit) => ({
          serviceDay: day.serviceDay,
          id: unit.id,
          kind: unit.kind,
          priceIqd: unit.priceIqd,
        })),
      ),
    ).toEqual(originalPrices);
    const ownerViewport = ownerPage.viewportSize()!;
    if (testInfo.project.name === "mobile") {
      await ownerPage.setViewportSize({
        width: 320,
        height: ownerViewport.height,
      });
      await expect
        .poll(() =>
          ownerPage.evaluate(() => ({
            width: innerWidth,
            fits:
              document.documentElement.scrollWidth <=
              document.documentElement.clientWidth,
          })),
        )
        .toEqual({ width: 320, fits: true });
      for (const shift of shifts)
        await expect(
          panel
            .getByRole("list", {
              name: copy.batchRefusalCalendar as string,
              exact: true,
            })
            .getByText(shift.name, { exact: true }),
        ).toHaveCount(2);
      const capturePath = testInfo.outputPath("calendar-refused-en-mobile.png");
      await panel.screenshot({ path: capturePath });
      await testInfo.attach("calendar-refused-en-mobile", {
        path: capturePath,
        contentType: "image/png",
      });
      const metrics = await ownerPage
        .locator(".cottage-calendar")
        .evaluate((calendar) => ({
          viewport: {
            width: innerWidth,
            height: innerHeight,
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
          },
          elements: Array.from(
            calendar.querySelectorAll(
              "button, input, select, h3, h4, .cottage-calendar-review-cells > li:first-child, .cottage-calendar-units > li:first-child",
            ),
          )
            .filter(
              (element) =>
                element instanceof HTMLElement &&
                element.getClientRects().length > 0,
            )
            .map((element) => {
              const node = element as HTMLElement;
              const style = getComputedStyle(node);
              const rect = node.getBoundingClientRect();
              const target = node.matches('input[type="checkbox"]')
                ? node.closest("label")!
                : node;
              const targetRect = target.getBoundingClientRect();
              const backgrounds: string[] = [];
              let ancestor: Element | null = node;
              while (ancestor) {
                backgrounds.push(getComputedStyle(ancestor).backgroundColor);
                ancestor = ancestor.parentElement;
              }
              return {
                tag: node.tagName,
                label:
                  node.getAttribute("aria-label") ??
                  (node instanceof HTMLInputElement ||
                  node instanceof HTMLSelectElement
                    ? Array.from(node.labels ?? [])
                        .map((label) => label.textContent)
                        .join(" ")
                    : node.textContent),
                focused: node === document.activeElement,
                rect: {
                  x: rect.x,
                  y: rect.y,
                  width: rect.width,
                  height: rect.height,
                },
                target: { width: targetRect.width, height: targetRect.height },
                color: style.color,
                backgroundColor: style.backgroundColor,
                ancestorBackgrounds: backgrounds,
                fontSize: style.fontSize,
                fontWeight: style.fontWeight,
                outlineStyle: style.outlineStyle,
                outlineWidth: style.outlineWidth,
                outlineColor: style.outlineColor,
                outlineOffset: style.outlineOffset,
                boxShadow: style.boxShadow,
                direction: style.direction,
              };
            }),
        }));
      await testInfo.attach("calendar-refused-en-320-metrics", {
        body: JSON.stringify(metrics),
        contentType: "application/json",
      });
      await ownerPage.setViewportSize(ownerViewport);
    }
    await panel
      .getByRole("button", {
        name: copy.batchReviewEligible as string,
        exact: true,
      })
      .click();
    const smaller = panel.locator(".cottage-calendar-review");
    await expect(smaller.locator(":scope > p").first()).toContainText(firstDay);
    await expect(smaller.locator(":scope > p").first()).toContainText(
      secondDay,
    );
    await expect(included.getByRole("listitem")).toHaveCount(
      2 * (shifts.length + 1) - 2,
    );
    await expect(
      included
        .getByRole("listitem")
        .filter({ hasText: firstDay })
        .filter({ hasText: firstShift.name }),
    ).toHaveCount(0);
    await expect(
      included
        .getByRole("listitem")
        .filter({ hasText: firstDay })
        .filter({ hasText: scheduleCopy.fullDay }),
    ).toHaveCount(0);
    const confirmation = panel.getByRole("checkbox", {
      name: copy.batchConfirm as string,
      exact: true,
    });
    await expect(confirmation).not.toBeChecked();
    await expect(
      panel.getByRole("button", {
        name: copy.batchApply as string,
        exact: true,
      }),
    ).toBeDisabled();
    await confirmation.check();
    await panel
      .getByRole("button", { name: copy.batchApply as string, exact: true })
      .click();
    await expect(
      panel.getByRole("status").filter({ hasText: copy.batchSaved as string }),
    ).toBeVisible();
    await expect(
      panel.getByText(`${copy.batchChanged}: ${2 * (shifts.length + 1) - 2}`, {
        exact: true,
      }),
    ).toBeVisible();
    const { data: subsetData, error: subsetError } = await fixtureOwner.rpc(
      "resolve_cottage_inventory_owner_calendar_span",
      {
        target_profile_id: fixture!.profileId,
        target_schedule_revision_id: fixture!.scheduleId,
        target_from: firstDay,
        target_to: secondDay,
      },
    );
    if (subsetError) throw subsetError;
    const subsetReadback = subsetData as CalendarReadback;
    for (const day of subsetReadback.days)
      for (const unit of day.units)
        expect(unit.ownerState).toBe(
          day.serviceDay === firstDay && unit.id === firstShift.id
            ? "private_blocked"
            : day.serviceDay === firstDay &&
                unit.id === schedule.full_day_bundle_id
              ? "closed"
              : "open",
        );
    await panel.getByLabel(copy.batchTo as string).fill(firstDay);
    await panel
      .getByRole("button", { name: copy.batchReview as string, exact: true })
      .click();
    await expect(included.getByRole("listitem")).toHaveCount(shifts.length + 1);
    const privateConsentLabel = (copy.batchReplace as string)
      .replace("{date}", firstDay)
      .replace("{unit}", shiftLabels[0]!);
    const privateConsent = panel.getByRole("checkbox", {
      name: privateConsentLabel,
      exact: true,
    });
    await expect(privateConsent).not.toBeChecked();
    await expect(
      panel.getByRole("button", {
        name: copy.batchApply as string,
        exact: true,
      }),
    ).toBeDisabled();
    await privateConsent.check();
    await panel
      .getByRole("button", { name: copy.batchApply as string, exact: true })
      .click();
    await expect(
      panel.getByRole("status").filter({ hasText: copy.batchSaved as string }),
    ).toBeVisible();
    await expect(
      month
        .getByRole("status")
        .filter({ hasText: copy.calendarLoaded as string }),
    ).toBeVisible();
    if (testInfo.project.name === "desktop") {
      await expect
        .poll(() =>
          month
            .locator(".cottage-calendar-days")
            .first()
            .evaluate(
              (list) =>
                getComputedStyle(list).gridTemplateColumns.split(" ").length,
            ),
        )
        .toBe(7);
      const capturePath = testInfo.outputPath("calendar-saved-en-desktop.png");
      await month.screenshot({ path: capturePath });
      await testInfo.attach("calendar-saved-en-desktop", {
        path: capturePath,
        contentType: "image/png",
      });
    }
    for (const locale of ["en", "ar", "ckb"] as const) {
      const localized = cottagePricingAvailabilityMessages[locale];
      if (locale !== "en")
        await ownerPage.goto(`/${locale}/owner/cottages/${fixture!.profileId}`);
      await expect(ownerPage.locator("html")).toHaveAttribute(
        "dir",
        locale === "en" ? "ltr" : "rtl",
      );
      const localizedPanel = ownerPage.getByRole("region", {
        name: localized.batchHeading as string,
        exact: true,
      });
      await expect(
        localizedPanel.getByLabel(localized.batchFrom as string),
      ).toBeVisible();
      await expect(
        localizedPanel.getByLabel(localized.batchTo as string),
      ).toBeVisible();
      await expect(
        month
          .getByRole("status")
          .filter({ hasText: localized.calendarLoaded as string }),
      ).toBeVisible();
      await expect
        .poll(() =>
          ownerPage.evaluate(
            () =>
              document.documentElement.scrollWidth <=
              document.documentElement.clientWidth,
          ),
        )
        .toBe(true);
      const reviewButton = localizedPanel.getByRole("button", {
        name: localized.batchReview as string,
        exact: true,
      });
      await reviewButton.focus();
      await ownerPage.keyboard.press("Tab");
      await ownerPage.keyboard.press("Shift+Tab");
      await expect(reviewButton).toBeFocused();
      await expect
        .poll(() =>
          reviewButton.evaluate((button) => {
            const box = button.getBoundingClientRect();
            const style = getComputedStyle(button);
            return {
              width: box.width >= 44,
              height: box.height >= 44,
              outline: style.outlineStyle !== "none",
            };
          }),
        )
        .toEqual({ width: true, height: true, outline: true });
      for (const forcedColors of locale === "en"
        ? (["none", "active"] as const)
        : (["none"] as const)) {
        await ownerPage.emulateMedia({ forcedColors });
        const metrics = await month.evaluate((calendar) => ({
          viewport: {
            width: innerWidth,
            height: innerHeight,
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
          },
          forcedColors: matchMedia("(forced-colors: active)").matches,
          elements: Array.from(
            calendar.querySelectorAll(
              "button, input, select, h3, .cottage-calendar-units > li:first-child",
            ),
          )
            .filter(
              (element) =>
                element instanceof HTMLElement &&
                element.getClientRects().length > 0,
            )
            .map((element) => {
              const node = element as HTMLElement;
              const style = getComputedStyle(node);
              const rect = node.getBoundingClientRect();
              const target = node.matches('input[type="checkbox"]')
                ? node.closest("label")!
                : node;
              const targetRect = target.getBoundingClientRect();
              const backgrounds: string[] = [];
              let ancestor: Element | null = node;
              while (ancestor) {
                backgrounds.push(getComputedStyle(ancestor).backgroundColor);
                ancestor = ancestor.parentElement;
              }
              return {
                tag: node.tagName,
                label:
                  node.getAttribute("aria-label") ??
                  (node instanceof HTMLInputElement ||
                  node instanceof HTMLSelectElement
                    ? Array.from(node.labels ?? [])
                        .map((label) => label.textContent)
                        .join(" ")
                    : node.textContent),
                focused: node === document.activeElement,
                rect: {
                  x: rect.x,
                  y: rect.y,
                  width: rect.width,
                  height: rect.height,
                },
                target: { width: targetRect.width, height: targetRect.height },
                color: style.color,
                backgroundColor: style.backgroundColor,
                ancestorBackgrounds: backgrounds,
                fontSize: style.fontSize,
                fontWeight: style.fontWeight,
                outlineStyle: style.outlineStyle,
                outlineWidth: style.outlineWidth,
                outlineColor: style.outlineColor,
                outlineOffset: style.outlineOffset,
                boxShadow: style.boxShadow,
                direction: style.direction,
              };
            }),
        }));
        await testInfo.attach(
          `calendar-${locale}-${testInfo.project.name}-${forcedColors}-metrics`,
          { body: JSON.stringify(metrics), contentType: "application/json" },
        );
        if (forcedColors === "active") {
          await expect(reviewButton).toBeFocused();
          await expect
            .poll(() =>
              reviewButton.evaluate(
                (button) => getComputedStyle(button).outlineStyle,
              ),
            )
            .not.toBe("none");
          await ownerPage.emulateMedia({ forcedColors: "none" });
        }
      }
    }
  } finally {
    await ownerContext.close();
  }

  const dayOnlyQuery = {
    from: firstDay,
    to: secondDay,
    guests: 4,
    selections: [],
    amenities: [],
  };
  const expectedInventory = [firstDay, secondDay].flatMap((day) => [
    ...shifts.map((shift) => ({
      serviceDay: day,
      kind: "shift",
      position: shift.position,
      name: shift.name,
      startTime: shift.start_time.slice(0, 5),
      endTime: shift.end_time.slice(0, 5),
      priceIqd: ({ 1: 180000, 2: 190000, 3: 200000 } as const)[
        shift.position as 1 | 2 | 3
      ],
      available: true,
    })),
    {
      serviceDay: day,
      kind: "full-day",
      name: "Full-day bundle",
      startTime: firstShift.start_time.slice(0, 5),
      endTime: lastShift!.end_time.slice(0, 5),
      priceIqd: day === firstDay ? 250000 : 260000,
      available: true,
    },
  ]);
  const { error: partialAvailabilityError } = await fixtureOwner.rpc(
    "set_cottage_inventory_availability",
    {
      target_profile_id: fixture!.profileId,
      target_schedule_revision_id: fixture!.scheduleId,
      target_service_day: firstDay,
      requested_states: [
        { unitId: secondShift.id, unitKind: "shift", state: "closed" },
        {
          unitId: schedule.full_day_bundle_id,
          unitKind: "full_day_bundle",
          state: "closed",
        },
      ],
    },
  );
  if (partialAvailabilityError) throw partialAvailabilityError;
  const { data: partialReadback, error: partialReadbackError } =
    await fixtureOwner.rpc("get_public_cottage_profile", {
      target_locale: "en",
      target_slug: fixture!.slug,
      requested_search: dayOnlyQuery,
    });
  if (partialReadbackError) throw partialReadbackError;
  expect(partialReadback).toEqual(
    expect.objectContaining({
      inventory: expectedInventory.map((unit) => ({
        ...unit,
        available: !(
          unit.serviceDay === firstDay &&
          (unit.kind === "full-day" ||
            ("position" in unit && unit.position === secondShift.position))
        ),
      })),
    }),
  );
  expect(partialReadback).not.toBeNull();
  expect(Object.keys(partialReadback).sort()).toEqual([
    "amenities",
    "approximateLocation",
    "bathrooms",
    "bedrooms",
    "capacity",
    "description",
    "descriptionHidden",
    "governorate",
    "houseRules",
    "inventory",
    "mediaIds",
    "name",
    "slug",
  ]);

  await page.goto("/en");
  await page.getByLabel("From Service Day").fill(firstDay);
  await page.getByLabel("To Service Day").fill(secondDay);
  await page.getByLabel("Guests", { exact: true }).fill("4");
  const optionalFilters = page
    .locator("summary")
    .filter({ hasText: "Booking Period filters (optional)" });
  await optionalFilters.focus();
  await expect(optionalFilters).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("group", { name: serviceDayLabel(firstDay) }),
  ).toBeVisible();
  await expect(page.getByRole("button", { pressed: true })).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("group", { name: serviceDayLabel(firstDay) }),
  ).toBeHidden();
  await page.getByRole("button", { name: "Search available cottages" }).click();
  await expect(page).toHaveURL(/\/en\/results\?/);
  const dayOnlyResultsUrl = new URL(page.url());
  expect(dayOnlyResultsUrl.searchParams.getAll("selection")).toEqual([]);
  expect(dayOnlyResultsUrl.searchParams.get("from")).toBe(firstDay);
  expect(dayOnlyResultsUrl.searchParams.get("to")).toBe(secondDay);
  expect(dayOnlyResultsUrl.searchParams.get("guests")).toBe("4");
  const resultCard = page.locator("article").filter({
    has: page.locator(`a[href^="/en/cottages/${fixture!.slug}?"]`),
  });
  await expect(resultCard).toHaveCount(1);
  await expect(
    resultCard.getByRole("heading", { name: fixture!.name }),
  ).toBeVisible();
  await expect(
    resultCard.getByText(`${fixture!.approximateLocation},`, { exact: false }),
  ).toBeVisible();
  await expect(resultCard.getByRole("listitem")).toHaveCount(
    (shifts.length + 1) * 2,
  );
  for (const [index, day] of [firstDay, secondDay].entries()) {
    const rows = resultCard.getByRole("listitem");
    for (const [shiftIndex, shift] of shifts.entries()) {
      const option = rows.nth(index * (shifts.length + 1) + shiftIndex);
      await expect(option).toContainText(shift.name);
      const departureDate = new Date(`${day}T00:00:00Z`);
      if (shift.end_time < shift.start_time) {
        departureDate.setUTCDate(departureDate.getUTCDate() + 1);
      }
      const departureDay = departureDate.toISOString().slice(0, 10);
      const arrivalAt = `${day}T${shift.start_time.slice(0, 5)}:00+03:00`;
      const departureAt = `${departureDay}T${shift.end_time.slice(0, 5)}:00+03:00`;
      const endpoints = option.locator("time");
      await expect(endpoints).toHaveCount(2);
      await expect(option.getByText(/^Arrival:/)).toBeVisible();
      await expect(option.getByText(/^Departure:/)).toBeVisible();
      await expect(endpoints.nth(0)).toHaveAttribute("datetime", arrivalAt);
      await expect(endpoints.nth(1)).toHaveAttribute("datetime", departureAt);
      await expect(endpoints.nth(0)).toHaveText(
        formatEnglishIraqDateTime(arrivalAt),
      );
      await expect(endpoints.nth(1)).toHaveText(
        formatEnglishIraqDateTime(departureAt),
      );
      await expect(endpoints.nth(0)).toContainText(
        shift.start_time.slice(0, 5),
      );
      await expect(endpoints.nth(1)).toContainText(shift.end_time.slice(0, 5));
      await expect(option).toContainText(
        "All times are Iraq local time (UTC+3).",
      );
      if (departureDay !== day) {
        await expect(option.getByText(/next day/)).toBeVisible();
      } else {
        await expect(option.getByText(/next day/)).toHaveCount(0);
      }
      await expect(option).toContainText(
        ({ 1: "IQD 180,000", 2: "IQD 190,000", 3: "IQD 200,000" } as const)[
          shift.position as 1 | 2 | 3
        ],
      );
      await expect(
        option.getByText(
          day === firstDay && shift.position === secondShift.position
            ? "Unavailable"
            : "Available",
          { exact: true },
        ),
      ).toBeVisible();
    }
    const bundle = rows.nth(index * (shifts.length + 1) + shifts.length);
    await expect(bundle).toContainText(
      day === firstDay ? "IQD 250,000" : "IQD 260,000",
    );
    await expect(
      bundle.getByText(day === firstDay ? "Unavailable" : "Available", {
        exact: true,
      }),
    ).toBeVisible();
  }
  await expect(resultCard.getByText(/total|IQD 550,000/i)).toHaveCount(0);
  await expectPrivateValuesAbsent();
  if (testInfo.project.name === "desktop") {
    await resultCard.screenshot({
      path: test.info().outputPath("day-first-results-en-desktop.png"),
    });
  }
  await resultCard.getByRole("link", { name: "View cottage" }).click();
  await expect(page).toHaveURL(/\/en\/cottages\/[^/?]+\?/);
  await expect(
    page.getByRole("heading", { name: fixture!.name }),
  ).toBeVisible();
  const dayOnlyProfileUrl = new URL(page.url());
  expect(dayOnlyProfileUrl.search).toBe(dayOnlyResultsUrl.search);
  const picker = page.getByRole("complementary");
  await expect(picker.getByRole("button", { pressed: true })).toHaveCount(0);
  await expect(
    picker.getByRole("button", { name: "Get exact quote" }),
  ).toBeDisabled();
  await expect(
    picker.getByRole("button", { name: "Message this cottage" }),
  ).toBeDisabled();
  await expect(
    picker.getByText(
      "Choose at least one available option for every Service Day.",
    ),
  ).toBeVisible();
  await expect(picker.getByText("Total price", { exact: true })).toHaveCount(0);
  await expectPrivateValuesAbsent();
  if (testInfo.project.name === "mobile") {
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      )
      .toBe(true);
    await picker.screenshot({
      path: test.info().outputPath("day-first-picker-empty-en-mobile.png"),
    });
  }

  await page.goto("/en");
  await page.getByLabel("From Service Day").fill(firstDay);
  await page.getByLabel("To Service Day").fill(secondDay);
  await page
    .getByLabel("Approximate area (optional)")
    .selectOption(fixture!.approximateLocation);
  await page
    .locator("summary")
    .filter({ hasText: "Booking Period filters (optional)" })
    .click();
  await page
    .getByRole("group", { name: serviceDayLabel(firstDay) })
    .getByRole("button", { name: `Shift ${firstShift.position}`, exact: true })
    .click();
  await page.getByRole("button", { name: "Search available cottages" }).click();
  await expect(page).toHaveURL(/\/en\/results\?/);
  const partialResultsUrl = new URL(page.url());
  expect(partialResultsUrl.searchParams.getAll("selection")).toEqual([
    `${firstDay}:shift:${firstShift.position}`,
  ]);
  expect(partialResultsUrl.searchParams.get("area")).toBe(
    fixture!.approximateLocation,
  );
  await expect(resultCard).toHaveCount(1);
  await expect(
    resultCard.getByText("Selected filter", { exact: true }),
  ).toHaveCount(1);
  const searchSummary = page.getByRole("region", { name: "Your search" });
  await expect(searchSummary).toContainText(fixture!.approximateLocation);
  await expect(searchSummary).toContainText(`Shift ${firstShift.position}`);
  await expect(resultCard).toContainText("Capacity");
  await expectPrivateValuesAbsent();
  await resultCard.getByRole("link", { name: "View cottage" }).click();
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === dayOnlyProfileUrl.pathname &&
      url.search === partialResultsUrl.search,
  );
  await expect(
    picker
      .getByRole("group", { name: serviceDayLabel(firstDay) })
      .getByRole("button", { name: firstShift.name, exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    picker
      .getByRole("group", { name: serviceDayLabel(secondDay) })
      .getByRole("button", { pressed: true }),
  ).toHaveCount(0);
  await expect(
    picker.getByRole("button", { name: "Get exact quote" }),
  ).toBeDisabled();
  await page.getByRole("link", { name: "Back to results" }).click();
  await expect(page).toHaveURL(partialResultsUrl.href);

  await page.goto("/en");
  await page.getByLabel("From Service Day").fill(firstDay);
  await page.getByLabel("To Service Day").fill(secondDay);
  await page
    .locator("summary")
    .filter({ hasText: "Booking Period filters (optional)" })
    .click();
  await page
    .getByRole("group", { name: serviceDayLabel(firstDay) })
    .getByRole("button", { name: `Shift ${secondShift.position}`, exact: true })
    .click();
  await page.getByRole("button", { name: "Search available cottages" }).click();
  await expect(
    page.getByRole("heading", { name: "Available cottages" }),
  ).toBeVisible();
  expect(new URL(page.url()).searchParams.getAll("selection")).toEqual([
    `${firstDay}:shift:${secondShift.position}`,
  ]);
  await expect(resultCard).toHaveCount(0);
  await expect(searchSummary).toBeVisible();
  const emptyResultsUrl = new URL(page.url());
  const arabicResults = page
    .getByRole("banner")
    .getByRole("link", { name: "العربية" });
  await openHeaderPanel(page, "language");
  await expect(arabicResults).toHaveAttribute("href", /^\/ar\/results\?/);
  await arabicResults.click();
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === "/ar/results" && url.search === emptyResultsUrl.search,
  );
  await expect(page.getByRole("region", { name: "بحثك" })).toBeVisible();
  await expectPrivateValuesAbsent();

  const { error: restoreAvailabilityError } = await fixtureOwner.rpc(
    "set_cottage_inventory_availability",
    {
      target_profile_id: fixture!.profileId,
      target_schedule_revision_id: fixture!.scheduleId,
      target_service_day: firstDay,
      requested_states: [
        { unitId: secondShift.id, unitKind: "shift", state: "open" },
        {
          unitId: schedule.full_day_bundle_id,
          unitKind: "full_day_bundle",
          state: "open",
        },
      ],
    },
  );
  if (restoreAvailabilityError) throw restoreAvailabilityError;
  const { data: restoredReadback, error: restoredReadbackError } =
    await fixtureOwner.rpc("get_public_cottage_profile", {
      target_locale: "en",
      target_slug: fixture!.slug,
      requested_search: dayOnlyQuery,
    });
  if (restoredReadbackError) throw restoredReadbackError;
  expect(restoredReadback).toEqual(
    expect.objectContaining({ inventory: expectedInventory }),
  );
  await page.goto(dayOnlyProfileUrl.href);
  const firstDayPicker = picker.getByRole("group", {
    name: serviceDayLabel(firstDay),
  });
  const firstOption = firstDayPicker.getByRole("button", {
    name: firstShift.name,
    exact: true,
  });
  await expect(firstOption).toHaveAttribute("aria-pressed", "false");
  await firstOption.focus();
  await expect(firstOption).toBeFocused();
  await page.keyboard.press("Space");
  await expect(firstOption).toHaveAttribute("aria-pressed", "true");
  await expect(
    picker.getByRole("button", { name: "Get exact quote" }),
  ).toBeDisabled();
  await firstDayPicker
    .getByRole("button", { name: secondShift.name, exact: true })
    .click();
  await expect(
    firstDayPicker.getByRole("button", { name: secondShift.name, exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const secondDayOption = picker
    .getByRole("group", { name: serviceDayLabel(secondDay) })
    .getByRole("button", { name: firstShift.name, exact: true });
  await secondDayOption.click();
  await expect(secondDayOption).toHaveAttribute("aria-pressed", "true");
  await expect(
    picker.getByRole("link", { name: "Get exact quote" }),
  ).toBeVisible();
  await expect(
    picker.getByRole("link", { name: "Message this cottage" }),
  ).toBeVisible();
  const english = new URL(page.url());
  expect(english.searchParams.getAll("selection")).toEqual([
    `${firstDay}:shift:${firstShift.position}`,
    `${firstDay}:shift:${secondShift.position}`,
    `${secondDay}:shift:${firstShift.position}`,
  ]);
  expect(english.searchParams.get("from")).toBe(firstDay);
  expect(english.searchParams.get("to")).toBe(secondDay);
  expect(english.searchParams.get("guests")).toBe("4");
  await expectPrivateValuesAbsent();
  await page.getByRole("link", { name: "Get exact quote" }).click();
  await expect(page).toHaveURL(/\/en\/request\/[^/?]+\?/);
  await expect(
    page.getByRole("heading", { name: "Your exact Booking Quote" }),
  ).toBeVisible();
  await expect(page.getByText("IQD 550,000", { exact: true })).toBeVisible();
  await expect(page.getByText("IQD 5,000", { exact: true })).toBeVisible();
  await expect(page.getByText("IQD 555,000", { exact: true })).toBeVisible();
  await expect(page.getByText(/Marketplace Commission/i)).toHaveCount(0);
  await expect(page.getByText(/does not reserve/)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Verify your phone to continue" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send Booking Request" }),
  ).toHaveCount(0);
  const customerPhone = quoteCustomerPhone(testInfo.project.name);
  const englishRequest = new URL(page.url());
  const requestSlug = englishRequest.pathname.split("/").at(-1);
  const signIn = page
    .getByRole("banner")
    .getByRole("link", { name: "Sign in", exact: true });
  await openHeaderPanel(page, "menu");
  await expect(signIn).toHaveAttribute(
    "href",
    /^\/en\/access\?returnTo=%2Fen%2Frequest%2F/,
  );
  await signIn.click();
  await expect(page).toHaveURL(/\/en\/access\?returnTo=%2Fen%2Frequest%2F/);
  // The layout header can briefly keep the previous route's links; wait for
  // the access page's own Sorani link before switching language.
  const soraniAccess = page
    .getByRole("banner")
    .getByRole("link", { name: "کوردی" });
  await openHeaderPanel(page, "language");
  await expect(soraniAccess).toHaveAttribute(
    "href",
    /^\/ckb\/access\?returnTo=%2Fckb%2Frequest%2F/,
  );
  await soraniAccess.click();
  await expect(page).toHaveURL(/\/ckb\/access\?returnTo=%2Fckb%2Frequest%2F/);
  await page.getByLabel("ژمارە تەلەفۆنی عێراقی").fill(customerPhone);
  await page.getByRole("button", { name: "کۆدی پشتڕاستکردنەوە بنێرە" }).click();
  await page.getByLabel("کۆدی پشتڕاستکردنەوە").fill("123456");
  await page.getByRole("button", { name: "پشتڕاست بکەرەوە" }).click();
  const soraniStep = accessMessages.ckb;
  await expect(
    page.getByRole("heading", { name: soraniStep.accountNameStepTitle }),
  ).toBeVisible();
  await page.getByLabel(soraniStep.firstName, { exact: true }).fill("ڕێبین");
  await page.getByRole("button", { name: soraniStep.saveAndContinue }).click();
  await expect(
    page.getByRole("heading", { name: "داواکاری حجز بنێرە" }),
  ).toBeVisible();
  // The sign-in page's redirect waits while the name step hides it.
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === `/ckb/request/${requestSlug}` &&
      url.search === englishRequest.search,
  );
  await expect(
    page.locator("#site-header-account-button .account-avatar"),
  ).toHaveText("ڕ");
  const englishLink = page
    .getByRole("banner")
    .getByRole("link", { name: "English" });
  await openHeaderPanel(page, "language");
  await expect(englishLink).toHaveAttribute("href", /^\/en\/request\//);
  await englishLink.click();
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === englishRequest.pathname &&
      url.search === englishRequest.search,
  );
  await expect(
    page.getByRole("heading", { name: "Send your Booking Request" }),
  ).toBeVisible();
  await expect(page.getByLabel("Customer name")).toBeVisible();
  await expect(page.getByLabel("Party size")).toHaveValue("4");
  await expect(
    page.getByLabel(/accept the preserved House Rules/i),
  ).toHaveAttribute("required");
  await expect(
    page.getByLabel(/inside-48-hours no-refund rule/i),
  ).toHaveAttribute("required");
  await expect(
    page.getByRole("button", { name: "Send Booking Request" }),
  ).toBeVisible();
  await expectPrivateValuesAbsent();
  const quoteUrl = page.url();
  // Verification completes through the access page; wait for the header to
  // settle on the request page before switching language.
  const soraniLink = page
    .getByRole("banner")
    .getByRole("link", { name: "کوردی" });
  await openHeaderPanel(page, "language");
  await expect(soraniLink).toHaveAttribute("href", /^\/ckb\/request\//);
  await soraniLink.click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ckb");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(
    page.getByRole("heading", { name: "پێشنیاری نرخی وردی حجزکردن" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("listitem", {
        name: `ماوەی بەیانی ${firstShift.name}`,
        exact: true,
      })
      .first(),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "داواکاری حجز بنێرە" }),
  ).toBeVisible();
  await expect(page.locator(".quote-items")).toContainText(firstShift.name);
  await expectPrivateValuesAbsent();
  await openHeaderPanel(page, "language");
  await page.getByRole("banner").getByRole("link", { name: "العربية" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(
    page.getByRole("heading", { name: "عرض سعر الحجز الدقيق" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("listitem", {
        name: `الفترة الصباحية ${firstShift.name}`,
        exact: true,
      })
      .first(),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "أرسل طلب الحجز" }),
  ).toBeVisible();
  await expect(page.locator(".quote-items")).toContainText(firstShift.name);
  await expectPrivateValuesAbsent();

  await page.goto("/en");
  await page.getByLabel("From Service Day").fill(firstDay);
  await page.getByLabel("To Service Day").fill(secondDay);
  await page
    .locator("summary")
    .filter({ hasText: "Booking Period filters (optional)" })
    .click();
  for (const day of [firstDay, secondDay]) {
    await page
      .getByRole("group", { name: serviceDayLabel(day) })
      .getByRole("button", { name: "Full day", exact: true })
      .click();
  }
  await page.getByRole("button", { name: "Search available cottages" }).click();
  const fullDayResult = page.locator("article").filter({
    has: page.locator(`a[href^="/en/cottages/${fixture!.slug}?"]`),
  });
  await expect(
    fullDayResult.getByRole("heading", { name: fixture!.name }),
  ).toBeVisible();
  await expect(
    fullDayResult.getByText("IQD 250,000", { exact: true }),
  ).toBeVisible();
  await expect(
    fullDayResult.getByText("IQD 260,000", { exact: true }),
  ).toBeVisible();
  await expect(
    fullDayResult.getByText("IQD 510,000", { exact: true }),
  ).toHaveCount(0);
  await expect(
    fullDayResult.getByText("Full-day bundle", { exact: false }),
  ).toHaveCount(2);
  await fullDayResult.getByRole("link", { name: "View cottage" }).click();
  await expect(
    picker.getByRole("button", {
      name: "Full-day Full-day bundle",
      pressed: true,
      exact: true,
    }),
  ).toHaveCount(2);
  await expect(picker.getByText("Total price", { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Get exact quote" }).click();
  const fullDayItems = page.getByRole("listitem", {
    name: "Full-day Full-day bundle",
  });
  await expect(fullDayItems).toHaveCount(2);
  await expect(fullDayItems.nth(0)).toContainText("IQD 250,000");
  await expect(fullDayItems.nth(1)).toContainText("IQD 260,000");
  await expect(page.getByText("IQD 510,000", { exact: true })).toBeVisible();
  await expect(page.getByText("IQD 5,000", { exact: true })).toBeVisible();
  await expect(page.getByText("IQD 515,000", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your selected access" }),
  ).toBeVisible();
  await expect(page.locator(".quote-access li")).toHaveCount(1);
  await expect(page.locator(".quote-access li")).toHaveText(
    expectedFullDayAccessRange,
  );
  await expectPrivateValuesAbsent();

  await page.goto(english.toString());
  await openHeaderPanel(page, "language");
  await page.getByRole("banner").getByRole("link", { name: "کوردی" }).click();
  await expect(page).toHaveURL(
    new RegExp(`${english.pathname.replace(/^\/en/, "/ckb")}\\?`),
  );
  const sorani = new URL(page.url());
  expect(sorani.pathname).toBe(english.pathname.replace(/^\/en/, "/ckb"));
  expect(sorani.search).toBe(english.search);
  await expect(page.locator("html")).toHaveAttribute("lang", "ckb");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByText(fixture!.soraniDescription)).toBeVisible();
  const soraniLineMetrics = await page
    .locator(
      ".profile-heading h1, .profile-section h2, .profile-section p, .booking-summary h2, .booking-summary li, .booking-summary legend",
    )
    .evaluateAll((elements) =>
      elements.map((element) => {
        const style = getComputedStyle(element);
        return {
          fontSize: Number.parseFloat(style.fontSize),
          lineHeight: Number.parseFloat(style.lineHeight),
        };
      }),
    );
  expect(soraniLineMetrics.length).toBeGreaterThan(0);
  for (const metric of soraniLineMetrics) {
    expect(metric.lineHeight).toBeGreaterThanOrEqual(metric.fontSize * 1.35);
  }
  await expectPrivateValuesAbsent();
  if (testInfo.project.name === "mobile") {
    await expect(picker.getByRole("button", { pressed: true })).toHaveCount(3);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      )
      .toBe(true);
    await picker.screenshot({
      path: test.info().outputPath("day-first-picker-selected-ckb-mobile.png"),
    });
  }
  await openHeaderPanel(page, "language");
  await page.getByRole("banner").getByRole("link", { name: "العربية" }).click();
  await expect(page).toHaveURL(
    new RegExp(`${english.pathname.replace(/^\/en/, "/ar")}\\?`),
  );
  const arabic = new URL(page.url());
  expect(arabic.pathname).toBe(english.pathname.replace(/^\/en/, "/ar"));
  expect(arabic.search).toBe(english.search);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByText(fixture!.arabicDescription)).toBeVisible();
  await expectPrivateValuesAbsent();

  for (const requestedDay of [firstDay, secondDay]) {
    const { error: closeError } = await fixtureOwner.rpc(
      "set_cottage_inventory_availability",
      {
        target_profile_id: fixture!.profileId,
        target_schedule_revision_id: fixture!.scheduleId,
        target_service_day: requestedDay,
        requested_states: [
          ...shifts.map((shift) => ({
            unitId: shift.id,
            unitKind: "shift",
            state: "closed",
          })),
          {
            unitId: schedule.full_day_bundle_id,
            unitKind: "full_day_bundle",
            state: "closed",
          },
        ],
      },
    );
    if (closeError) throw closeError;
  }

  const { data: closedReadback, error: closedReadbackError } =
    await fixtureOwner.rpc("get_public_cottage_profile", {
      target_locale: "en",
      target_slug: fixture!.slug,
      requested_search: dayOnlyQuery,
    });
  if (closedReadbackError) throw closedReadbackError;
  expect(closedReadback).toEqual(
    expect.objectContaining({
      inventory: expectedInventory.map((unit) => ({
        ...unit,
        available: false,
      })),
    }),
  );
  await page.goto(dayOnlyResultsUrl.href);
  await expect(
    page.getByRole("heading", { name: "Available cottages" }),
  ).toBeVisible();
  await expect(resultCard).toHaveCount(0);
  await expectPrivateValuesAbsent();
  await page.goto(english.href);
  await expect(picker.getByRole("alert")).toContainText(
    "A selected option is no longer available.",
  );
  await expect(
    picker.getByRole("button", { name: "Get exact quote" }),
  ).toBeDisabled();
  await expect(firstOption).toHaveAttribute("aria-pressed", "true");
  await expect(firstOption).toBeEnabled();
  if (testInfo.project.name === "desktop") {
    await picker.screenshot({
      path: test.info().outputPath("day-first-picker-stale-en-desktop.png"),
    });
  }
  await firstOption.click();
  await expect(firstOption).toHaveAttribute("aria-pressed", "false");
  await expect(picker.getByRole("button", { pressed: true })).toHaveCount(2);
  expect(new URL(page.url()).searchParams.getAll("selection")).toEqual([
    `${firstDay}:shift:${secondShift.position}`,
    `${secondDay}:shift:${firstShift.position}`,
  ]);
  await expect(
    picker.getByRole("button", { name: "Get exact quote" }),
  ).toBeDisabled();
  await expectPrivateValuesAbsent();

  await page.goto(english.pathname);
  await expect(
    page.getByRole("heading", { name: fixture!.name }),
  ).toBeVisible();
  await expect(
    page.getByText("Unavailable", { exact: false }).first(),
  ).toBeVisible();
  await expectPrivateValuesAbsent();
  await page.goto(quoteUrl);
  await expect(
    page.getByRole("alert").filter({ hasText: "no longer available" }),
  ).toBeVisible();
  await expect(page.getByText(/IQD/)).toHaveCount(0);
  await expectPrivateValuesAbsent();
  // Wait for font requests before checking their origins.
  await page.evaluate(() => document.fonts.ready);
  expect(
    [...requestedOrigins].filter(
      (origin) =>
        origin !== new URL(baseURL ?? "invalid:").origin &&
        origin !== new URL(process.env.SUPABASE_URL ?? "invalid:").origin,
    ),
  ).toEqual([]);
});

registerOwnedJourney("shared-account", async ({ page, browser }, testInfo) => {
  const { phone } = await prepareOwnedAccessJourney("shared-account", testInfo);
  assertIsolatedLocalAccessDatabase();
  const before = await listAllAccessFixtureUsers(auditClient.auth.admin);
  expect(findAccessFixtureUser(before, phone)).toBeUndefined();
  async function verify(
    target: Page,
    moveDuringSend = false,
    firstName?: string,
  ) {
    await target.getByLabel("Iraqi phone number").fill(phone);
    const phoneSendControl = target.getByRole("button", {
      name: "Send verification code",
    });
    await phoneSendControl.focus();
    await expect(phoneSendControl).toBeFocused();
    const phoneSendSource = await phoneSendControl.elementHandle();
    if (!phoneSendSource) throw new Error("Focus source is missing");
    const sendRoute = target.url();
    let releaseSendResponse: () => void = () => {};
    const sendRelease = new Promise<void>((resolve) => {
      releaseSendResponse = resolve;
    });
    let recordSendResponse: () => void = () => {};
    const sendFetched = new Promise<void>((resolve) => {
      recordSendResponse = resolve;
    });
    if (moveDuringSend) {
      await target.route(sendRoute, async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        const response = await route.fetch();
        recordSendResponse();
        await sendRelease;
        await route.fulfill({ response });
      });
    }
    try {
      await phoneSendControl.press("Enter");
      if (moveDuringSend) {
        await sendFetched;
        await expect(phoneSendControl).toBeDisabled();
        await expect(phoneSendControl).toHaveAttribute("aria-busy", "true");
        expect(
          await phoneSendSource.evaluate((source) => source.isConnected),
        ).toBe(true);
        const elsewhere = target.getByLabel("Iraqi phone number");
        await expect(elsewhere).toBeEnabled();
        await elsewhere.focus();
        await expect(elsewhere).toBeFocused();
        releaseSendResponse();
      }
      await expect(target.getByLabel("Verification code")).toBeVisible();
      if (moveDuringSend)
        await expect(target.getByLabel("Verification code")).not.toBeFocused();
    } finally {
      releaseSendResponse();
      if (moveDuringSend) await target.unroute(sendRoute);
    }
    await phoneSendSource.dispose();

    await target.getByLabel("Verification code").fill("123456");
    const phoneVerifyControl = target.getByRole("button", {
      name: "Verify",
      exact: true,
    });
    await phoneVerifyControl.focus();
    await expect(phoneVerifyControl).toBeFocused();
    await phoneVerifyControl.press("Enter");
    const bookingsHeading = target.getByRole("heading", {
      name: "My bookings",
      exact: true,
    });
    if (firstName) {
      const stepTitle = target.getByRole("heading", {
        name: "Add your first name",
      });
      await expect(stepTitle).toBeVisible();
      await expect(stepTitle).toBeFocused();
      await expect(bookingsHeading).toBeHidden();
      await target.getByLabel("First name", { exact: true }).fill(firstName);
      const saveControl = target.getByRole("button", {
        name: "Save and continue",
      });
      await saveControl.focus();
      await expect(saveControl).toBeFocused();
      await saveControl.press("Enter");
      await expect(bookingsHeading).toBeVisible();
      // The sign-in page's redirect waits while the name step hides it.
      await expect(target).toHaveURL(/\/en\/bookings$/);
      await expect(target.locator("#site-header-account-button")).toBeFocused();
      await expect(
        target.locator("#site-header-account-button .account-avatar"),
      ).toHaveText(firstName[0]);
      return;
    }
    await expect(bookingsHeading).toBeVisible();
    await expect(bookingsHeading).toBeFocused();
  }
  await page.goto("/en/bookings");
  await expect(page).toHaveURL(/\/en\/access\?returnTo=%2Fen%2Fbookings/);
  await verify(page, true, "Zana");
  await expect(
    page.getByRole("heading", { name: "My bookings", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("No booking requests yet.")).toBeVisible();
  const users = await listAllAccessFixtureUsers(auditClient.auth.admin);
  const identity = users.filter((user) => findAccessFixtureUser([user], phone));
  expect(identity).toHaveLength(1);
  const userId = identity[0].id;
  const database = createLocalSupabaseConcurrencyHarness();
  database.guardDisposableLocalDatabase();
  expect(uuidPattern.test(userId)).toBe(true);
  function accountContext() {
    return JSON.parse(
      database.runSql(`
      select json_build_object('user_id', user_id, 'role', role,
        'owner_approval_state', owner_approval_state)
      from public.account_contexts where user_id = '${userId}'::uuid;
    `),
    ) as { user_id: string; role: string; owner_approval_state: string | null };
  }
  expect(accountContext()).toEqual({
    user_id: userId,
    role: "customer",
    owner_approval_state: null,
  });
  const avatarLetter = page.locator(
    "#site-header-account-button .account-avatar",
  );
  await expect(avatarLetter).toHaveText("Z");
  await page.evaluate(() => Reflect.set(window, "personalInformation", "kept"));
  await openHeaderPanel(page, "menu");
  await page
    .getByRole("banner")
    .getByRole("menuitem", { name: "Personal information" })
    .click();
  await expect(page).toHaveURL(/\/en\/account$/);
  await expect(
    page.getByRole("heading", { name: "Personal information", exact: true }),
  ).toBeVisible();
  await page.getByLabel("First name").fill("Rebin");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Your first name is saved." }),
  ).toBeVisible();
  await expect(avatarLetter).toHaveText("R");
  expect(
    await page.evaluate(() => Reflect.get(window, "personalInformation")),
  ).toBe("kept");
  const ownDetails = await page.request.get("/en/account");
  expect(ownDetails.headers()["cache-control"]).toContain("no-store");
  expect(await ownDetails.text()).toContain("Rebin");
  const signedOut = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  });
  try {
    const refused = await signedOut.request.get("/en/account");
    expect(new URL(refused.url()).pathname).toBe("/en/access");
    expect(new URL(refused.url()).searchParams.get("returnTo")).toBe(
      "/en/account",
    );
    expect(await refused.text()).not.toContain("Rebin");
  } finally {
    await signedOut.close();
  }
  await openHeaderPanel(page, "menu");
  await page
    .getByRole("banner")
    .getByRole("menuitem", { name: "List your cottage" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Become a Cottage Owner" }),
  ).toBeVisible();
  expect(accountContext().role).toBe("customer");
  const enrollControl = page.getByRole("button", {
    name: "Start owner application",
  });
  await enrollControl.focus();
  await expect(enrollControl).toBeFocused();
  await enrollControl.press("Enter");
  await expect(page).toHaveURL(/\/en\/owner\/application$/);
  await expect(page.locator("#owner-application-title")).toBeFocused();

  expect(accountContext()).toEqual({
    user_id: userId,
    role: "cottage_owner",
    owner_approval_state: "prospective",
  });
  function prepareLaterSignIn() {
    // Model a later visit without waiting for or weakening the provider's OTP rate limit.
    expect(
      database.runSql(`
      update auth.users set confirmation_sent_at = now() - interval '1 hour'
      where id = '${userId}'::uuid and phone = '${phone.slice(1)}' returning id;
    `),
    ).toBe(userId);
  }
  prepareLaterSignIn();
  const second = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  });
  const secondPage = await second.newPage();
  try {
    await secondPage.goto("/en/bookings");
    await verify(secondPage);
    await expect(
      secondPage.getByRole("heading", { name: "My bookings", exact: true }),
    ).toBeVisible();
    await openHeaderPanel(page, "menu");
    await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/en$/);
    await openHeaderPanel(page, "menu");
    await expect(
      page
        .getByRole("banner")
        .getByRole("link", { name: "Sign in", exact: true }),
    ).toBeVisible();
    await page.goto("/en/bookings");
    await expect(page.getByLabel("Iraqi phone number")).toBeVisible();
    await secondPage.reload();
    await expect(
      secondPage.getByRole("heading", { name: "My bookings", exact: true }),
    ).toBeVisible();
    prepareLaterSignIn();
    await verify(page);
    await expect(
      page.getByRole("heading", { name: "My bookings", exact: true }),
    ).toBeVisible();
    const returning = await listAllAccessFixtureUsers(auditClient.auth.admin);
    expect(
      returning
        .filter((user) => findAccessFixtureUser([user], phone))
        .map((user) => user.id),
    ).toEqual([userId]);
    await page.goto("/en/booking-requests/RC-REQ-2142142142142142");
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "This booking is not available to this account.",
    );
    await expect(
      page
        .getByRole("button", { name: "Sign out", exact: true })
        .filter({ visible: true }),
    ).toBeVisible();
    for (const control of [
      page
        .getByRole("main")
        .getByRole("button", { name: "Sign out", exact: true }),
      page
        .getByRole("main")
        .getByRole("link", { name: "Try again", exact: true }),
    ]) {
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await page.context().clearCookies();
    await page.reload();
    await expect(page).toHaveURL(
      /\/en\/access\?returnTo=%2Fen%2Fbooking-requests%2FRC-REQ-2142142142142142/,
    );
  } catch (error) {
    try {
      await second.close();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Account journey failed; second-context cleanup also failed",
      );
    }
    throw error;
  }
  await second.close();
});

if (ownedJourneyCallbacks.size !== accessJourneyCases.length) {
  throw new Error("Missing owned access journey callback.");
}
if (process.env.ACCESS_JOURNEY_PHASE === "reverse") {
  for (const fixtureCase of [...accessJourneyCases].reverse()) {
    const callback = ownedJourneyCallbacks.get(fixtureCase.journey);
    if (!callback)
      throw new Error(`Missing owned journey: ${fixtureCase.journey}`);
    test(fixtureCase.title, callback);
  }
}
