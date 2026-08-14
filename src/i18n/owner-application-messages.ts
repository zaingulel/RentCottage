import type { VerificationDocumentKind } from "@/owner-application/owner-application";
import type { Locale } from "./routing";

const documentKinds: Record<
  VerificationDocumentKind,
  { title: string; help: string }
> = {
  identity: {
    title: "Identity evidence",
    help: "Passport, national identity card, or authorised representative evidence.",
  },
  company_registration: {
    title: "Company evidence",
    help: "Registration or incorporation evidence for the applicant company.",
  },
  authorised_representative: {
    title: "Authorised-representative evidence",
    help: "Identity and written authority for the person acting for the company.",
  },
  authority_to_rent: {
    title: "Authority-to-rent evidence",
    help: "Title, lease, management agreement, or written owner authority.",
  },
  licensing_or_exemption: {
    title: "Licence or exemption evidence",
    help: "Applicable tourism, municipal, safety, or recorded exemption evidence.",
  },
  payout_account: {
    title: "Payout-account evidence",
    help: "Evidence that the settlement account belongs to the applicant.",
  },
};

export const ownerApplicationMessages: Record<
  Locale,
  {
    eyebrow: string;
    title: string;
    intro: string;
    privacyNote: string;
    accessRequired: string;
    verifyPhone: string;
    draftStatus: string;
    submittedStatus: string;
    submittedNote: string;
    ownerSection: string;
    cottageSection: string;
    documentsSection: string;
    documentsIntro: string;
    individual: string;
    company: string;
    applicantKind: string;
    legalName: string;
    companyName: string;
    licensingBasis: string;
    licence: string;
    exemption: string;
    exemptionBasis: string;
    exemptionBasisHelp: string;
    cottageName: string;
    governorate: string;
    approximateLocation: string;
    exactAddress: string;
    exactAddressHelp: string;
    capacity: string;
    bedrooms: string;
    bathrooms: string;
    amenities: string;
    amenityOptions: { value: string; label: string }[];
    description: string;
    houseRules: string;
    saveDraft: string;
    saved: string;
    savedCleanupRequired: string;
    savedDeletionAuditRequired: string;
    invalid: string;
    unavailable: string;
    denied: string;
    submit: string;
    incompleteTitle: string;
    submitted: string;
    upload: string;
    replace: string;
    uploaded: string;
    uploadedCleanupRequired: string;
    uploadedDeletionAuditRequired: string;
    failedCleanupRequired: string;
    registrationReconciliationRequired: string;
    invalidDocument: string;
    documentRules: string;
    saveBeforeDocuments: string;
    documentKinds: Record<
      VerificationDocumentKind,
      { title: string; help: string }
    >;
    missing: Record<string, string>;
  }
