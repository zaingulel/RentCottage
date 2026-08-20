import {
  correctCottageLocalizationAction,
  decideCottageLocalizationAction,
  decideCottagePublicationAction,
  generateCottageTranslationAction,
  reportCottageTranslationAction,
  routeCottageTranslationToHumanReviewAction,
} from "@/cottage-publication/actions";
import type {
  CottagePublicationReviewState,
  CottageTranslationAdministration,
  LaunchLanguage,
} from "@/cottage-publication/cottage-publication";
import type { Locale } from "@/i18n/routing";
import type { TranslationFailureCode } from "@/translation/failure-code";

const copy = {
  en: {
    title: "Language review",
    in_review: "In review",
    approved: "Published",
    rejected: "Rejected",
    disabled:
      "Production translation and publication are disabled until the approved adapter is available.",
    description: "Description",
    rules: "House Rules",
    source: "Owner source",
    generated: "AI-generated draft",
    corrected: "Administrator correction",
    fallback: "Showing original while unavailable",
    humanReview: "Human review required",
    sourceLanguage: "Source language",
    reportReason: "Report reason",
    report: "Report translation",
    ownerReport: "Owner report",
    humanReviewReason: "Human-review reason",
    routeHumanReview: "Route to human review",
    controls: "Translation controls",
    generate: "Generate",
    reprocess: "Reprocess",
    reprocessWithTerra: "Reprocess with Terra",
    requestsReserved: "requests reserved",
    tokensReserved: "tokens reserved",
    spendReserved: "microusd reserved",
    spendActual: "microusd used",
    qualityReports: "quality reports",
    correctionReason: "Correction reason",
    save: "Save correction",
    approvalReason: "Decision reason",
    approve: "Approve language",
    reject: "Reject language",
    publish: "Publish all three languages",
    rejectPublication: "Reject publication",
  },
  ar: {
    title: "مراجعة اللغات",
    in_review: "قيد المراجعة",
    approved: "منشور",
    rejected: "مرفوض",
    disabled: "الترجمة والنشر للإنتاج معطّلان حتى يتوفر المحول المعتمد.",
    description: "الوصف",
    rules: "قواعد المنزل",
    source: "مصدر المالك",
    generated: "مسودة مولدة بالذكاء الاصطناعي",
    corrected: "تصحيح المسؤول",
    fallback: "يتم عرض النص الأصلي أثناء عدم توفر الترجمة",
    humanReview: "المراجعة البشرية مطلوبة",
    sourceLanguage: "لغة المصدر",
    reportReason: "سبب البلاغ",
    report: "الإبلاغ عن الترجمة",
    ownerReport: "بلاغ المالك",
    humanReviewReason: "سبب المراجعة البشرية",
    routeHumanReview: "إرسال إلى المراجعة البشرية",
    controls: "ضوابط الترجمة",
    generate: "إنشاء",
    reprocess: "إعادة المعالجة",
    reprocessWithTerra: "إعادة المعالجة باستخدام Terra",
    requestsReserved: "طلبات محجوزة",
    tokensReserved: "رموز محجوزة",
    spendReserved: "ميكرو دولار محجوز",
    spendActual: "ميكرو دولار مستخدم",
    qualityReports: "بلاغات جودة",
    correctionReason: "سبب التصحيح",
    save: "حفظ التصحيح",
    approvalReason: "سبب القرار",
    approve: "الموافقة على اللغة",
    reject: "رفض اللغة",
    publish: "نشر اللغات الثلاث",
    rejectPublication: "رفض النشر",
  },
  ckb: {
    title: "پێداچوونەوەی زمان",
    in_review: "لە پێداچوونەوەدایە",
    approved: "بڵاوکراوەتەوە",
    rejected: "ڕەتکرایەوە",
    disabled:
      "وەرگێڕان و بڵاوکردنەوەی بەرهەم تا بەردەستبوونی پەیوەندیکەری پەسەندکراو ناچالاکە.",
    description: "وەسف",
    rules: "یاساکانی ماڵ",
    source: "سەرچاوەی خاوەن",
    generated: "ڕەشنووسی دروستکراوی زیرەکی دەستکرد",
    corrected: "ڕاستکردنەوەی ئەدمین",
    fallback: "تا بەردەستبوونەوەی وەرگێڕان دەقی سەرچاوە پیشان دەدرێت",
    humanReview: "پێداچوونەوەی مرۆیی پێویستە",
    sourceLanguage: "زمانی سەرچاوە",
    reportReason: "هۆکاری ڕاپۆرت",
    report: "ڕاپۆرتکردنی وەرگێڕان",
    ownerReport: "ڕاپۆرتی خاوەن",
    humanReviewReason: "هۆکاری پێداچوونەوەی مرۆیی",
    routeHumanReview: "ناردن بۆ پێداچوونەوەی مرۆیی",
    controls: "کۆنترۆڵەکانی وەرگێڕان",
    generate: "دروستکردن",
    reprocess: "دووبارە پرۆسەکردن",
    reprocessWithTerra: "دووبارە پرۆسەکردن بە Terra",
    requestsReserved: "داواکاری تەرخانکراو",
    tokensReserved: "تۆکن تەرخانکراو",
    spendReserved: "مایکرۆدۆلار تەرخانکراو",
    spendActual: "مایکرۆدۆلار بەکارهاتوو",
    qualityReports: "ڕاپۆرتی کوالێتی",
    correctionReason: "هۆکاری ڕاستکردنەوە",
    save: "پاشەکەوتکردنی ڕاستکردنەوە",
    approvalReason: "هۆکاری بڕیار",
    approve: "پەسەندکردنی زمان",
    reject: "ڕەتکردنەوەی زمان",
    publish: "بڵاوکردنەوەی هەرسێ زمان",
    rejectPublication: "ڕەتکردنەوەی بڵاوکردنەوە",
  },
} as const;

