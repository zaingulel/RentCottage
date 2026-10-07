import type { Locale } from "./routing";
import type {
  CottageProfile,
  CottageProfileStatus,
} from "@/cottage-profile/cottage-profile";

const en = {
  eyebrow: "Owner Backoffice",
  overviewTitle: "Your cottages",
  overviewIntro:
    "Complete your first Cottage Profile or prepare another private draft.",
  adminEyebrow: "Platform administration",
  adminTitle: "Private Cottage Profiles",
  adminIntro:
    "Review unpublished working copies without changing submitted owner source.",
  create: "Create another cottage draft",
  empty: "No Cottage Profiles are available.",
  open: "Open Cottage Profile",
  nextCottages: "Next Cottage Profiles",
  applicationProfile: "Started in Owner Application",
  draft: "Private draft",
  submitted: "Submitted for content approval",
  abandoned: "Abandoned",
  published: "Published",
  publishedWithUnpublishedChanges: "Published; unpublished changes",
  publishedUpdateAwaitingApproval: "Published; update awaiting approval",
  abandonedReadOnly:
    "This private Cottage Profile is abandoned and remains available as a read-only record.",
  readOnly:
    "Your private profile remains available, but changes are unavailable while this owner account is expired or suspended.",
  prospective:
    "Continue your first Cottage Profile in Owner Application until your owner account is approved.",
  ownerApplication: "Open Owner Application",
  unavailable:
    "Cottage Profiles are temporarily unavailable. Please try again.",
  accessRequired: "Verified Cottage Owner access is required.",
  ownerAccessAction: "Verify Cottage Owner access",
  adminAccessRequired: "Authenticator multi-factor access is required.",
  administratorAccessAction: "Complete administrator access",
  editorTitle: "Cottage Profile",
  completion:
    "Complete every required field and add 1–12 ready photos before submission.",
  publicDetails: "Public working-copy details",
  privateLocation: "Private arrival details",
  privateWarning:
    "Exact address, coordinates and directions stay private and are never shown in the public listing.",
  cottageName: "Cottage name",
  governorate: "Governorate",
  approximateLocation: "Approximate public location",
  approximateLocationHelp:
    "Area only, in words. Never put coordinates or the exact address here; this text is public.",
  exactAddress: "Exact private address (optional)",
  latitude: "Latitude",
  longitude: "Longitude",
  pointCheck: "Exact point check",
  pointValid:
    "Latitude {latitude} north, longitude {longitude} east. These numbers are within the supported area. No map is connected, so check them against the pin in your own maps app.",
  pointOutside:
    "These numbers are outside the supported area (latitude 29.0 to 37.4, longitude 38.7 to 49.2). Check them and try again.",
  pointReversed:
    "These numbers look reversed: the latitude box holds a longitude and the longitude box holds a latitude.",
  pointSwap: "Swap the two numbers",
  pointDecimal:
    "Enter both as decimal numbers, such as 36.408333 and 44.385834.",
  pointConfirm: "I checked this point is the cottage",
  deviceLocationUse: "Use this device's location",
  deviceLocationStatus: "Device location",
  deviceLocationFinding: "Finding this device's location…",
  deviceLocationProposed:
    "This is where this device is now, accurate to about {metres} metres. It may be your home, not the cottage. Check the numbers before confirming.",
  deviceLocationRough:
    "This reading is rough. Type the numbers from a maps app instead if you can.",
  deviceLocationDenied:
    "Location permission was refused. You can still type or paste the numbers.",
  deviceLocationUnavailable:
    "This device could not find its location. You can still type or paste the numbers.",
  deviceLocationTimedOut:
    "Finding the location took too long. Try again outdoors, or type or paste the numbers.",
  deviceLocationUnsupported:
    "This browser cannot share its location. Type or paste the numbers.",
  privateDirections: "Private directions",
  capacity: "Guest capacity",
  bedrooms: "Bedrooms",
  bathrooms: "Bathrooms",
  amenities: "Known amenities",
  garden: "Garden",
  parking: "Parking",
  pool: "Pool",
  air_conditioning: "Air conditioning",
  wifi: "Wi-Fi",
  outdoor_seating: "Outdoor seating",
  sourceContent: "Owner source content",
  sourceLanguage: "Source language",
  arabic: "Arabic",
  sorani: "Sorani Kurdish",
  english: "English",
  description: "Source description",
  houseRules: "Source House Rules",
  save: "Save private draft",
  saved: "Private draft saved.",
  conflict: "This profile changed elsewhere. Reload before saving again.",
  failed: "The change could not be completed. Please try again.",
  photos: "Private cottage photos",
  photoGuidance:
    "Add 1–12 JPEG, PNG or WebP images. Each image must be 5 MiB or smaller. HEIC is not accepted.",
  photoFile: "Choose cottage photo",
  uploadPhoto: "Upload photo",
  uploaded: "Photo uploaded.",
  deleted: "Photo deleted.",
  pending: "Upload reconciliation pending",
  ready: "Ready",
  deletionPending: "Deletion reconciliation pending",
  preview: "Create private preview",
  previewDenied: "You are not allowed to preview this private photo.",
  previewUnavailable:
    "The private photo preview is temporarily unavailable. Please try again.",
  deletePhoto: "Delete photo",
  createDenied: "This owner account cannot create another cottage draft.",
  capacityLimit: "You can have up to 20 open unpublished Cottage Profiles.",
  rateLimit: "You can create up to 20 additional Cottage Profiles in 24 hours.",
  abandon: "Abandon draft",
  restore: "Restore draft",
  lifecycleReason: "Administrator reason",
  abandonedSuccess: "Cottage Profile abandoned.",
  restoredSuccess: "Cottage Profile restored.",
  submit: "Submit for content approval",
  submittedSuccess: "Cottage Profile submitted.",
  incomplete:
    "Complete every required field and make sure 1–12 photos are ready before submitting.",
  sourceRevision: "Preserved submitted owner source",
  revision: "Revision",
  sourceNotice:
    "Administrator working-copy edits do not change this submitted source.",
} as const;

