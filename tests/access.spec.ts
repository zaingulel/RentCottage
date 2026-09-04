import { expect, test, type Locator, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import * as OTPAuth from "otpauth";
import { createClient } from "@supabase/supabase-js";

type BrowserLocale = "en" | "ar" | "ckb";

type AccessBrowserFixture = {
  exactAddress: string;
  reviewLegalName: string;
  reviewOwnerPhone: string;
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
      verifiedOwner: string;
      ownerApplicationCta: string;
      cottageProfilesCta: string;
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
      verifiedOwner:
        "Verified. Your Cottage Owner access is awaiting approval.",
      ownerApplicationCta: "Continue to Owner Application",
      cottageProfilesCta: "Open Cottage Profiles",
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
      verifiedOwner: "تم التحقق. حساب المالك ما زال بانتظار الموافقة.",
      ownerApplicationCta: "تابع إلى طلب المالك",
      cottageProfilesCta: "افتح ملفات الأكواخ",
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
      verifiedOwner: "پشتڕاست کرایەوە. هەژماری خاوەن چاوەڕێی پەسەندە.",
      ownerApplicationCta: "بەردەوام بە بۆ داواکاری خاوەن",
      cottageProfilesCta: "پرۆفایلەکانی کۆتێج بکەرەوە",
    },
    application: {
      privacyNote:
        "بەڵگەکانی پشتڕاستکردنەوە بڵاوناکرێنەوە و وەرناگێڕدرێن. بەستەری پارێزراو لە ماوەی 60 چرکەدا بەسەر دەچێت و هەر دەستگەیشتنێک تۆمار دەکرێت.",
      documentsSection: "بەڵگە تایبەتەکانی پشتڕاستکردنەوە",
      documentRules: "PDF یان JPEG یان PNG · تا 5 مێگابایت",
      documentTitles: [
        "بەڵگەی ناسنامە",
        "بەڵگەی مافی بەکرێدان",
        "بەڵگەی مۆڵەت یان بەخشین",
        "بەڵگەی هەژماری پارەدان",
      ],
      legalName: "ناوی یاسایی",
      cottageName: "ناوی ماڵ",
      governorate: "پارێزگا",
      approximateLocation: "ناوچەی گشتیی نزیکەوە",
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
  const { data, error } = await auditClient.auth.admin.listUsers();
  if (error) throw error;
  const userId = data.users.find((user) => user.email === email)?.id;
  if (!userId) throw new Error(`No test administrator exists for ${email}`);
  return userId;
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

function journeyPhone(projectName: string, digits: [string, string, string]) {
  const suffixes: Record<string, string> = {
    mobile: digits[0],
    desktop: digits[1],
    worker: digits[2],
  };
  const suffix = suffixes[projectName];
  if (!suffix) throw new Error(`Unmapped Playwright project: ${projectName}`);
  return `+964750000000${suffix}`;
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
  await expect(page.getByText(copy.verifiedOwner)).toBeVisible();
  await expect(
    page.getByRole("link", { name: copy.cottageProfilesCta }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: copy.ownerApplicationCta }).click();
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
  await page.getByRole("button", { name: copy.saveDraft }).click();
  await expect(page.getByRole("status")).toContainText(copy.saved);
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
  for (const sectionName of sectionNames) {
    await expect(
      page.getByRole("group", { name: sectionName, exact: true }),
    ).toBeVisible();
  }

  const positions = await page
    .locator(".cottage-profile-form > fieldset")
    .evaluateAll((fieldsets) => {
      const direction = document.documentElement.dir;
      const inlineStart = (rect: DOMRect) =>
        direction === "rtl" ? rect.right : rect.left;
      const textRect = (element: Element) => {
        const text = [...element.childNodes].find(
          (node) =>
            node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
        );
        if (!text) throw new Error("Expected visible section-title text");
        const range = document.createRange();
        range.selectNodeContents(text);
        return range.getBoundingClientRect();
      };

      return fieldsets.map((fieldset) => {
        const titleId = fieldset.getAttribute("aria-labelledby");
        const title = titleId ? document.getElementById(titleId) : null;
        const firstLabel = fieldset.querySelector(":scope > label");
        if (!title || !firstLabel) {
          throw new Error(
            "Expected each Cottage Profile section to have a title and label",
          );
        }
        const titleRect = textRect(title);
        return {
          inlineOffset: Math.abs(
            inlineStart(titleRect) - inlineStart(textRect(firstLabel)),
          ),
          blockOffset: titleRect.top - fieldset.getBoundingClientRect().top,
        };
      });
    });

  expect(positions).toHaveLength(sectionNames.length);
  for (const position of positions) {
    expect(position.inlineOffset).toBeLessThanOrEqual(0.5);
    expect(position.blockOffset).toBeGreaterThanOrEqual(1);
  }
}

async function expectCottageProfileActionHierarchy(
  page: Page,
  actionNames: readonly [string, string, string],
  projectName: string,
) {
  const metrics = await Promise.all(
    actionNames.map((name) =>
      page.getByRole("button", { name, exact: true }).evaluate((button) => {
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
  expect(save.backgroundColor).toBe("rgba(0, 0, 0, 0)");
  expect(save.backgroundColor).toBe(upload.backgroundColor);
  expect(save.color).toBe(upload.color);
  for (const secondary of [save, upload]) {
    expect(secondary.borderStyle).toBe("solid");
    expect(secondary.borderWidth).toBeGreaterThanOrEqual(1);
    expect(secondary.borderColor).toBe(secondary.color);
  }
  expect(submit.backgroundColor).toBe(save.color);
  expect(submit.color).not.toBe(submit.backgroundColor);
}

function documentActionFor(card: Locator, copy: BrowserApplicationFixture) {
  return card
    .getByRole("button", { name: copy.upload, exact: true })
    .or(card.getByRole("button", { name: copy.replace, exact: true }));
}

test.describe.configure({ mode: "serial" });

test("the fictional booking-request back door is unavailable", async ({
  page,
}) => {
  const response = await page.goto("/en/request/garden-house");
  expect(response?.status()).toBe(404);
});

test("Owner sign-in from the homepage gives a prospective Cottage Owner no approved-owner claim", async ({
  page,
}) => {
  await page.goto("/ckb");
  await page
    .getByRole("link", { name: "چوونەژوورەوەی خاوەنی ماڵ", exact: true })
    .click();
  await expect(page).toHaveURL(/\/ckb\/owner\/access$/);
  await page.getByLabel("ژمارە تەلەفۆنی عێراقی").fill("+9647500000001");
  await page.getByRole("button", { name: "کۆدی پشتڕاستکردنەوە بنێرە" }).click();
  await page.getByLabel("کۆدی پشتڕاستکردنەوە").fill("123456");
  await page.getByRole("button", { name: "پشتڕاست بکەرەوە" }).click();

  await expect(page.getByText(/چاوەڕێی پەسەندە/)).toBeVisible();
});

test("Arabic access renders right to left", async ({ page }) => {
  await page.goto("/ar/owner/access");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByLabel("رقم الهاتف العراقي")).toBeVisible();
});

test("a Cottage Owner saves, resumes and submits a complete private application", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  await openOwnerApplication(
    page,
    "en",
    journeyPhone(testInfo.project.name, ["3", "4", "5"]),
  );
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
          ? Buffer.concat([
              Buffer.from("%PDF-1.7\n"),
              Buffer.alloc(1_099_980),
              Buffer.from("\n%%EOF"),
            ])
          : Buffer.from("%PDF-1.7\nprivate-test-document\n%%EOF"),
    });
    await card.getByRole("button", { name: "Upload document" }).click();
    await expect(
      page.getByRole("article", { name: label }).getByText(filename),
    ).toBeVisible();
  }

  await page.getByRole("button", { name: "Submit application" }).click();
  await expect(
    page.locator(".owner-review-status").getByText("Submitted for review"),
  ).toBeVisible();
  await expect(page.getByLabel("Legal name")).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Submit application" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: /publish/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /booking/i })).toHaveCount(0);

  await expect(page.getByRole("link", { name: /secure link/i })).toHaveCount(0);
});

test("Owner Application keeps evidence controls aligned and accessible in every locale", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  await openOwnerApplication(
    page,
    "en",
    journeyPhone(testInfo.project.name, ["6", "7", "8"]),
  );

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

    await page
      .getByRole("heading", { name: copy.documentsSection })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(
        `${locale}-owner-application-evidence-submit.png`,
      ),
      fullPage: true,
    });

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
}, testInfo) => {
  test.setTimeout(180_000);
  const phoneByProject: Record<string, string> = {
    mobile: "+9647510000000",
    desktop: "+9647510000001",
    worker: "+9647510000002",
  };
  const phone = phoneByProject[testInfo.project.name];
  if (!phone) throw new Error("Approved owner browser fixture is unmapped");

  await page.goto("/en/owner/access");
  await page.getByLabel("Iraqi phone number").fill(phone);
  await page.getByRole("button", { name: "Send verification code" }).click();
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByText(/Verified/)).toBeVisible();
  await page
    .getByRole("link", {
      name: browserFixtures.en.access.cottageProfilesCta,
    })
    .click();

  await expect(
    page.getByRole("heading", { name: "Your cottages" }),
  ).toBeVisible();
  await expect(page.getByText("Started in Owner Application")).toBeVisible();
  await page
    .getByRole("button", { name: "Create another cottage draft" })
    .click();
  await page.reload();
  await expect(
    page.getByRole("link", { name: "Open Cottage Profile" }),
  ).toHaveCount(2);

  const additionalProfile = page
    .getByRole("article")
    .filter({ hasNotText: "Started in Owner Application" });
  await additionalProfile
    .getByRole("link", { name: "Open Cottage Profile" })
    .click();
  await page.getByRole("button", { name: "Abandon draft" }).click();
  await expect(page.getByText("Abandoned", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "This private Cottage Profile is abandoned and remains available as a read-only record.",
    ),
  ).toBeVisible();
  await expect(page.getByLabel("Cottage name")).toBeDisabled();
  await page.screenshot({
    path: testInfo.outputPath("en-owner-additional-abandoned.png"),
    fullPage: true,
  });
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
  await page.screenshot({
    path: testInfo.outputPath("ar-owner-additional-abandoned.png"),
    fullPage: true,
  });
  await page.goto("/en/owner/cottages");

  const applicationProfile = page
    .getByRole("article")
    .filter({ hasText: "Started in Owner Application" });
  await applicationProfile
    .getByRole("link", { name: "Open Cottage Profile" })
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
  await page.getByLabel("Latitude").fill("36.408333");
  await page.getByLabel("Longitude").fill("44.385834");
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
  await expect(page.getByRole("status")).toContainText("Private draft saved.");

  await page.getByLabel("Shift 1 name").fill("Morning");
  await page.getByLabel("Shift 1 start time").fill("08:00");
  await page.getByLabel("Shift 1 end time").fill("13:00");
  await page.getByLabel("Shift 2 name").fill("Afternoon");
  await page.getByLabel("Shift 2 start time").fill("12:00");
  await page.getByLabel("Shift 2 end time").fill("16:00");
  await page.getByRole("button", { name: "Save Shift Schedule" }).click();
  await expect(
    page.getByText(
      "These recurring shifts overlap. Touching endpoints are allowed.",
    ),
  ).toBeVisible();

  await page.getByLabel("Shift 1 name").fill("Evening");
  await page.getByLabel("Shift 1 start time").fill("18:00");
  await page.getByLabel("Shift 1 end time").fill("02:00");
  await page.getByLabel("Shift 2 name").fill("Morning");
  await page.getByLabel("Shift 2 start time").fill("08:00");
  await page.getByLabel("Shift 2 end time").fill("12:00");
  await page.getByRole("button", { name: "Save Shift Schedule" }).click();
  await expect(
    page.getByText("Shift Schedule saved as a new revision."),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Shift 1 name")).toHaveValue("Morning");
  await expect(page.getByLabel("Shift 2 name")).toHaveValue("Evening");
  await expect(page.getByText("08:00 → 02:00 (next day)")).toBeVisible();

  const privatePng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  await page.getByLabel("Choose cottage photo").setInputFiles({
    name: "shaqlawa-orchard-cottage.png",
    mimeType: "image/png",
    buffer: privatePng,
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

  await page.screenshot({
    path: testInfo.outputPath("en-owner-cottage-profile-ready.png"),
    fullPage: true,
  });
  const profilePath = new URL(page.url()).pathname.replace(/^\/en/, "");
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
        name:
          locale === "ar" ? "جدول المناوبات اليومية" : "خشتەی شیفتە ڕۆژانەکان",
      }),
    ).toBeVisible();
    await expectCottageProfileSectionTitlesAligned(page, sectionNames);
    await expectCottageProfileActionHierarchy(
      page,
      actionNames,
      testInfo.project.name,
    );
    await page.screenshot({
      path: testInfo.outputPath(`${locale}-owner-cottage-profile-ready.png`),
      fullPage: true,
    });
  }

  await page.goto(`/en${profilePath}`);
  await page
    .getByRole("button", { name: "Submit for content approval" })
    .click();
  await expect(page.getByText("Submitted for content approval")).toBeVisible();
  await expect(page.getByLabel("Cottage name")).toBeDisabled();
  await expect(page.getByLabel("Shift 1 name")).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Save Shift Schedule" }),
  ).toHaveCount(0);
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
    await page.screenshot({
      path: testInfo.outputPath(
        `${locale}-owner-cottage-profile-submitted-review.png`,
      ),
      fullPage: true,
    });
  }
});