> = {
  en: {
    eyebrow: "Owner onboarding",
    title: "Prepare your Owner Application",
    intro:
      "Save your progress over several visits. Your first cottage and evidence stay private until RentCottage completes its review.",
    privacyNote:
      "Verification files are never published or translated. Secure links expire after 60 seconds and every access is recorded.",
    accessRequired:
      "Verify your Cottage Owner phone before opening this private application.",
    verifyPhone: "Verify Cottage Owner access",
    draftStatus: "Draft application",
    submittedStatus: "Submitted for review",
    submittedNote:
      "Your complete application is locked while RentCottage reviews it. You cannot publish a cottage or receive Booking Requests yet.",
    ownerSection: "Your details",
    cottageSection: "Your first private cottage",
    documentsSection: "Private verification documents",
    documentsIntro:
      "Upload one PDF, JPEG, or PNG for each evidence type. Each file may be up to 5 MB.",
    individual: "Individual",
    company: "Company",
    applicantKind: "Applicant type",
    legalName: "Legal name",
    companyName: "Company name",
    licensingBasis: "Local compliance basis",
    licence: "Applicable licence",
    exemption: "Recorded exemption",
    exemptionBasis: "Recorded exemption basis",
    exemptionBasisHelp:
      "Required only when no licence applies. Explain the jurisdiction and reason.",
    cottageName: "Cottage name",
    governorate: "Governorate",
    approximateLocation: "Approximate public area",
    exactAddress: "Exact private address",
    exactAddressHelp: "Kept private and never shown in ordinary cottage views.",
    capacity: "Guest capacity",
    bedrooms: "Bedrooms",
    bathrooms: "Bathrooms",
    amenities: "Amenities",
    amenityOptions: [
      { value: "garden", label: "Garden" },
      { value: "parking", label: "Parking" },
      { value: "pool", label: "Private pool" },
      { value: "air_conditioning", label: "Air conditioning" },
      { value: "wifi", label: "Wi-Fi" },
      { value: "outdoor_seating", label: "Outdoor seating" },
    ],
    description: "Cottage description",
    houseRules: "House Rules",
    saveDraft: "Save draft",
    saved: "Draft saved.",
    savedCleanupRequired:
      "Draft saved, but evidence you no longer need is awaiting secure cleanup.",
    savedDeletionAuditRequired:
      "Draft saved and obsolete evidence was removed, but its deletion audit needs attention.",
    invalid: "Check the marked fields and try again.",
    unavailable:
      "This action is temporarily unavailable. Nothing was submitted.",
    denied: "You do not have permission to access this private document.",
    submit: "Submit application",
    incompleteTitle: "Complete these items before submitting:",
    submitted: "Application submitted.",
    upload: "Upload document",
    replace: "Replace document",
    uploaded: "Private document saved.",
    uploadedCleanupRequired:
      "The new document was saved, but the previous file needs secure cleanup.",
    uploadedDeletionAuditRequired:
      "The new document was saved and the previous file was removed, but its audit record needs attention.",
    failedCleanupRequired:
      "The upload was not saved to your application, and its private file needs secure cleanup.",
    registrationReconciliationRequired:
      "The upload result could not be confirmed. The private file was kept for secure reconciliation.",
    invalidDocument: "Choose a PDF, JPEG, or PNG no larger than 5 MB.",
    documentRules: "PDF, JPEG, or PNG · maximum 5 MB",
    saveBeforeDocuments: "Save the draft before uploading documents.",
    documentKinds,
    missing: {
      application: "Save the application draft",
      legal_name: "Legal name",
      company_name: "Company name",
      licensing_basis: "Local compliance basis",
      exemption_basis: "Recorded exemption basis",
      cottage_name: "Cottage name",
      governorate: "Governorate",
      approximate_location: "Approximate public area",
      exact_address: "Exact private address",
      capacity: "Guest capacity",
      bedrooms: "Bedrooms",
      bathrooms: "Bathrooms",
      description: "Cottage description",
      house_rules: "House Rules",
      "document:identity": "Identity evidence",
      "document:company_registration": "Company evidence",
      "document:authorised_representative":
        "Authorised-representative evidence",
      "document:authority_to_rent": "Authority-to-rent evidence",
      "document:licensing_or_exemption": "Licence or exemption evidence",
      "document:payout_account": "Payout-account evidence",
    },
  },
  ar: {
    eyebrow: "انضمام المالك",
    title: "جهّز طلب المالك",
    intro:
      "احفظ تقدمك عبر عدة زيارات. يبقى البيت الأول والوثائق خاصين حتى تُكمل RentCottage المراجعة.",
    privacyNote:
      "لا تُنشر وثائق التحقق ولا تُرسل للترجمة. تنتهي صلاحية الرابط الآمن بعد 60 ثانية ويُسجّل كل وصول.",
    accessRequired: "تحقق من هاتف مالك البيت قبل فتح هذا الطلب الخاص.",
    verifyPhone: "تحقق من دخول مالك البيت",
    draftStatus: "طلب مسودة",
    submittedStatus: "أُرسل للمراجعة",
    submittedNote:
      "طلبك الكامل مقفل أثناء المراجعة. لا يمكنك نشر بيت أو استلام طلبات حجز بعد.",
    ownerSection: "بياناتك",
    cottageSection: "بيتك الأول الخاص",
    documentsSection: "وثائق التحقق الخاصة",
    documentsIntro:
      "ارفع ملف PDF أو JPEG أو PNG لكل نوع من الأدلة، بحد أقصى 5 ميغابايت.",
    individual: "فرد",
    company: "شركة",
    applicantKind: "نوع مقدم الطلب",
    legalName: "الاسم القانوني",
    companyName: "اسم الشركة",
    licensingBasis: "أساس الامتثال المحلي",
    licence: "ترخيص واجب التطبيق",
    exemption: "إعفاء مسجل",
    exemptionBasis: "أساس الإعفاء المسجل",
    exemptionBasisHelp:
      "مطلوب فقط إذا لم ينطبق ترخيص. اذكر الولاية القضائية والسبب.",
    cottageName: "اسم البيت",
    governorate: "المحافظة",
    approximateLocation: "المنطقة التقريبية العامة",
    exactAddress: "العنوان الدقيق الخاص",
    exactAddressHelp: "يبقى خاصاً ولا يظهر في صفحات البيوت العادية.",
    capacity: "سعة الضيوف",
    bedrooms: "غرف النوم",
    bathrooms: "الحمّامات",
    amenities: "المرافق",
    amenityOptions: [
      { value: "garden", label: "حديقة" },
      { value: "parking", label: "موقف سيارات" },
      { value: "pool", label: "مسبح خاص" },
      { value: "air_conditioning", label: "تكييف" },
      { value: "wifi", label: "واي فاي" },
      { value: "outdoor_seating", label: "جلسة خارجية" },
    ],
    description: "وصف البيت",
    houseRules: "قواعد البيت",
    saveDraft: "احفظ المسودة",
    saved: "حُفظت المسودة.",
    savedCleanupRequired:
      "حُفظت المسودة، لكن الأدلة التي لم تعد مطلوبة تنتظر التنظيف الآمن.",
    savedDeletionAuditRequired:
      "حُفظت المسودة وحُذفت الأدلة غير المطلوبة، لكن سجل الحذف يحتاج إلى مراجعة.",
    invalid: "راجع الحقول المعلَّمة وحاول مرة أخرى.",
    unavailable: "هذا الإجراء غير متاح مؤقتاً. لم يُرسل شيء.",
    denied: "ليس لديك إذن للوصول إلى هذه الوثيقة الخاصة.",
    submit: "أرسل الطلب",
    incompleteTitle: "أكمل هذه العناصر قبل الإرسال:",
    submitted: "أُرسل الطلب.",
    upload: "ارفع الوثيقة",
    replace: "استبدل الوثيقة",
    uploaded: "حُفظت الوثيقة الخاصة.",
    uploadedCleanupRequired:
      "حُفظت الوثيقة الجديدة، لكن الملف السابق يحتاج إلى تنظيف آمن.",
    uploadedDeletionAuditRequired:
      "حُفظت الوثيقة الجديدة وحُذف الملف السابق، لكن سجل الحذف يحتاج إلى مراجعة.",
    failedCleanupRequired:
      "لم يُحفظ الرفع في طلبك، ويحتاج ملفه الخاص إلى تنظيف آمن.",
    registrationReconciliationRequired:
      "تعذر تأكيد نتيجة الرفع. تم الاحتفاظ بالملف الخاص للمطابقة الآمنة.",
    invalidDocument: "اختر PDF أو JPEG أو PNG بحجم لا يتجاوز 5 ميغابايت.",
    documentRules: "PDF أو JPEG أو PNG · بحد أقصى 5 ميغابايت",
    saveBeforeDocuments: "احفظ المسودة قبل رفع الوثائق.",
    documentKinds: {
      identity: {
        title: "إثبات الهوية",
        help: "جواز سفر أو هوية وطنية أو إثبات الممثل المفوض.",
      },
      company_registration: {
        title: "إثبات الشركة",
        help: "إثبات تسجيل أو تأسيس الشركة مقدمة الطلب.",
      },
      authorised_representative: {
        title: "إثبات الممثل المفوض",
        help: "هوية الشخص الذي يمثل الشركة وتفويضه الخطي.",
      },
      authority_to_rent: {
        title: "إثبات صلاحية التأجير",
        help: "سند أو عقد إيجار أو إدارة أو تفويض خطي من المالك.",
      },
      licensing_or_exemption: {
        title: "إثبات الترخيص أو الإعفاء",
        help: "دليل سياحي أو بلدي أو سلامة أو إعفاء مسجل.",
      },
      payout_account: {
        title: "إثبات حساب التحويل",
        help: "دليل أن حساب التسوية يعود لمقدم الطلب.",
      },
    },
    missing: {
      application: "احفظ مسودة الطلب",
      legal_name: "الاسم القانوني",
      company_name: "اسم الشركة",
      licensing_basis: "أساس الامتثال المحلي",
      exemption_basis: "أساس الإعفاء المسجل",
      cottage_name: "اسم البيت",
      governorate: "المحافظة",
      approximate_location: "المنطقة التقريبية العامة",
      exact_address: "العنوان الدقيق الخاص",
      capacity: "سعة الضيوف",
      bedrooms: "غرف النوم",
      bathrooms: "الحمّامات",
      description: "وصف البيت",
      house_rules: "قواعد البيت",
      "document:identity": "إثبات الهوية",
      "document:company_registration": "إثبات الشركة",
      "document:authorised_representative": "إثبات الممثل المفوض",
      "document:authority_to_rent": "إثبات صلاحية التأجير",
      "document:licensing_or_exemption": "إثبات الترخيص أو الإعفاء",
      "document:payout_account": "إثبات حساب التحويل",
    },
  },
  ckb: {
    eyebrow: "پەیوەستبوونی خاوەن",
    title: "داواکاری خاوەنەکەت ئامادە بکە",
    intro:
      "لە چەند سەردانێکدا پێشکەوتنەکەت پاشەکەوت بکە. یەکەم ماڵ و بەڵگەکان تا تەواوبوونی پێداچوونەوە تایبەت دەمێننەوە.",
    privacyNote:
      "بەڵگەکانی پشتڕاستکردنەوە بڵاوناکرێنەوە و وەرناگێڕدرێن. بەستەری پارێزراو دوای 60 چرکە بەسەر دەچێت و هەر دەستگەیشتنێک تۆمار دەکرێت.",
    accessRequired:
      "پێش کردنەوەی ئەم داواکارییە تایبەتە ژمارەی خاوەنی ماڵ پشتڕاست بکەرەوە.",
    verifyPhone: "دەستگەیشتنی خاوەنی ماڵ پشتڕاست بکەرەوە",
    draftStatus: "داواکاری ڕەشنووس",
    submittedStatus: "بۆ پێداچوونەوە نێردرا",
    submittedNote:
      "داواکاری تەواوت لە کاتی پێداچوونەوەدا داخراوە. هێشتا ناتوانیت ماڵ بڵاو بکەیتەوە یان داواکاری حجز وەربگریت.",
    ownerSection: "زانیارییەکانت",
    cottageSection: "یەکەم ماڵی تایبەتت",
    documentsSection: "بەڵگە تایبەتەکانی پشتڕاستکردنەوە",
    documentsIntro:
      "بۆ هەر جۆرە بەڵگەیەک PDF یان JPEG یان PNG باربکە، تا 5 مێگابایت.",
    individual: "تاک",
    company: "کۆمپانیا",
    applicantKind: "جۆری داواکار",
    legalName: "ناوی یاسایی",
    companyName: "ناوی کۆمپانیا",
    licensingBasis: "بنەمای پابەندبوونی ناوخۆیی",
    licence: "مۆڵەتی پێویست",
    exemption: "بەخشینی تۆمارکراو",
    exemptionBasis: "بنەمای بەخشینی تۆمارکراو",
    exemptionBasisHelp:
      "تەنها کاتێک پێویستە کە مۆڵەت جێبەجێ نابێت. دەسەڵات و هۆکارەکە ڕوون بکەرەوە.",
    cottageName: "ناوی ماڵ",
    governorate: "پارێزگا",
    approximateLocation: "ناوچەی گشتیی نزیکەوە",
    exactAddress: "ناونیشانی وردی تایبەت",
    exactAddressHelp:
      "تایبەت دەمێنێتەوە و لە پەڕە ئاساییەکانی ماڵ نیشان نادرێت.",
    capacity: "گنجایشی میوان",
    bedrooms: "ژووری نوستن",
    bathrooms: "حەمام",
    amenities: "خزمەتگوزارییەکان",
    amenityOptions: [
      { value: "garden", label: "باخچە" },
      { value: "parking", label: "وەستانگە" },
      { value: "pool", label: "مەڵەوانگەی تایبەت" },
      { value: "air_conditioning", label: "ساردکەرەوە" },
      { value: "wifi", label: "وای فای" },
      { value: "outdoor_seating", label: "دانیشتنی دەرەوە" },
    ],
    description: "وەسفی ماڵ",
    houseRules: "یاساکانی ماڵ",
    saveDraft: "ڕەشنووس پاشەکەوت بکە",
    saved: "ڕەشنووس پاشەکەوت کرا.",
    savedCleanupRequired:
      "ڕەشنووسەکە پاشەکەوت کرا، بەڵام بەڵگە ناپێویستەکان چاوەڕێی پاککردنەوەی پارێزراون.",
    savedDeletionAuditRequired:
      "ڕەشنووسەکە پاشەکەوت کرا و بەڵگە ناپێویستەکان سڕانەوە، بەڵام تۆماری سڕینەوەکە پێویستی بە پێداچوونەوە هەیە.",
    invalid: "خانەکانی نیشانکراو بپشکنە و دووبارە هەوڵ بدە.",
    unavailable: "ئەم کردارە کاتێکی کورت بەردەست نییە. هیچ شتێک نەنێردرا.",
    denied: "مۆڵەتت نییە بۆ دەستگەیشتن بەم بەڵگە تایبەتە.",
    submit: "داواکاری بنێرە",
    incompleteTitle: "پێش ناردن ئەم خاڵانە تەواو بکە:",
    submitted: "داواکاری نێردرا.",
    upload: "بەڵگە باربکە",
    replace: "بەڵگە بگۆڕە",
    uploaded: "بەڵگەی تایبەت پاشەکەوت کرا.",
    uploadedCleanupRequired:
      "بەڵگە نوێیەکە پاشەکەوت کرا، بەڵام فایلە کۆنەکە پێویستی بە پاککردنەوەی پارێزراو هەیە.",
    uploadedDeletionAuditRequired:
      "بەڵگە نوێیەکە پاشەکەوت کرا و فایلە کۆنەکە سڕایەوە، بەڵام تۆماری سڕینەوەکە پێویستی بە پێداچوونەوە هەیە.",
    failedCleanupRequired:
      "بارکردنەکە لە داواکارییەکەت پاشەکەوت نەکرا و فایلە تایبەتەکەی پێویستی بە پاککردنەوەی پارێزراو هەیە.",
    registrationReconciliationRequired:
      "ئەنجامی بارکردنەکە پشتڕاست نەکرایەوە. فایلە تایبەتەکە بۆ یەکخستنەوەی پارێزراو پارێزرا.",
    invalidDocument: "PDF یان JPEG یان PNG تا 5 مێگابایت هەڵبژێرە.",
    documentRules: "PDF یان JPEG یان PNG · تا 5 مێگابایت",
    saveBeforeDocuments: "پێش بارکردنی بەڵگەکان ڕەشنووسەکە پاشەکەوت بکە.",
    documentKinds: {
      identity: {
        title: "بەڵگەی ناسنامە",
        help: "پاسپۆرت، کارتی نیشتیمانی یان بەڵگەی نوێنەری ڕێپێدراو.",
      },
      company_registration: {
        title: "بەڵگەی کۆمپانیا",
        help: "بەڵگەی تۆمارکردن یان دامەزراندنی کۆمپانیای داواکار.",
      },
      authorised_representative: {
        title: "بەڵگەی نوێنەری ڕێپێدراو",
        help: "ناسنامە و ڕێپێدانی نووسراوی کەسی نوێنەرایەتی کۆمپانیا.",
      },
      authority_to_rent: {
        title: "بەڵگەی مافی بەکرێدان",
        help: "قەواڵە، گرێبەستی کرێ، بەڕێوەبردن یان ڕێپێدانی نووسراوی خاوەن.",
      },
      licensing_or_exemption: {
        title: "بەڵگەی مۆڵەت یان بەخشین",
        help: "بەڵگەی گەشتیاری، شارەوانی، سەلامەتی یان بەخشینی تۆمارکراو.",
      },
      payout_account: {
        title: "بەڵگەی هەژماری پارەدان",
        help: "بەڵگەی ئەوەی هەژماری تسویە هی داواکارە.",
      },
    },
    missing: {
      application: "ڕەشنووسی داواکارییەکە پاشەکەوت بکە",
      legal_name: "ناوی یاسایی",
      company_name: "ناوی کۆمپانیا",
      licensing_basis: "بنەمای پابەندبوونی ناوخۆیی",
      exemption_basis: "بنەمای بەخشینی تۆمارکراو",
      cottage_name: "ناوی ماڵ",
      governorate: "پارێزگا",
      approximate_location: "ناوچەی گشتیی نزیکەوە",
      exact_address: "ناونیشانی وردی تایبەت",
      capacity: "گنجایشی میوان",
      bedrooms: "ژووری نوستن",
      bathrooms: "حەمام",
      description: "وەسفی ماڵ",
      house_rules: "یاساکانی ماڵ",
      "document:identity": "بەڵگەی ناسنامە",
      "document:company_registration": "بەڵگەی کۆمپانیا",
      "document:authorised_representative": "بەڵگەی نوێنەری ڕێپێدراو",
      "document:authority_to_rent": "بەڵگەی مافی بەکرێدان",
      "document:licensing_or_exemption": "بەڵگەی مۆڵەت یان بەخشین",
      "document:payout_account": "بەڵگەی هەژماری پارەدان",
    },
  },
};