type Copy = { [Key in keyof typeof en]: string };

const ar: Copy = {
  eyebrow: "مكتب مالك الكوخ",
  overviewTitle: "أكواخك",
  overviewIntro: "أكمل ملف الكوخ الأول أو جهّز مسودة خاصة أخرى.",
  adminEyebrow: "إدارة المنصة",
  adminTitle: "ملفات الأكواخ الخاصة",
  adminIntro: "راجع نسخ العمل غير المنشورة من دون تغيير مصدر المالك المرسل.",
  create: "إنشاء مسودة كوخ أخرى",
  empty: "لا توجد ملفات أكواخ متاحة.",
  open: "فتح ملف الكوخ",
  nextCottages: "ملفات الأكواخ التالية",
  applicationProfile: "بدأ في طلب المالك",
  draft: "مسودة خاصة",
  submitted: "مُرسل للموافقة على المحتوى",
  abandoned: "متروك",
  published: "منشور",
  publishedWithUnpublishedChanges: "منشور؛ تعديلات غير منشورة",
  publishedUpdateAwaitingApproval: "منشور؛ التحديث بانتظار الموافقة",
  abandonedReadOnly: "ملف الكوخ الخاص هذا متروك ويبقى متاحاً كسجل للقراءة فقط.",
  readOnly:
    "يبقى ملفك الخاص متاحاً، لكن التغييرات غير متاحة أثناء انتهاء أو تعليق حساب المالك.",
  prospective:
    "تابع ملف الكوخ الأول في طلب المالك إلى أن تتم الموافقة على حسابك.",
  ownerApplication: "فتح طلب المالك",
  unavailable: "ملفات الأكواخ غير متاحة مؤقتاً. حاول مرة أخرى.",
  accessRequired: "يلزم دخول مالك كوخ موثّق.",
  ownerAccessAction: "تحقق من دخول مالك الكوخ",
  adminAccessRequired: "يلزم دخول متعدد العوامل عبر تطبيق المصادقة.",
  administratorAccessAction: "أكمل دخول المسؤول",
  editorTitle: "ملف الكوخ",
  completion:
    "أكمل جميع الحقول المطلوبة وأضف من 1 إلى 12 صورة جاهزة قبل الإرسال.",
  publicDetails: "تفاصيل نسخة العمل العامة",
  privateLocation: "تفاصيل الوصول الخاصة",
  privateWarning:
    "يبقى العنوان الدقيق والإحداثيات والاتجاهات خاصة ولا تظهر أبداً في الإعلان العام.",
  cottageName: "اسم الكوخ",
  governorate: "المحافظة",
  approximateLocation: "الموقع العام التقريبي",
  approximateLocationHelp:
    "المنطقة فقط، بالكلمات. لا تضع الإحداثيات أو العنوان الدقيق هنا؛ هذا النص عام.",
  exactAddress: "العنوان الخاص الدقيق (اختياري)",
  latitude: "خط العرض",
  longitude: "خط الطول",
  pointCheck: "التحقق من النقطة الدقيقة",
  pointValid:
    "خط العرض {latitude} شمالاً، خط الطول {longitude} شرقاً. هذه الأرقام ضمن المنطقة المدعومة. لا توجد خريطة متصلة، لذا طابقها مع الدبوس في تطبيق الخرائط لديك.",
  pointOutside:
    "هذه الأرقام خارج المنطقة المدعومة (خط العرض من 29.0 إلى 37.4، وخط الطول من 38.7 إلى 49.2). تحقق منها وحاول مرة أخرى.",
  pointReversed:
    "يبدو أن الرقمين معكوسان: خانة خط العرض تحتوي على خط طول وخانة خط الطول تحتوي على خط عرض.",
  pointSwap: "تبديل الرقمين",
  pointDecimal: "أدخل الرقمين بصيغة عشرية، مثل 36.408333 و 44.385834.",
  pointConfirm: "تحققت من أن هذه النقطة هي الكوخ",
  deviceLocationUse: "استخدم موقع هذا الجهاز",
  deviceLocationStatus: "موقع الجهاز",
  deviceLocationFinding: "جارٍ تحديد موقع هذا الجهاز…",
  deviceLocationProposed:
    "هذا هو مكان هذا الجهاز الآن، بدقة تقارب {metres} متراً. قد يكون منزلك وليس الكوخ. تحقق من الأرقام قبل التأكيد.",
  deviceLocationRough:
    "هذه القراءة تقريبية. إن أمكن، اكتب الأرقام من تطبيق خرائط بدلاً من ذلك.",
  deviceLocationDenied:
    "رُفض إذن الموقع. ما زال بإمكانك كتابة الأرقام أو لصقها.",
  deviceLocationUnavailable:
    "تعذّر على هذا الجهاز تحديد موقعه. ما زال بإمكانك كتابة الأرقام أو لصقها.",
  deviceLocationTimedOut:
    "استغرق تحديد الموقع وقتاً طويلاً. حاول مرة أخرى في مكان مفتوح، أو اكتب الأرقام أو الصقها.",
  deviceLocationUnsupported:
    "لا يستطيع هذا المتصفح مشاركة موقعه. اكتب الأرقام أو الصقها.",
  privateDirections: "اتجاهات الوصول الخاصة",
  capacity: "سعة الضيوف",
  bedrooms: "غرف النوم",
  bathrooms: "الحمامات",
  amenities: "المرافق المعروفة",
  garden: "حديقة",
  parking: "موقف سيارات",
  pool: "مسبح",
  air_conditioning: "تكييف",
  wifi: "واي فاي",
  outdoor_seating: "جلسة خارجية",
  sourceContent: "محتوى المالك الأصلي",
  sourceLanguage: "لغة المصدر",
  arabic: "العربية",
  sorani: "الكردية السورانية",
  english: "الإنجليزية",
  description: "وصف المصدر",
  houseRules: "قواعد المنزل الأصلية",
  save: "حفظ المسودة الخاصة",
  saved: "تم حفظ المسودة الخاصة.",
  conflict: "تغيّر هذا الملف في مكان آخر. أعد التحميل قبل الحفظ.",
  failed: "تعذر إكمال التغيير. حاول مرة أخرى.",
  photos: "صور الكوخ الخاصة",
  photoGuidance:
    "أضف من 1 إلى 12 صورة JPEG أو PNG أو WebP. الحد الأقصى لكل صورة 5 ميبيبايت. صيغة HEIC غير مقبولة.",
  photoFile: "اختيار صورة للكوخ",
  uploadPhoto: "رفع الصورة",
  uploaded: "تم رفع الصورة.",
  deleted: "تم حذف الصورة.",
  pending: "تسوية الرفع معلّقة",
  ready: "جاهزة",
  deletionPending: "تسوية الحذف معلّقة",
  preview: "إنشاء معاينة خاصة",
  previewDenied: "لا يُسمح لك بمعاينة هذه الصورة الخاصة.",
  previewUnavailable: "معاينة الصورة الخاصة غير متاحة مؤقتاً. حاول مرة أخرى.",
  deletePhoto: "حذف الصورة",
  createDenied: "لا يمكن لحساب المالك هذا إنشاء مسودة كوخ أخرى.",
  capacityLimit: "يمكن أن يكون لديك حتى 20 ملف كوخ مفتوحاً وغير منشور.",
  rateLimit: "يمكنك إنشاء حتى 20 ملف كوخ إضافياً خلال 24 ساعة.",
  abandon: "ترك المسودة",
  restore: "استعادة المسودة",
  lifecycleReason: "سبب المسؤول",
  abandonedSuccess: "تم ترك ملف الكوخ.",
  restoredSuccess: "تمت استعادة ملف الكوخ.",
  submit: "الإرسال للموافقة على المحتوى",
  submittedSuccess: "تم إرسال ملف الكوخ.",
  incomplete:
    "أكمل كل الحقول المطلوبة وتأكد من جاهزية 1 إلى 12 صورة قبل الإرسال.",
  sourceRevision: "مصدر المالك المرسل والمحفوظ",
  revision: "النسخة",
  sourceNotice: "تعديلات نسخة عمل المسؤول لا تغيّر هذا المصدر المرسل.",
};

