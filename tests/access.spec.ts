import { expect, test, type Locator, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";
import * as OTPAuth from "otpauth";
import { createClient } from "@supabase/supabase-js";

type BrowserLocale = "en" | "ar" | "ckb";

const reviewDocumentFilename =
  "syntheticlongprivateidentityevidencefilenamethatmustwrapwithouttruncation.pdf";

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

function documentActionFor(card: Locator, copy: BrowserApplicationFixture) {
  return card
    .getByRole("button", { name: copy.upload, exact: true })
    .or(card.getByRole("button", { name: copy.replace, exact: true }));
}

test.describe.configure({ mode: "serial" });

test("a Customer verifies an Iraqi phone without losing the booking draft", async ({
  page,
}) => {
  await page.goto("/en/request/garden-house");
  await expect(
    page.getByText("Phone verification is available."),
  ).toBeVisible();
  await page
    .getByLabel("Note to the owner")
    .fill("Ground-floor access, please");
  await page.getByLabel("Iraqi phone number").fill("+9647500000000");
  await page.getByRole("button", { name: "Send verification code" }).click();
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Verify" }).click();

  await expect(page.getByText("You have Customer access only")).toBeVisible();
  await expect(page.getByLabel("Note to the owner")).toHaveValue(
    "Ground-floor access, please",
  );
});

test("a prospective Cottage Owner receives no approved-owner claim", async ({
  page,
}) => {
  await page.goto("/ckb/owner/access");
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
  await expect(page.getByText("Submitted for review")).toBeVisible();
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
      await expect(page.getByText(copy.submittedStatus)).toBeVisible();
      await expect(page.getByRole("button", { name: copy.submit })).toHaveCount(
        0,
      );
      await expect(
        page.getByRole("button", { name: copy.replace }),
      ).toHaveCount(0);
    }
  }
});

test("a Platform Administrator reaches access only after authenticator MFA", async ({
  page,
}, testInfo) => {
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
  const accessedAfter = new Date(Date.now() - 5_000).toISOString();
  for (const locale of ["en", "ar", "ckb"] as const) {
    const copy = browserFixtures[locale].review;
    const direction = locale === "en" ? "ltr" : "rtl";
    await page.goto(`/${locale}/administrator/owner-applications`);
    await expect(page.locator("html")).toHaveAttribute("dir", direction);
    await expect(page.getByRole("heading", { name: copy.title })).toBeVisible();
    await expect(page.getByText(reviewDocumentFilename).first()).toBeVisible();
    const identityDocument = page
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
