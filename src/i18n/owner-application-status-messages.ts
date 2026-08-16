import type { OwnerApplicationStatus } from "@/owner-application/owner-application";
import type { Locale } from "./routing";

type Copy = {
  statuses: Record<OwnerApplicationStatus, string>;
  guidance: Record<Exclude<OwnerApplicationStatus, "draft">, string>;
  notices: string;
  respond: string;
  submitRenewal: string;
  reason: string;
  submitted: string;
  unavailable: string;
  requestedInformation: string;
  renewalInformation: string;
};

export const ownerApplicationStatusMessages: Record<Locale, Copy> = {
  en: {
    statuses: {
      draft: "Draft",
      submitted: "Submitted for review",
      needs_information: "Needs information",
      under_review: "Under review",
      approved: "Approved",
      rejected: "Rejected",
      expired: "Expired",
      suspended: "Suspended",
    },
    guidance: {
      submitted: "Your application is locked while it awaits initial review.",
      needs_information:
        "Your review clock is paused. Provide only the requested information in Owner Backoffice.",
      under_review:
        "Your response was received and review is underway. Your application remains locked.",
      approved:
        "Your owner identity is approved. This does not publish a cottage or enable bookings yet.",
      rejected:
        "Your application was rejected and remains read-only. Review the notice for the decision reason.",
      expired:
        "Your approval expired. Existing servicing remains available, but new business is blocked until renewal is approved.",
      suspended:
        "Your owner account is suspended for new business. Your application remains read-only.",
    },
    notices: "Application notices",
    respond: "Send requested information",
    submitRenewal: "Submit replacement evidence",
    reason: "RentCottage requested",
    submitted: "Your response was submitted.",
    unavailable: "Your response could not be submitted. Nothing changed.",
    requestedInformation: "Provide only the requested information below.",
    renewalInformation: "Replace the expired evidence below for review.",
  },
  ar: {
    statuses: {
      draft: "مسودة",
      submitted: "أُرسل للمراجعة",
      needs_information: "يحتاج معلومات",
      under_review: "قيد المراجعة",
      approved: "مقبول",
      rejected: "مرفوض",
      expired: "منتهي الصلاحية",
      suspended: "معلّق",
    },
    guidance: {
      submitted: "طلبك مقفل أثناء انتظار المراجعة الأولية.",
      needs_information:
        "توقفت مهلة المراجعة مؤقتاً. قدّم فقط المعلومات المطلوبة في لوحة المالك.",
      under_review: "تم استلام ردك والمراجعة جارية. يبقى طلبك مقفلاً.",
      approved:
        "تمت الموافقة على هوية المالك. هذا لا ينشر كوخاً ولا يفعّل الحجوزات بعد.",
      rejected: "رُفض طلبك ويبقى للقراءة فقط. راجع الإشعار لمعرفة سبب القرار.",
      expired:
        "انتهت موافقتك. تستمر خدمة الأعمال القائمة، لكن الأعمال الجديدة محظورة حتى قبول التجديد.",
      suspended: "حساب المالك معلّق للأعمال الجديدة. يبقى طلبك للقراءة فقط.",
    },
    notices: "إشعارات الطلب",
    respond: "أرسل المعلومات المطلوبة",
    submitRenewal: "أرسل الأدلة البديلة",
    reason: "طلبت RentCottage",
    submitted: "تم إرسال ردك.",
    unavailable: "تعذر إرسال ردك. لم يتغير شيء.",
    requestedInformation: "قدّم المعلومات المطلوبة فقط أدناه.",
    renewalInformation: "استبدل الأدلة المنتهية أدناه للمراجعة.",
  },
  ckb: {
    statuses: {
      draft: "ڕەشنووس",
      submitted: "بۆ پێداچوونەوە نێردرا",
      needs_information: "زانیاری پێویستە",
      under_review: "لە ژێر پێداچوونەوەدایە",
      approved: "پەسەندکراو",
      rejected: "ڕەتکراوە",
      expired: "بەسەرچوو",
      suspended: "ڕاگیراو",
    },
    guidance: {
      submitted: "داواکارییەکەت قفڵە تا پێداچوونەوەی سەرەتایی دەست پێ بکات.",
      needs_information:
        "کاتی پێداچوونەوە ڕاگیراوە. تەنها زانیارییە داواکراوەکان لە بەشی خاوەن بنێرە.",
      under_review:
        "وەڵامەکەت وەرگیرا و پێداچوونەوە بەردەوامە. داواکارییەکەت هەر قفڵە.",
      approved:
        "ناسنامەی خاوەن پەسەندکرا. ئەمە هێشتا کۆخ بڵاوناکاتەوە یان حجز چالاک ناکات.",
      rejected:
        "داواکارییەکەت ڕەتکرایەوە و تەنها بۆ خوێندنەوەیە. هۆکاری بڕیارەکە لە ئاگادارکردنەوەکە ببینە.",
      expired:
        "پەسەندکردنەکەت بەسەرچوو. خزمەتگوزارییە هەبووەکان بەردەوامن، بەڵام کاری نوێ تا پەسەندکردنی نوێکردنەوە ڕاگیراوە.",
      suspended:
        "هەژماری خاوەن بۆ کاری نوێ ڕاگیراوە. داواکارییەکەت تەنها بۆ خوێندنەوەیە.",
    },
    notices: "ئاگادارکردنەوەکانی داواکاری",
    respond: "زانیارییە داواکراوەکان بنێرە",
    submitRenewal: "بەڵگەی جێگرەوە بنێرە",
    reason: "RentCottage داوای کردووە",
    submitted: "وەڵامەکەت نێردرا.",
    unavailable: "وەڵامەکەت نەنێردرا. هیچ شتێک نەگۆڕا.",
    requestedInformation: "تەنها زانیارییە داواکراوەکان پێشکەش بکە.",
    renewalInformation: "بەڵگە بەسەرچووەکان بۆ پێداچوونەوە بگۆڕە.",
  },
};