const failureCopy: Record<Locale, Record<TranslationFailureCode, string>> = {
  en: {
    adapter_unavailable:
      "The approved translation adapter is unavailable. The original text is shown.",
    configuration_unavailable:
      "Translation configuration is unavailable. The original text is shown.",
    unsupported_content:
      "This content cannot be translated automatically. The original text is shown.",
    invalid_input:
      "This content could not be submitted for translation. The original text is shown.",
    usage_limit_reached:
      "The translation usage limit has been reached. The original text is shown.",
    provider_timeout:
      "Translation provider timed out. The original text is shown.",
    provider_unavailable:
      "Translation provider is unavailable. The original text is shown.",
    invalid_provider_response:
      "The translation response could not be validated. The original text is shown.",
    cache_unavailable:
      "The translation cache is unavailable. The original text is shown.",
    usage_accounting_unavailable:
      "Translation usage accounting is unavailable. The original text is shown.",
    provider_failure: "Translation failed. The original text is shown.",
  },
  ar: {
    adapter_unavailable: "محوّل الترجمة المعتمد غير متاح. يتم عرض النص الأصلي.",
    configuration_unavailable:
      "إعدادات الترجمة غير متاحة. يتم عرض النص الأصلي.",
    unsupported_content:
      "لا يمكن ترجمة هذا المحتوى تلقائياً. يتم عرض النص الأصلي.",
    invalid_input: "تعذر إرسال هذا المحتوى للترجمة. يتم عرض النص الأصلي.",
    usage_limit_reached: "تم بلوغ حد استخدام الترجمة. يتم عرض النص الأصلي.",
    provider_timeout: "انتهت مهلة مزود الترجمة. يتم عرض النص الأصلي.",
    provider_unavailable: "مزود الترجمة غير متاح. يتم عرض النص الأصلي.",
    invalid_provider_response:
      "تعذر التحقق من استجابة الترجمة. يتم عرض النص الأصلي.",
    cache_unavailable: "ذاكرة الترجمة المؤقتة غير متاحة. يتم عرض النص الأصلي.",
    usage_accounting_unavailable:
      "محاسبة استخدام الترجمة غير متاحة. يتم عرض النص الأصلي.",
    provider_failure: "فشلت الترجمة. يتم عرض النص الأصلي.",
  },
  ckb: {
    adapter_unavailable:
      "پەیوەندیکەری وەرگێڕانی پەسەندکراو بەردەست نییە. دەقی سەرچاوە پیشان دەدرێت.",
    configuration_unavailable:
      "ڕێکخستنی وەرگێڕان بەردەست نییە. دەقی سەرچاوە پیشان دەدرێت.",
    unsupported_content:
      "ئەم ناوەڕۆکە بە شێوەی خۆکار وەرناگێڕدرێت. دەقی سەرچاوە پیشان دەدرێت.",
    invalid_input:
      "ناردنی ئەم ناوەڕۆکە بۆ وەرگێڕان سەرکەوتوو نەبوو. دەقی سەرچاوە پیشان دەدرێت.",
    usage_limit_reached:
      "سنووری بەکارهێنانی وەرگێڕان پڕبووە. دەقی سەرچاوە پیشان دەدرێت.",
    provider_timeout:
      "کاتی دابینکەری وەرگێڕان تەواو بوو. دەقی سەرچاوە پیشان دەدرێت.",
    provider_unavailable:
      "دابینکەری وەرگێڕان بەردەست نییە. دەقی سەرچاوە پیشان دەدرێت.",
    invalid_provider_response:
      "پشتڕاستکردنەوەی وەڵامی وەرگێڕان سەرکەوتوو نەبوو. دەقی سەرچاوە پیشان دەدرێت.",
    cache_unavailable:
      "بیرگەی کاتی وەرگێڕان بەردەست نییە. دەقی سەرچاوە پیشان دەدرێت.",
    usage_accounting_unavailable:
      "ژمێریاری بەکارهێنانی وەرگێڕان بەردەست نییە. دەقی سەرچاوە پیشان دەدرێت.",
    provider_failure: "وەرگێڕان سەرکەوتوو نەبوو. دەقی سەرچاوە پیشان دەدرێت.",
  },
};