const ckb: Copy = {
  eyebrow: "بەشی بەڕێوەبردنی خاوەن کۆتێج",
  overviewTitle: "کۆتێجەکانت",
  overviewIntro:
    "پرۆفایلی یەکەمی کۆتێج تەواو بکە یان ڕەشنووسێکی تایبەتی تر ئامادە بکە.",
  adminEyebrow: "بەڕێوەبردنی پلاتفۆرم",
  adminTitle: "پرۆفایلە تایبەتەکانی کۆتێج",
  adminIntro:
    "کۆپی کارکردنی بڵاونەکراوە بپشکنە بەبێ گۆڕینی سەرچاوەی نێردراوی خاوەن.",
  create: "دروستکردنی ڕەشنووسی کۆتێجێکی تر",
  empty: "هیچ پرۆفایلێکی کۆتێج بەردەست نییە.",
  open: "کردنەوەی پرۆفایلی کۆتێج",
  nextCottages: "پرۆفایلەکانی دواتری کۆتێج",
  applicationProfile: "لە داواکاری خاوەن دەستی پێکردووە",
  draft: "ڕەشنووسی تایبەت",
  submitted: "نێردراوە بۆ پەسەندکردنی ناوەڕۆک",
  abandoned: "وازهێنراو",
  published: "بڵاوکراوەتەوە",
  publishedWithUnpublishedChanges: "بڵاوکراوەتەوە؛ گۆڕانکاریی بڵاونەکراوە هەیە",
  publishedUpdateAwaitingApproval:
    "بڵاوکراوەتەوە؛ نوێکردنەوەکە چاوەڕێی پەسەندکردنە",
  abandonedReadOnly:
    "ئەم پرۆفایلە تایبەتەی کۆتێج وازهێنراوە و وەک تۆمارێکی تەنها خوێندنەوە بەردەست دەمێنێتەوە.",
  readOnly:
    "پرۆفایلە تایبەتەکەت بەردەست دەمێنێتەوە، بەڵام لە کاتی بەسەرچوون یان هەڵپەساردنی هەژماردا گۆڕانکاری بەردەست نییە.",
  prospective:
    "تا پەسەندکردنی هەژمارەکەت، پرۆفایلی یەکەم لە داواکاری خاوەن بەردەوام بکە.",
  ownerApplication: "کردنەوەی داواکاری خاوەن",
  unavailable: "پرۆفایلەکان بە شێوەیەکی کاتی بەردەست نین. دووبارە هەوڵ بدە.",
  accessRequired: "دەستگەیشتنی خاوەن کۆتێجی پشتڕاستکراو پێویستە.",
  ownerAccessAction: "دەستگەیشتنی خاوەن کۆتێج پشتڕاست بکەرەوە",
  adminAccessRequired: "دەستگەیشتنی دوو-هەنگاوی ئەدمین پێویستە.",
  administratorAccessAction: "دەستگەیشتنی ئەدمین تەواو بکە",
  editorTitle: "پرۆفایلی کۆتێج",
  completion:
    "هەموو خانە پێویستەکان پڕ بکەوە و 1 تا 12 وێنەی ئامادە زیاد بکە پێش ناردن.",
  publicDetails: "وردەکارییە گشتییەکانی کۆپی کار",
  privateLocation: "وردەکارییە تایبەتەکانی گەیشتن",
  privateWarning:
    "ناونیشانی ورد، کۆئۆردینات و ڕێنماییەکان تایبەت دەمێننەوە و هەرگیز لە لیستی گشتی پیشان نادرێن.",
  cottageName: "ناوی کۆتێج",
  governorate: "پارێزگا",
  approximateLocation: "شوێنی گشتی نزیکەیی",
  approximateLocationHelp:
    "تەنها ناوچە، بە وشە. هەرگیز کۆئۆردینات یان ناونیشانی ورد لێرە مەنووسە؛ ئەم دەقە گشتییە.",
  exactAddress: "ناونیشانی وردی تایبەت (ئارەزوومەندانە)",
  latitude: "پانی جوگرافی",
  longitude: "درێژی جوگرافی",
  pointCheck: "پشکنینی خاڵی ورد",
  pointValid:
    "پانی جوگرافی {latitude} باکوور، درێژی جوگرافی {longitude} ڕۆژهەڵات. ئەم ژمارانە لە ناو ناوچەی پشتگیریکراودان. هیچ نەخشەیەک نەبەستراوەتەوە، بۆیە لەگەڵ نیشانەکەی ناو ئەپی نەخشەکەت بەراوردیان بکە.",
  pointOutside:
    "ئەم ژمارانە لە دەرەوەی ناوچەی پشتگیریکراون (پانی جوگرافی لە 29.0 تا 37.4، درێژی جوگرافی لە 38.7 تا 49.2). پشکنینیان بکە و دووبارە هەوڵ بدەوە.",
  pointReversed:
    "وا دیارە دوو ژمارەکە پێچەوانەن: خانەی پانی جوگرافی درێژی جوگرافی تێدایە و خانەی درێژی جوگرافی پانی جوگرافی تێدایە.",
  pointSwap: "گۆڕینەوەی دوو ژمارەکە",
  pointDecimal:
    "هەردوو ژمارەکە بە شێوەی دەیی بنووسە، وەک 36.408333 و 44.385834.",
  pointConfirm: "پشکنیم کە ئەم خاڵە کۆتێجەکەیە",
  deviceLocationUse: "شوێنی ئەم ئامێرە بەکاربهێنە",
  deviceLocationStatus: "شوێنی ئامێر",
  deviceLocationFinding: "شوێنی ئەم ئامێرە دەدۆزرێتەوە…",
  deviceLocationProposed:
    "ئەمە ئەو شوێنەیە کە ئەم ئامێرە ئێستا لێیەتی، بە وردیی نزیکەی {metres} مەتر. لەوانەیە ماڵەکەت بێت، نەک کۆتێجەکە. پێش پشتڕاستکردنەوە ژمارەکان بپشکنە.",
  deviceLocationRough:
    "ئەم خوێندنەوەیە نزیکەییە. ئەگەر دەتوانیت، لەبری ئەوە ژمارەکان لە ئەپێکی نەخشەوە بنووسە.",
  deviceLocationDenied:
    "مۆڵەتی شوێن ڕەتکرایەوە. هێشتا دەتوانیت ژمارەکان بنووسیت یان بیانلکێنیت.",
  deviceLocationUnavailable:
    "ئەم ئامێرە نەیتوانی شوێنەکەی بدۆزێتەوە. هێشتا دەتوانیت ژمارەکان بنووسیت یان بیانلکێنیت.",
  deviceLocationTimedOut:
    "دۆزینەوەی شوێنەکە زۆری خایاند. لە دەرەوە دووبارە هەوڵ بدەوە، یان ژمارەکان بنووسە یان بیانلکێنە.",
  deviceLocationUnsupported:
    "ئەم وێبگەڕە ناتوانێت شوێنەکەی هاوبەش بکات. ژمارەکان بنووسە یان بیانلکێنە.",
  privateDirections: "ڕێنمایی تایبەتی گەیشتن",
  capacity: "ژمارەی میوان",
  bedrooms: "ژووری نوستن",
  bathrooms: "حەمام",
  amenities: "خزمەتگوزارییە ناسراوەکان",
  garden: "باخچە",
  parking: "وەستانگە",
  pool: "مەلەوانگە",
  air_conditioning: "ساردکەرەوە",
  wifi: "وایفای",
  outdoor_seating: "دانیشتنی دەرەوە",
  sourceContent: "ناوەڕۆکی سەرچاوەی خاوەن",
  sourceLanguage: "زمانی سەرچاوە",
  arabic: "عەرەبی",
  sorani: "کوردی سۆرانی",
  english: "ئینگلیزی",
  description: "وەسفی سەرچاوە",
  houseRules: "یاساکانی ماڵی سەرچاوە",
  save: "پاشەکەوتکردنی ڕەشنووسی تایبەت",
  saved: "ڕەشنووسی تایبەت پاشەکەوت کرا.",
  conflict: "ئەم پرۆفایلە لە شوێنێکی تر گۆڕاوە. پێش پاشەکەوتکردن نوێی بکەرەوە.",
  failed: "گۆڕانکاری تەواو نەکرا. دووبارە هەوڵ بدە.",
  photos: "وێنە تایبەتەکانی کۆتێج",
  photoGuidance:
    "1 تا 12 وێنەی JPEG، PNG یان WebP زیاد بکە. هەر وێنەیەک نابێت لە 5 MiB زیاتر بێت. HEIC وەرناگیرێت.",
  photoFile: "هەڵبژاردنی وێنەی کۆتێج",
  uploadPhoto: "بارکردنی وێنە",
  uploaded: "وێنە بارکرا.",
  deleted: "وێنە سڕایەوە.",
  pending: "هاوتاکردنەوەی بارکردن چاوەڕێیە",
  ready: "ئامادەیە",
  deletionPending: "هاوتاکردنەوەی سڕینەوە چاوەڕێیە",
  preview: "دروستکردنی پێشبینینی تایبەت",
  previewDenied: "ڕێگەپێدراو نییت ئەم وێنە تایبەتە پێشبینین بکەیت.",
  previewUnavailable:
    "پێشبینینی وێنە تایبەتەکە بە شێوەیەکی کاتی بەردەست نییە. دووبارە هەوڵ بدە.",
  deletePhoto: "سڕینەوەی وێنە",
  createDenied: "ئەم هەژماری خاوەنە ناتوانێت ڕەشنووسێکی کۆتێجی تر دروست بکات.",
  capacityLimit: "دەتوانیت تا 20 پرۆفایلی کراوە و بڵاونەکراوەی کۆتێجت هەبێت.",
  rateLimit:
    "دەتوانیت لە ماوەی 24 کاتژمێردا تا 20 پرۆفایلی زیادەی کۆتێج دروست بکەیت.",
  abandon: "وازهێنان لە ڕەشنووس",
  restore: "گەڕاندنەوەی ڕەشنووس",
  lifecycleReason: "هۆکاری بەڕێوەبەر",
  abandonedSuccess: "لە پرۆفایلی کۆتێج وازهێنرا.",
  restoredSuccess: "پرۆفایلی کۆتێج گەڕێندرایەوە.",
  submit: "ناردن بۆ پەسەندکردنی ناوەڕۆک",
  submittedSuccess: "پرۆفایلی کۆتێج نێردرا.",
  incomplete: "هەموو خانە پێویستەکان پڕ بکەوە و دڵنیابە 1 تا 12 وێنە ئامادەن.",
  sourceRevision: "سەرچاوەی نێردراو و پارێزراوی خاوەن",
  revision: "وەشان",
  sourceNotice: "دەستکاری کۆپی کاری ئەدمین ئەم سەرچاوە نێردراوە ناگۆڕێت.",
};

export const cottageProfileMessages: Record<Locale, Copy> = { en, ar, ckb };

const cottageProfileStatusMessageKeys = {
  draft: "draft",
  submitted_for_content_approval: "submitted",
  abandoned: "abandoned",
} as const satisfies Record<CottageProfileStatus, keyof Copy>;

export function cottageProfileStatusLabel(
  locale: Locale,
  profile: Pick<
    CottageProfile,
    "status" | "currentPublicationId" | "hasUnpublishedContentChange"
  >,
): string {
  const copy = cottageProfileMessages[locale];
  if (profile.status === "abandoned" || profile.currentPublicationId === null)
    return copy[cottageProfileStatusMessageKeys[profile.status]];
  if (profile.status === "submitted_for_content_approval")
    return copy.publishedUpdateAwaitingApproval;
  return profile.hasUnpublishedContentChange
    ? copy.publishedWithUnpublishedChanges
    : copy.published;
}
