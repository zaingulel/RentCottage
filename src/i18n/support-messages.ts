import type { Locale } from "./routing";

type SupportCopy = {
  title: string;
  accountNavigation: string;
  preLive: string;
  notice: string;
  complaints: string;
  complaintsText: string;
  incidents: string;
  incidentsText: string;
  disputes: string;
  disputesText: string;
  reviews: string;
  reviewsText: string;
  records: string;
  recordsText: string;
  customerBookings: string;
  ownerBookings: string;
  home: string;
};

export const supportMessages: Record<Locale, SupportCopy> = {
  en: {
    title: "Support",
    accountNavigation: "Account and support",
    preLive: "Pre-live: support is not operating.",
    notice:
      "This page explains where to find existing records. You cannot send a complaint, contact a support team or open a case here. No message is sent and no response time is promised.",
    complaints: "Support complaints",
    complaintsText:
      "A concern or request for help is separate from a Booking Incident, a formal Payment Dispute and a public review. Complaint submission is unavailable before launch.",
    incidents: "Booking Incidents",
    incidentsText:
      "Restricted operational records of safety, fraud, property, payment or serious service problems associated with a booking. Cottage Owners can use the incident control in an eligible booking's details. This page does not record an incident.",
    disputes: "Payment Disputes",
    disputesText:
      "Formal payment-provider or chargeback cases handled using booking, payment, cancellation and incident evidence. A complaint does not guarantee a refund. This page cannot open a Payment Dispute.",
    reviews: "Public reviews",
    reviewsText:
      "Customers can review an eligible Completed Booking within 14 days. Reviews are public; do not include contact details or external links. Cottage Owner replies are not available yet. A review does not submit a support complaint.",
    records: "Existing records",
    recordsText:
      "Sign in with the appropriate account to see your records. Choose a booking for its available details and actions.",
    customerBookings: "My customer bookings",
    ownerBookings: "Bookings for my cottages",
    home: "RentCottage home",
  },
  ar: {
    title: "الدعم",
    accountNavigation: "الحساب والدعم",
    preLive: "قبل الإطلاق: خدمة الدعم غير متاحة.",
    notice:
      "توضح هذه الصفحة مكان العثور على السجلات الحالية. لا يمكنك إرسال شكوى أو التواصل مع فريق دعم أو فتح قضية هنا. لن تُرسل أي رسالة ولا يوجد وعد بوقت للرد.",
    complaints: "شكاوى الدعم",
    complaintsText:
      "الشكوى أو طلب المساعدة يختلف عن حادثة الحجز ونزاع الدفع الرسمي والمراجعة العامة. تقديم الشكاوى غير متاح قبل الإطلاق.",
    incidents: "حوادث الحجز",
    incidentsText:
      "سجلات تشغيلية مقيّدة لمشكلات السلامة أو الاحتيال أو العقار أو الدفع أو الخدمة الجسيمة المرتبطة بحجز. يمكن لمالكي الأكواخ استخدام أداة تسجيل الحادثة في تفاصيل الحجز المؤهل. هذه الصفحة لا تسجل حادثة.",
    disputes: "نزاعات الدفع",
    disputesText:
      "قضايا رسمية لدى مزود الدفع أو استرداد المدفوعات تُعالج باستخدام أدلة الحجز والدفع والإلغاء والحوادث. الشكوى لا تضمن استرداد المبلغ. هذه الصفحة لا تفتح نزاع دفع.",
    reviews: "المراجعات العامة",
    reviewsText:
      "يمكن للعملاء مراجعة حجز مكتمل مؤهل خلال 14 يومًا. المراجعات علنية؛ لا تُدرج بيانات اتصال أو روابط خارجية. ردود مالكي الأكواخ غير متاحة بعد. المراجعة لا تقدم شكوى دعم.",
    records: "السجلات الحالية",
    recordsText:
      "سجّل الدخول بالحساب المناسب لعرض سجلاتك. اختر حجزًا للاطلاع على تفاصيله وإجراءاته المتاحة.",
    customerBookings: "حجوزاتي كعميل",
    ownerBookings: "حجوزات أكواخي",
    home: "العودة إلى RentCottage",
  },
  ckb: {
    title: "پشتیوانی",
    accountNavigation: "هەژمار و پشتیوانی",
    preLive: "پێش دەستپێکردن: پشتیوانی کار ناکات.",
    notice:
      "ئەم لاپەڕەیە شوێنی تۆمارە هەبووەکان ڕوون دەکاتەوە. لێرە ناتوانیت سکاڵا بنێریت، پەیوەندی بە تیمی پشتیوانیەوە بکەیت یان دۆسیەیەک بکەیتەوە. هیچ پەیامێک نانێردرێت و هیچ کاتێک بۆ وەڵامدانەوە بەڵێن نادرێت.",
    complaints: "سکاڵاکانی پشتیوانی",
    complaintsText:
      "نیگەرانی یان داوای یارمەتی جیاوازە لە ڕووداوی حجز، ناکۆکی فەرمی پارەدان و پێداچوونەوەی گشتی. ناردنی سکاڵا پێش دەستپێکردن بەردەست نییە.",
    incidents: "ڕووداوەکانی حجز",
    incidentsText:
      "تۆماری کارگێڕی سنووردارن بۆ کێشەکانی سەلامەتی، ساختەکاری، موڵک، پارەدان یان خزمەتگوزاریی گرنگ کە بە حجزەوە پەیوەستە. خاوەن کۆتێج دەتوانێت لە وردەکاریی حجزی شیاو کۆنترۆڵی تۆمارکردنی ڕووداو بەکاربهێنێت. ئەم لاپەڕەیە ڕووداو تۆمار ناکات.",
    disputes: "ناکۆکییەکانی پارەدان",
    disputesText:
      "دۆسیەی فەرمی لای دابینکەری پارەدان یان گەڕاندنەوەی پارە کە بە بەڵگەی حجز، پارەدان، هەڵوەشاندنەوە و ڕووداو چارەسەر دەکرێن. سکاڵا گەڕاندنەوەی پارە مسۆگەر ناکات. ئەم لاپەڕەیە ناکۆکیی پارەدان ناکاتەوە.",
    reviews: "پێداچوونەوە گشتییەکان",
    reviewsText:
      "کڕیار دەتوانێت لە ماوەی 14 ڕۆژدا پێداچوونەوە بۆ حجزی تەواوبووی شیاو بنووسێت. پێداچوونەوەکان گشتین؛ زانیاری پەیوەندی یان بەستەری دەرەکی تێدا دانەنێ. وەڵامی خاوەن کۆتێج هێشتا بەردەست نییە. پێداچوونەوە سکاڵای پشتیوانی نانێرێت.",
    records: "تۆمارە هەبووەکان",
    recordsText:
      "بە هەژماری گونجاو بچۆ ژوورەوە بۆ بینینی تۆمارەکانت. حجزێک هەڵبژێرە بۆ وردەکاری و کردارە بەردەستەکانی.",
    customerBookings: "حجزەکانم وەک کڕیار",
    ownerBookings: "حجزەکانی کۆتێجەکانم",
    home: "گەڕانەوە بۆ RentCottage",
  },
};
