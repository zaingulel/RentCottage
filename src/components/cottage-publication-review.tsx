import {
  correctCottageLocalizationAction,
  decideCottageLocalizationAction,
  decideCottagePublicationAction,
} from "@/cottage-publication/actions";
import type { CottagePublicationReviewState } from "@/cottage-publication/cottage-publication";
import type { Locale } from "@/i18n/routing";

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
    correctionReason: "هۆکاری ڕاستکردنەوە",
    save: "پاشەکەوتکردنی ڕاستکردنەوە",
    approvalReason: "هۆکاری بڕیار",
    approve: "پەسەندکردنی زمان",
    reject: "ڕەتکردنەوەی زمان",
    publish: "بڵاوکردنەوەی هەرسێ زمان",
    rejectPublication: "ڕەتکردنەوەی بڵاوکردنەوە",
  },
} as const;

export function CottagePublicationReview({
  locale,
  review,
  actor,
}: {
  locale: Locale;
  review: CottagePublicationReviewState;
  actor: "owner" | "administrator";
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
      {!review.productionReady ? <p role="status">{text.disabled}</p> : null}
      <div className="cottage-localization-grid">
        {review.localizations.map((item) => (
          <article key={item.locale}>
            <h3>
              {item.locale === "ar"
                ? "العربية"
                : item.locale === "ckb"
                  ? "کوردی سۆرانی"
                  : "English"}
            </h3>
            <p>
              {item.origin === "owner_source"
                ? text.source
                : item.origin === "generated"
                  ? text.generated
                  : text.corrected}
            </p>
            {actor === "administrator" && review.state === "in_review" ? (
              <form action={correctCottageLocalizationAction}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="reviewCycleId" value={review.id} />
                <input type="hidden" name="targetLocale" value={item.locale} />
                <label>
                  {text.description}
                  <textarea
                    name="description"
                    defaultValue={item.description}
                    lang={item.locale}
                    dir={item.locale === "en" ? "ltr" : "rtl"}
                  />
                </label>
                <label>
                  {text.rules}
                  <textarea
                    name="houseRules"
                    defaultValue={item.houseRules}
                    lang={item.locale}
                    dir={item.locale === "en" ? "ltr" : "rtl"}
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
                    lang={item.locale}
                    dir={item.locale === "en" ? "ltr" : "rtl"}
                  >
                    {item.description}
                  </dd>
                </div>
                <div>
                  <dt>{text.rules}</dt>
                  <dd
                    lang={item.locale}
                    dir={item.locale === "en" ? "ltr" : "rtl"}
                  >
                    {item.houseRules}
                  </dd>
                </div>
              </dl>
            )}
            {actor === "administrator" && review.state === "in_review" ? (
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
