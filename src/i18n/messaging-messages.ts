import type { Locale } from "./routing";

export const messagingMessages: Record<
  Locale,
  {
    inbox: string;
    empty: string;
    emptyMessages: string;
    categories: Record<
      "contact" | "incorrect" | "unclear" | "inappropriate",
      string
    >;
    conversation: string;
    messages: string;
    send: string;
    sending: string;
    messageLabel: string;
    languageLabel: string;
    blocked: string;
    unavailable: string;
    readOnly: string;
    contactAllowed: string;
    contactProtected: string;
    automaticTranslation: string;
    fictionalTranslation: string;
    viewOriginal: string;
    viewTranslation: string;
    translationUnavailable: string;
    reportTranslation: string;
    reported: string;
    older: string;
    newer: string;
    continueEnquiry: string;
    newEnquiry: string;
    newEnquiryHelp: string;
    messageCottage: string;
    open: string;
    booking: string;
    responseDeadline: string;
    writingDeadline: string;
    moderation: string;
    blockedAttempts: string;
    translationReports: string;
    customer: string;
    owner: string;
    sourceLanguage: string;
    refresh: string;
    priorRequests: string;
    bookedPeriod: string;
  }
> = {
  en: {
    emptyMessages: "No messages yet.",
    categories: {
      contact: "Contact details",
      incorrect: "Incorrect translation",
      unclear: "Unclear translation",
      inappropriate: "Inappropriate translation",
    },
    inbox: "Messages",
    empty: "No conversations yet.",
    conversation: "Conversation",
    messages: "Messages",
    send: "Send message",
    sending: "Sending…",
    messageLabel: "Message",
    languageLabel: "Message language",
    blocked: "Remove contact details before sending this message.",
    unavailable: "Messaging is unavailable. Your original text is still shown.",
    readOnly:
      "This conversation is read-only because its writing period has ended.",
    contactAllowed: "Contact details are allowed for this paid booking.",
    contactProtected:
      "You can send contact details once this booking has a valid payment.",
    automaticTranslation: "Automatic translation",
    fictionalTranslation: "Fictional local-test translation",
    viewOriginal: "View original",
    viewTranslation: "View translation",
    translationUnavailable: "Translation is unavailable. Showing the original.",
    reportTranslation: "Report poor translation",
    reported: "Translation reported.",
    older: "Older messages",
    newer: "Back to newest",
    continueEnquiry: "Continue an existing enquiry",
    newEnquiry: "Start an independent new enquiry",
    newEnquiryHelp: "Use a new enquiry for a different stay.",
    messageCottage: "Message this cottage",
    open: "Open conversation",
    booking: "Booking request",
    responseDeadline: "Response deadline",
    writingDeadline: "Writing closes",
    moderation: "Messaging review",
    blockedAttempts: "Blocked contact attempts",
    translationReports: "Translation reports",
    customer: "Customer",
    owner: "Cottage owner",
    sourceLanguage: "Original language",
    refresh: "Refresh conversation",
    priorRequests: "Earlier request outcomes",
    bookedPeriod: "Booked period",
  },
  ar: {
    emptyMessages: "لا توجد رسائل بعد.",
    categories: {
      contact: "تفاصيل الاتصال",
      incorrect: "ترجمة غير صحيحة",
      unclear: "ترجمة غير واضحة",
      inappropriate: "ترجمة غير لائقة",
    },
    inbox: "الرسائل",
    empty: "لا توجد محادثات بعد.",
    conversation: "المحادثة",
    messages: "الرسائل",
    send: "إرسال الرسالة",
    sending: "جارٍ الإرسال…",
    messageLabel: "الرسالة",
    languageLabel: "لغة الرسالة",
    blocked: "احذف تفاصيل الاتصال قبل إرسال هذه الرسالة.",
    unavailable: "الرسائل غير متاحة. ما زال النص الأصلي معروضاً.",
    readOnly: "هذه المحادثة للقراءة فقط لانتهاء مدة الكتابة.",
    contactAllowed: "تفاصيل الاتصال مسموحة لهذا الحجز المدفوع.",
    contactProtected:
      "يمكنك إرسال تفاصيل الاتصال بعد أن يصبح لهذا الحجز دفع صالح.",
    automaticTranslation: "ترجمة آلية",
    fictionalTranslation: "ترجمة خيالية للاختبار المحلي",
    viewOriginal: "عرض الأصل",
    viewTranslation: "عرض الترجمة",
    translationUnavailable: "الترجمة غير متاحة. يتم عرض النص الأصلي.",
    reportTranslation: "الإبلاغ عن ترجمة ضعيفة",
    reported: "تم الإبلاغ عن الترجمة.",
    older: "رسائل أقدم",
    newer: "العودة إلى الأحدث",
    continueEnquiry: "متابعة استفسار موجود",
    newEnquiry: "بدء استفسار جديد مستقل",
    newEnquiryHelp: "استخدم استفساراً جديداً لإقامة مختلفة.",
    messageCottage: "مراسلة هذا البيت",
    open: "فتح المحادثة",
    booking: "طلب الحجز",
    responseDeadline: "مهلة الرد",
    writingDeadline: "إغلاق الكتابة",
    moderation: "مراجعة الرسائل",
    blockedAttempts: "محاولات الاتصال المحظورة",
    translationReports: "بلاغات الترجمة",
    customer: "العميل",
    owner: "مالك البيت",
    sourceLanguage: "اللغة الأصلية",
    refresh: "تحديث المحادثة",
    priorRequests: "نتائج الطلبات السابقة",
    bookedPeriod: "فترة الحجز",
  },
  ckb: {
    emptyMessages: "هێشتا هیچ نامەیەک نییە.",
    categories: {
      contact: "زانیاریی پەیوەندی",
      incorrect: "وەرگێڕانی هەڵە",
      unclear: "وەرگێڕانی ناڕوون",
      inappropriate: "وەرگێڕانی نەگونجاو",
    },
    inbox: "نامەکان",
    empty: "هێشتا هیچ گفتوگۆیەک نییە.",
    conversation: "گفتوگۆ",
    messages: "نامەکان",
    send: "نامە بنێرە",
    sending: "دەنێردرێت…",
    messageLabel: "نامە",
    languageLabel: "زمانی نامە",
    blocked: "زانیاری پەیوەندی لاببە پێش ناردنی نامەکە.",
    unavailable: "نامەکان بەردەست نین. دەقی ڕەسەن هەر پیشان دەدرێت.",
    readOnly: "ماوەی نووسین کۆتایی هاتووە و گفتوگۆکە تەنها بۆ خوێندنەوەیە.",
    contactAllowed: "زانیاری پەیوەندی بۆ ئەم حجزە پارەدراوە ڕێگەپێدراوە.",
    contactProtected:
      "دەتوانیت زانیاری پەیوەندی بنێریت کاتێک ئەم حجزە پارەدانێکی دروستی هەبێت.",
    automaticTranslation: "وەرگێڕانی خۆکار",
    fictionalTranslation: "وەرگێڕانی خەیاڵی تاقیکردنەوەی ناوخۆیی",
    viewOriginal: "دەقی ڕەسەن ببینە",
    viewTranslation: "وەرگێڕان ببینە",
    translationUnavailable: "وەرگێڕان بەردەست نییە. دەقی ڕەسەن پیشان دەدرێت.",
    reportTranslation: "ڕاپۆرتی وەرگێڕانی خراپ",
    reported: "وەرگێڕان ڕاپۆرت کرا.",
    older: "نامە کۆنترەکان",
    newer: "گەڕانەوە بۆ نوێترین",
    continueEnquiry: "بەردەوامبوون لە پرسیارێکی هەبوو",
    newEnquiry: "دەستپێکردنی پرسیارێکی نوێ و سەربەخۆ",
    newEnquiryHelp: "بۆ مانەوەیەکی جیاواز پرسیارێکی نوێ بەکاربهێنە.",
    messageCottage: "نامە بۆ ئەم کۆتێجە بنێرە",
    open: "گفتوگۆ بکەرەوە",
    booking: "داواکاری حجز",
    responseDeadline: "کۆتا کاتی وەڵام",
    writingDeadline: "داخستنی نووسین",
    moderation: "پێداچوونەوەی نامەکان",
    blockedAttempts: "هەوڵە بلۆککراوەکانی پەیوەندی",
    translationReports: "ڕاپۆرتەکانی وەرگێڕان",
    customer: "کڕیار",
    owner: "خاوەنی کۆتێج",
    sourceLanguage: "زمانی ڕەسەن",
    refresh: "نوێکردنەوەی گفتوگۆ",
    priorRequests: "ئەنجامی داواکارییەکانی پێشوو",
    bookedPeriod: "ماوەی حجز",
  },
};