test("a Platform Administrator reaches access only after authenticator MFA", async ({
  page,
}, testInfo) => {
  const reviewFixture = accessBrowserFixture(testInfo.project.name);
  const email = `platform-administrator-${testInfo.project.name}@rentcottage.test`;
  const actorUserId = await administratorId(email);
  const attemptedAfter = new Date().toISOString();
  await page.goto("/en/administrator/access");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("Local-test-password-2026");
  await page.getByRole("button", { name: "Continue" }).click();
  const secret = await page.getByTestId("mfa-secret").textContent();
  if (!secret) throw new Error("MFA enrollment returned no secret");
  const failedAttemptedAfter = new Date().toISOString();
  await page.getByLabel("Authenticator app code").fill("12");
  await page.getByRole("button", { name: "Verify" }).click();
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
  await page.getByRole("button", { name: "Verify" }).click();

  await expect(page.getByText(/Administrator access is ready/)).toBeVisible();
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
  await expect(page.getByRole("status")).toContainText(
    "Cottage Profile restored.",
  );
  await expect(page.getByText("Private draft", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Abandon draft" }),
  ).toBeEnabled();
  await page.screenshot({
    path: testInfo.outputPath("en-administrator-additional-restored.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "Back to cottages" }).click();
  const submittedProfile = page
    .getByRole("article")
    .filter({ hasText: "Submitted for content approval" })
    .last();
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
    await page.screenshot({
      path: testInfo.outputPath(
        `${locale}-administrator-submitted-cottage-review.png`,
      ),
      fullPage: true,
    });
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
      await expect(page.getByText("Published", { exact: true })).toBeVisible();
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
      .select("opaque_id")
      .eq("publication_id", publication.id)
      .single();
    if (mediaError) throw mediaError;
    const opaqueId = publicationMedia.opaque_id;
    const media = await page.request.get(`/api/cottage-media/${opaqueId}`);
    expect(media.status()).toBe(200);
    expect(media.headers()["content-type"]).toContain("image/png");
    expect(media.headers()["cache-control"]).toContain("private");
    expect(media.headers()["cache-control"]).toContain("no-store");
    expect(media.headers().location).toBeUndefined();
    expect((await media.body()).subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );

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
    const { data: fixtureUsers, error: fixtureUsersError } =
      await auditClient.auth.admin.listUsers();
    if (fixtureUsersError) throw fixtureUsersError;
    const selectedOwner = fixtureUsers.users.find(
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
        name: "Reprocess with Terra العربية",
      }),
    ).toBeVisible();
    await expect(
      affectedLocalization.getByRole("button", {
        name: "Route to human review",
      }),
    ).toBeVisible();
  }
  await page.getByRole("link", { name: "Back to cottages" }).click();
  await expect(
    page.getByRole("heading", { name: "Private Cottage Profiles" }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("en-administrator-cottage-profiles.png"),
    fullPage: true,
  });

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
    await tabTo(page, createLink);
    if (testInfo.project.name !== "worker") {
      await page.screenshot({
        path: testInfo.outputPath(`${locale}-administrator-review-idle.png`),
        fullPage: true,
      });
    }
    await page.keyboard.press("Enter");
    const secureLink = identityDocument.getByRole("link", {
      name: copy.openDocument,
    });
    await expect(secureLink).toBeVisible();
    if (testInfo.project.name !== "worker") {
      await page.screenshot({
        path: testInfo.outputPath(`${locale}-administrator-review-ready.png`),
        fullPage: true,
      });
    }
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
  expect(documentAudit.document_id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
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
  await page.screenshot({
    path: testInfo.outputPath("en-administrator-review-detail.png"),
    fullPage: true,
  });

  await page.getByRole("button", { name: "Start review" }).click();
  const currentAdministratorStatus = page
    .locator(".administrator-review-detail > .application-section")
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
  await page.screenshot({
    path: testInfo.outputPath("en-administrator-review-needs-information.png"),
    fullPage: true,
  });

  await openOwnerApplication(page, "en", reviewFixture.reviewOwnerPhone);
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
  await page.screenshot({
    path: testInfo.outputPath("en-owner-response-request.png"),
    fullPage: true,
  });
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
}, testInfo) => {
  assertIsolatedLocalAccessDatabase();
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
      "id,current_publication_id,current_shift_schedule_id,exact_address,private_directions",
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
    fixture!.privateDirections.trim() === ""
  ) {
    throw new Error(
      "Published Cottage Profile fixture needs private address and directions",
    );
  }
  const exactAddress = fixture!.exactAddress;
  const privateDirections = fixture!.privateDirections;
  const expectPrivateValuesAbsent = async () => {
    await expect(page.locator("body")).not.toContainText(exactAddress);
    await expect(page.locator("body")).not.toContainText(privateDirections);
    const serializedPage = await page.content();
    expect(serializedPage).not.toContain(exactAddress);
    expect(serializedPage).not.toContain(privateDirections);
  };
  const waitForFonts = () =>
    page.evaluate(async () => {
      await document.fonts.ready;
    });
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
  const fullDayEndDay =
    lastShift!.end_time < firstShift.start_time ? serviceDay(3) : secondDay;
  const formatEnglishIraqDateTime = (value: string) =>
    new Intl.DateTimeFormat("en-IQ", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Baghdad",
    }).format(new Date(value));
  const expectedFullDayAccessRange = `${formatEnglishIraqDateTime(
    `${firstDay}T${firstShift.start_time}+03:00`,
  )} – ${formatEnglishIraqDateTime(
    `${fullDayEndDay}T${lastShift!.end_time}+03:00`,
  )}`;
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
          state: "open",
        })),
        {
          unitId: schedule.full_day_bundle_id,
          unitKind: "full_day_bundle",
          state: "open",
        },
      ],
    ],
    [
      secondDay,
      [
        ...shifts.map((shift) => ({
          unitId: shift.id,
          unitKind: "shift",
          state: "open",
        })),
        {
          unitId: schedule.full_day_bundle_id,
          unitKind: "full_day_bundle",
          state: "open",
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

  await page.goto("/en");
  await page.getByLabel("From Service Day").fill(firstDay);
  await page.getByLabel("To Service Day").fill(secondDay);
  await page
    .getByRole("group", { name: firstDay })
    .getByRole("checkbox", { name: `Shift ${firstShift.position}` })
    .check();
  await page
    .getByRole("group", { name: firstDay })
    .getByRole("checkbox", { name: `Shift ${secondShift.position}` })
    .check();
  await page
    .getByRole("group", { name: secondDay })
    .getByRole("checkbox", { name: `Shift ${firstShift.position}` })
    .check();
  await page.getByRole("button", { name: "Search available cottages" }).click();
  const resultCard = page.locator("article").filter({
    has: page.locator(`a[href^="/en/cottages/${fixture!.slug}?"]`),
  });
  await expect(
    resultCard.getByRole("heading", { name: fixture!.name }),
  ).toBeVisible();
  await expect(
    resultCard.getByText(`${fixture!.approximateLocation},`, { exact: false }),
  ).toBeVisible();
  await expect(
    resultCard.getByText("IQD 550,000", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByText(
        new RegExp(
          `${firstShift.name}.*${firstShift.start_time.slice(0, 5)}.*${firstShift.end_time.slice(0, 5)}`,
        ),
      )
      .first(),
  ).toBeVisible();
  await expectPrivateValuesAbsent();
  await waitForFonts();
  await page.screenshot({
    path: testInfo.outputPath("public-cottage-results.png"),
    fullPage: true,
  });
  await resultCard.getByRole("link", { name: "View cottage" }).click();
  await expect(page).toHaveURL(/\/en\/cottages\/[^/?]+\?/);
  await expect(
    page.getByRole("heading", { name: fixture!.name }),
  ).toBeVisible();
  await expect(page.getByText("Total price: IQD 550,000")).toBeVisible();
  await expectPrivateValuesAbsent();
  await waitForFonts();
  await page.screenshot({
    path: testInfo.outputPath("en-public-cottage-profile.png"),
    fullPage: true,
  });
  const english = new URL(page.url());
  expect(english.searchParams.getAll("selection")).toHaveLength(3);
  expect(english.searchParams.get("from")).toBe(firstDay);
  expect(english.searchParams.get("to")).toBe(secondDay);
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
  const customerPhone = journeyPhone(testInfo.project.name, ["0", "9", "9"]);
  await page.getByLabel("Iraqi phone number").fill(customerPhone);
  await page.getByRole("button", { name: "Send verification code" }).click();
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Verify", exact: true }).click();
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
  await waitForFonts();
  await page.screenshot({
    path: testInfo.outputPath("en-booking-request-form.png"),
    fullPage: true,
  });
  const quoteUrl = page.url();
  await page.getByRole("link", { name: "کوردی" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ckb");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(
    page.getByRole("heading", { name: "پێشنیاری نرخی وردی حجزکردن" }),
  ).toBeVisible();
  await expect(
    page.getByText(`شەفتی ${firstShift.position}`).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "داواکاری حجز بنێرە" }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/Morning|Evening/);
  await expectPrivateValuesAbsent();
  await waitForFonts();
  await page.screenshot({
    path: testInfo.outputPath("ckb-public-booking-quote.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "العربية" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(
    page.getByRole("heading", { name: "عرض سعر الحجز الدقيق" }),
  ).toBeVisible();
  await expect(
    page.getByText(`الوردية ${firstShift.position}`).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "أرسل طلب الحجز" }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/Morning|Evening/);
  await expectPrivateValuesAbsent();
  await waitForFonts();
  await page.screenshot({
    path: testInfo.outputPath("ar-public-booking-quote.png"),
    fullPage: true,
  });

  await page.goto("/en");
  await page.getByLabel("From Service Day").fill(firstDay);
  await page.getByLabel("To Service Day").fill(secondDay);
  for (const day of [firstDay, secondDay]) {
    await page
      .getByRole("group", { name: day })
      .getByRole("checkbox", { name: "Full-day bundle" })
      .check();
  }
  await page.getByRole("button", { name: "Search available cottages" }).click();
  const fullDayResult = page.locator("article").filter({
    has: page.locator(`a[href^="/en/cottages/${fixture!.slug}?"]`),
  });
  await expect(
    fullDayResult.getByRole("heading", { name: fixture!.name }),
  ).toBeVisible();
  await expect(
    fullDayResult.getByText("IQD 510,000", { exact: true }),
  ).toBeVisible();
  await expect(
    fullDayResult.getByText("Full-day bundle", { exact: false }),
  ).toHaveCount(2);
  await fullDayResult.getByRole("link", { name: "View cottage" }).click();
  await expect(page.getByText("Total price: IQD 510,000")).toBeVisible();
  await page.getByRole("link", { name: "Get exact quote" }).click();
  const fullDayItems = page.getByRole("listitem", {
    name: /Full-Day Bundle/,
  });
  await expect(fullDayItems).toHaveCount(2);
  await expect(fullDayItems.nth(0)).toContainText("IQD 250,000");
  await expect(fullDayItems.nth(1)).toContainText("IQD 260,000");
  await expect(page.getByText("IQD 510,000", { exact: true })).toBeVisible();
  await expect(page.getByText("IQD 5,000", { exact: true })).toBeVisible();
  await expect(page.getByText("IQD 515,000", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Continuous full-day access" }),
  ).toBeVisible();
  await expect(page.locator(".quote-access li")).toHaveCount(1);
  await expect(page.locator(".quote-access li")).toHaveText(
    expectedFullDayAccessRange,
  );
  await expectPrivateValuesAbsent();
  await waitForFonts();
  await page.screenshot({
    path: testInfo.outputPath("en-consecutive-full-day-booking-quote.png"),
    fullPage: true,
  });

  await page.goto(english.toString());
  await page.getByRole("link", { name: "کوردی" }).click();
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
      ".profile-heading h1, .profile-section h2, .profile-section p, .booking-summary h2, .booking-summary li, .booking-summary strong",
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
  await waitForFonts();
  await page.screenshot({
    path: testInfo.outputPath("ckb-public-cottage-profile.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "العربية" }).click();
  await expect(page).toHaveURL(
    new RegExp(`${english.pathname.replace(/^\/en/, "/ar")}\\?`),
  );
  const arabic = new URL(page.url());
  expect(arabic.pathname).toBe(english.pathname.replace(/^\/en/, "/ar"));
  expect(arabic.search).toBe(english.search);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByText(fixture!.arabicDescription)).toBeVisible();
  await expectPrivateValuesAbsent();
  await waitForFonts();
  await page.screenshot({
    path: testInfo.outputPath("ar-public-cottage-profile.png"),
    fullPage: true,
  });

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
  await waitForFonts();
  await page.screenshot({
    path: testInfo.outputPath("public-cottage-profile-unavailable.png"),
    fullPage: true,
  });
});