function languageName(locale: LaunchLanguage) {
  return locale === "ar"
    ? "العربية"
    : locale === "ckb"
      ? "کوردی سۆرانی"
      : "English";
}

export function CottagePublicationReview({
  locale,
  review,
  actor,
  administration,
}: {
  locale: Locale;
  review: CottagePublicationReviewState;
  actor: "owner" | "administrator";
  administration?: CottageTranslationAdministration;
}) {
  const text = copy[locale];
  const canPublish =
    review.productionReady &&
    review.localizations.length === 3 &&
    review.localizations.every((item) => item.approved);
  return (
    <section
      className="cottage-publication-review"
      aria-labelledby="cottage-publication-review-title"
    >
      <h2 id="cottage-publication-review-title">{text.title}</h2>
      <p className={`cottage-profile-status ${review.state}`}>
        {text[review.state]}
      </p>
      {review.sourceLanguage ? (
        <p>
          {text.sourceLanguage}: {languageName(review.sourceLanguage)}
        </p>
      ) : null}
      {!review.productionReady ? <p role="status">{text.disabled}</p> : null}
      {actor === "administrator" && administration ? (
        <section aria-labelledby="translation-controls-title">
          <h3 id="translation-controls-title">{text.controls}</h3>
          <p>
            {administration.monthRequests} /{" "}
            {administration.monthlyRequestLimit ?? "—"} {text.requestsReserved}
          </p>
          <p>
            {administration.monthReservedTokens} /{" "}
            {administration.monthlyTokenLimit ?? "—"} {text.tokensReserved}
          </p>
          <p>
            {administration.monthReservedMicrousd} /{" "}
            {administration.monthlySpendMicrousdLimit ?? "—"}{" "}
            {text.spendReserved}
          </p>
          <p>
            {administration.monthActualMicrousd} {text.spendActual}
          </p>
          <p>
            {administration.ordinaryModel ?? "—"} /{" "}
            {administration.ordinaryEffort ?? "—"};{" "}
            {administration.strongerModel ?? "—"} /{" "}
            {administration.strongerEffort ?? "—"};{" "}
            {administration.judgeModel ?? "—"} /{" "}
            {administration.judgeEffort ?? "—"}
          </p>
          <p>
            {administration.qualityReportCount} {text.qualityReports}
          </p>
        </section>
      ) : null}
      <div className="cottage-localization-grid">
        {review.localizations.map((item) => (
          <article key={item.locale}>
            <h3>{languageName(item.locale)}</h3>
            <p>
              {item.origin === "owner_source"
                ? text.source
                : item.origin === "generated"
                  ? text.generated
                  : item.origin === "administrator_correction"
                    ? text.corrected
                    : text.fallback}
            </p>
            {item.humanReviewRequired ? <p>{text.humanReview}</p> : null}
            {item.qualityReportReason ? (
              <p role="status">
                {text.ownerReport}: {item.qualityReportReason}
              </p>
            ) : null}
            {item.failureCode ? (
              <p role="alert">{failureCopy[locale][item.failureCode]}</p>
            ) : null}
            {actor === "administrator" &&
            review.state === "in_review" &&
            item.locale !== review.sourceLanguage &&
            !item.humanReviewRequired &&
            (item.origin === "source_fallback" ||
              item.origin === "generated") ? (
              <form action={generateCottageTranslationAction}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="reviewCycleId" value={review.id} />
                <input type="hidden" name="targetLocale" value={item.locale} />
                <input
                  type="hidden"
                  name="route"
                  value={
                    item.origin === "generated" ? "stronger_model" : "ordinary"
                  }
                />
                <button type="submit" disabled={!review.productionReady}>
                  {item.origin === "generated"
                    ? item.qualityReportReason
                      ? text.reprocessWithTerra
                      : text.reprocess
                    : text.generate}{" "}
                  {languageName(item.locale)}
                </button>
              </form>
            ) : null}
            {actor === "administrator" &&
            review.state === "in_review" &&
            item.revisionId ? (
              <form action={correctCottageLocalizationAction}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="reviewCycleId" value={review.id} />
                <input type="hidden" name="targetLocale" value={item.locale} />
                <label>
                  {text.description}
                  <textarea
                    name="description"
                    defaultValue={item.description}
                    lang={item.contentLanguage ?? item.locale}
                    dir={
                      (item.contentLanguage ?? item.locale) === "en"
                        ? "ltr"
                        : "rtl"
                    }
                  />
                </label>
                <label>
                  {text.rules}
                  <textarea
                    name="houseRules"
                    defaultValue={item.houseRules}
                    lang={item.contentLanguage ?? item.locale}
                    dir={
                      (item.contentLanguage ?? item.locale) === "en"
                        ? "ltr"
                        : "rtl"
                    }
                  />
                </label>
                <label>
                  {text.correctionReason}
                  <input name="reason" required />
                </label>
                <button type="submit">{text.save}</button>
              </form>
            ) : (
              <dl>
                <div>
                  <dt>{text.description}</dt>
                  <dd
                    lang={item.contentLanguage ?? item.locale}
                    dir={
                      (item.contentLanguage ?? item.locale) === "en"
                        ? "ltr"
                        : "rtl"
                    }
                  >
                    {item.description}
                  </dd>
                </div>
                <div>
                  <dt>{text.rules}</dt>
                  <dd
                    lang={item.contentLanguage ?? item.locale}
                    dir={
                      (item.contentLanguage ?? item.locale) === "en"
                        ? "ltr"
                        : "rtl"
                    }
                  >
                    {item.houseRules}
                  </dd>
                </div>
              </dl>
            )}
            {actor === "administrator" &&
            review.state === "in_review" &&
            item.revisionId ? (
              <form action={decideCottageLocalizationAction}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="reviewCycleId" value={review.id} />
                <input type="hidden" name="targetLocale" value={item.locale} />
                <label>
                  {text.approvalReason}
                  <input name="reason" required />
                </label>
                <button name="approved" value="true">
                  {text.approve}
                </button>
                <button name="approved" value="false">
                  {text.reject}
                </button>
              </form>
            ) : null}
            {actor === "administrator" &&
            review.state === "in_review" &&
            item.origin === "generated" ? (
              <form action={routeCottageTranslationToHumanReviewAction}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="reviewCycleId" value={review.id} />
                <input type="hidden" name="targetLocale" value={item.locale} />
                <label>
                  {text.humanReviewReason}
                  <input name="reason" required />
                </label>
                <button type="submit">{text.routeHumanReview}</button>
              </form>
            ) : null}
            {actor === "owner" &&
            item.origin === "generated" &&
            item.revisionId &&
            !item.qualityReportReason ? (
              <form action={reportCottageTranslationAction}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="reviewCycleId" value={review.id} />
                <input type="hidden" name="targetLocale" value={item.locale} />
                <input
                  type="hidden"
                  name="localizedRevisionId"
                  value={item.revisionId}
                />
                <label>
                  {text.reportReason}
                  <input name="reason" required />
                </label>
                <button type="submit">{text.report}</button>
              </form>
            ) : null}
          </article>
        ))}
      </div>
      {actor === "administrator" && review.state === "in_review" ? (
        <form action={decideCottagePublicationAction}>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="reviewCycleId" value={review.id} />
          <label>
            {text.approvalReason}
            <input name="reason" required />
          </label>
          <button name="approved" value="true" disabled={!canPublish}>
            {text.publish}
          </button>
          <button name="approved" value="false">
            {text.rejectPublication}
          </button>
        </form>
      ) : null}
    </section>
  );
}
