import type { Locale } from "./routing";

export const accessMessages: Record<
  Locale,
  {
    account: string;
    accountNavigation: string;
    menu: string;
    signInAccount: string;
    accessTitle: string;
    accessIntro: string;
    myBookings: string;
    backToBookings: string;
    messages: string;
    ownerBookings: string;
    ownerBookingsTab: string;
    ownerEarningsTab: string;
    ownerReviewsTab: string;
    bookingHistoryEmpty: string;
    listCottage: string;
    manageCottages: string;
    ownerCottagesTab: string;
    signOut: string;
    enrollTitle: string;
    enrollIntro: string;
    enroll: string;
    expiredCode: string;
    rateLimited: string;
    resend: string;
    editNumber: string;
    bookingHistoryIntro: string;
    denied: string;
    sessionUnavailable: string;
    retry: string;
    verified: string;
    phone: string;
    phoneHint: string;
    sendCode: string;
    code: string;
    verify: string;
    invalidPhone: string;
    invalidCode: string;
    unavailable: string;
    ownerApplicationCta: string;
    administratorTitle: string;
    email: string;
    password: string;
    signIn: string;
    mfaCode: string;
    mfaSetup: string;
    mfaQrAlt: string;
    mfaChallenge: string;
    administratorReady: string;
    reviewApplications: string;
    manageCottageProfiles: string;
    invalidSignIn: string;
    personalInformation: string;
    accountNameIntro: string;
    firstName: string;
    save: string;
    accountNameSaved: string;
    invalidFirstName: string;
    accountNameUnavailable: string;
    home: string;
    accountNameStepTitle: string;
    saveAndContinue: string;
  }
> = {
  ar: {
    account: "الحساب",
    accountNavigation: "الحساب والدعم",
    menu: "القائمة",
    signInAccount: "تسجيل الدخول",
    accessTitle: "سجّل الدخول أو أنشئ حسابًا",
    accessIntro:
      "تحقق من هاتفك للعودة إلى حجوزاتك. يُنشأ حساب للأرقام الجديدة.",
    myBookings: "حجوزاتي",
    backToBookings: "العودة إلى الحجوزات",
    messages: "الرسائل",
    ownerBookings: "حجوزات أكواخي",
    ownerBookingsTab: "حجوزات أكواخي",
    ownerEarningsTab: "الأرباح",
    ownerReviewsTab: "التقييمات",
    bookingHistoryEmpty: "لا توجد طلبات حجز بعد.",
    listCottage: "أدرج كوخك",
    manageCottages: "إدارة أكواخي",
    ownerCottagesTab: "إدارة أكواخي",
    signOut: "تسجيل الخروج",
    enrollTitle: "انضم كمالك كوخ",
    enrollIntro:
      "استخدم الحساب نفسه للحجز وإدارة الأكواخ. ابدأ طلب مالك خاصًا؛ يلزم الحصول على الموافقة قبل نشر كوخك.",
    enroll: "ابدأ طلب الانضمام كمالك",
    expiredCode:
      "انتهت صلاحية الرمز أو أنه غير صحيح. اطلب رمزًا آخر أو تحقق من الرقم.",
    rateLimited: "محاولات كثيرة. انتظر قليلًا قبل المحاولة مجددًا.",
    resend: "أرسل رمزًا آخر",
    editNumber: "تغيير رقم الهاتف",
    bookingHistoryIntro:
      "تظهر هنا جميع طلبات الحجز ونتائج الحجوزات، وتفتح كل خانة التفاصيل المحفوظة المسموح بها.",
    denied: "هذا الحجز غير متاح لهذا الحساب. سجّل الخروج لاستخدام حساب آخر.",
    sessionUnavailable: "الوصول إلى الحساب غير متاح. يرجى المحاولة مجددًا.",
    retry: "حاول مجددًا",
    verified: "تم التحقق من الهاتف. تم تسجيل دخولك.",
    phone: "رقم الهاتف العراقي",
    phoneHint: "اكتب الرقم بصيغة",
    sendCode: "أرسل رمز التحقق",
    code: "رمز التحقق",
    verify: "تحقق",
    invalidPhone: "أدخل رقمًا عراقيًا صحيحًا يبدأ بـ +964.",
    invalidCode: "تعذر التحقق من الرمز.",
    unavailable: "التحقق غير متاح الآن. حاول مرة أخرى.",
    ownerApplicationCta: "تابع إلى طلب الانضمام كمالك",
    administratorTitle: "دخول مسؤول المنصة",
    email: "البريد الإلكتروني",
    password: "كلمة المرور",
    signIn: "متابعة",
    mfaCode: "رمز تطبيق المصادقة",
    mfaSetup: "امسح الرمز في تطبيق المصادقة ثم أدخل الرمز.",
    mfaQrAlt: "رمز إعداد تطبيق المصادقة",
    mfaChallenge: "أدخل الرمز من تطبيق المصادقة.",
    administratorReady: "تم التحقق متعدد العوامل. صلاحية المسؤول جاهزة.",
    reviewApplications: "راجع طلبات المالك المرسلة",
    manageCottageProfiles: "إدارة ملفات الأكواخ",
    invalidSignIn: "بيانات الدخول غير صحيحة أو الحساب ليس لمسؤول.",
    personalInformation: "المعلومات الشخصية",
    accountNameIntro:
      "لا يرى اسمك الأول أحد غيرك. يظهر أول حرف منه على زر حسابك.",
    firstName: "الاسم الأول",
    save: "احفظ",
    accountNameSaved: "تم حفظ اسمك الأول.",
    invalidFirstName:
      "أدخل اسمًا أول من 1 إلى 50 حرفًا يتضمن حرفًا واحدًا على الأقل، من دون رقم هاتف أو بريد إلكتروني أو رابط أو رمز تحكم مثل مسافة الجدولة.",
    accountNameUnavailable: "تعذّر حفظ اسمك الأول. حاول مرة أخرى.",
    home: "الصفحة الرئيسية لـ RentCottage",
    accountNameStepTitle: "أضف اسمك الأول",
    saveAndContinue: "احفظ وتابع",
  },
  ckb: {
    account: "هەژمار",
    accountNavigation: "هەژمار و پشتیوانی",
    menu: "پێڕست",
    signInAccount: "چوونەژوورەوە",
    accessTitle: "بچۆ ژوورەوە یان هەژمارێک دروست بکە",
    accessIntro:
      "ژمارەکەت پشتڕاست بکەرەوە بۆ گەڕانەوە بۆ حجزەکانت. بۆ ژمارەی نوێ هەژمار دروست دەکرێت.",
    myBookings: "حجزەکانم",
    backToBookings: "گەڕانەوە بۆ حجزەکان",
    messages: "نامەکان",
    ownerBookings: "حجزەکانی کۆتێجەکانم",
    ownerBookingsTab: "حجزەکانی کۆتێجەکانم",
    ownerEarningsTab: "داهات",
    ownerReviewsTab: "هەڵسەنگاندنەکان",
    bookingHistoryEmpty: "هێشتا هیچ داواکارییەکی حجز نییە.",
    listCottage: "کۆتێجەکەت تۆمار بکە",
    manageCottages: "بەڕێوەبردنی کۆتێجەکانم",
    ownerCottagesTab: "بەڕێوەبردنی کۆتێجەکانم",
    signOut: "چوونەدەرەوە",
    enrollTitle: "ببە خاوەنی کۆتێج",
    enrollIntro:
      "هەمان هەژمار بۆ حجزکردن و بەڕێوەبردنی کۆتێج بەکاربهێنە. داواکارییەکی تایبەتی خاوەن دەست پێ بکە؛ پەسەندکردن پێویستە پێش بڵاوکردنەوەی کۆتێجەکەت.",
    enroll: "داواکاری خاوەن دەست پێ بکە",
    expiredCode:
      "کۆدەکە بەسەرچووە یان نادروستە. کۆدێکی تر داوا بکە یان ژمارەکە بپشکنە.",
    rateLimited: "هەوڵدان زۆرە. کەمێک چاوەڕێ بکە پێش هەوڵدانەوە.",
    resend: "کۆدێکی تر بنێرە",
    editNumber: "گۆڕینی ژمارەی تەلەفۆن",
    bookingHistoryIntro:
      "هەموو داواکارییەکانی حجز و ئەنجامەکانیان لێرە دەردەکەون؛ هەر دانەیەک وردەکارییە پارێزراوە ڕێپێدراوەکان دەکاتەوە.",
    denied:
      "ئەم حجزە بۆ ئەم هەژمارە بەردەست نییە. بچۆ دەرەوە بۆ بەکارهێنانی هەژمارێکی تر.",
    sessionUnavailable:
      "دەستگەیشتن بە هەژمار بەردەست نییە. تکایە دووبارە هەوڵ بدەوە.",
    retry: "دووبارە هەوڵ بدەوە",
    verified: "تەلەفۆن پشتڕاست کرایەوە. چوویتە ژوورەوە.",
    phone: "ژمارە تەلەفۆنی عێراقی",
    phoneHint: "ژمارەکە بەم شێوەیە بنووسە:",
    sendCode: "کۆدی پشتڕاستکردنەوە بنێرە",
    code: "کۆدی پشتڕاستکردنەوە",
    verify: "پشتڕاست بکەرەوە",
    invalidPhone: "ژمارەیەکی دروستی عێراقی بنووسە کە بە +964 دەست پێ بکات.",
    invalidCode: "کۆدەکە پشتڕاست نەکرایەوە.",
    unavailable: "پشتڕاستکردنەوە ئێستا بەردەست نییە. دووبارە هەوڵ بدەوە.",
    ownerApplicationCta: "بەردەوام بە بۆ داواکاری خاوەن",
    administratorTitle: "چوونەژوورەوەی بەڕێوەبەری پلاتفۆرم",
    email: "ئیمەیڵ",
    password: "وشەی نهێنی",
    signIn: "بەردەوام بە",
    mfaCode: "کۆدی ئەپی پشتڕاستکەرەوە",
    mfaSetup: "کۆدەکە بە ئەپی پشتڕاستکەرەوە سکان بکە و کۆدەکە بنووسە.",
    mfaQrAlt: "کۆدی ڕێکخستنی ئەپی پشتڕاستکەرەوە",
    mfaChallenge: "کۆدی ئەپی پشتڕاستکەرەوە بنووسە.",
    administratorReady:
      "پشتڕاستکردنەوەی دوو هەنگاو تەواو بوو. دەستگەیشتنی بەڕێوەبەر ئامادەیە.",
    reviewApplications: "داواکارییە نێردراوەکانی خاوەن بپشکنە",
    manageCottageProfiles: "پرۆفایلەکانی کۆتێج بەڕێوەببە",
    invalidSignIn:
      "زانیاری چوونەژوورەوە نادروستە یان هەژمارەکە بەڕێوەبەر نییە.",
    personalInformation: "زانیاریی کەسی",
    accountNameIntro:
      "تەنها خۆت ناوی یەکەمت دەبینیت. یەکەم پیتی لەسەر دوگمەی هەژمارەکەت دەردەکەوێت.",
    firstName: "ناوی یەکەم",
    save: "پاشەکەوت بکە",
    accountNameSaved: "ناوی یەکەمت پاشەکەوت کرا.",
    invalidFirstName:
      "ناوێکی یەکەم بنووسە لە ١ تا ٥٠ پیت کە لانیکەم یەک پیتی تێدابێت، بەبێ ژمارەی تەلەفۆن، ئیمەیڵ، بەستەر یان هێمای کۆنترۆڵ وەک تاب.",
    accountNameUnavailable:
      "نەتوانرا ناوی یەکەمت پاشەکەوت بکرێت. دووبارە هەوڵ بدەرەوە.",
    home: "پەڕەی سەرەکیی RentCottage",
    accountNameStepTitle: "ناوی یەکەمت زیاد بکە",
    saveAndContinue: "پاشەکەوت بکە و بەردەوام بە",
  },
  en: {
    account: "Account",
    accountNavigation: "Account and support",
    menu: "Menu",
    signInAccount: "Sign in",
    accessTitle: "Sign in or create an account",
    accessIntro:
      "Verify your phone to return to your bookings. New numbers create an account.",
    myBookings: "My bookings",
    backToBookings: "Back to bookings",
    messages: "Messages",
    ownerBookings: "Bookings for my cottages",
    ownerBookingsTab: "Bookings",
    ownerEarningsTab: "Earnings",
    ownerReviewsTab: "Reviews",
    bookingHistoryEmpty: "No booking requests yet.",
    listCottage: "List your cottage",
    manageCottages: "Manage my cottages",
    ownerCottagesTab: "My cottages",
    signOut: "Sign out",
    enrollTitle: "Become a Cottage Owner",
    enrollIntro:
      "Use this same account to book and manage cottages. Start a private owner application; approval is required before your cottage can be published.",
    enroll: "Start owner application",
    expiredCode:
      "The code has expired or is invalid. Request another code or check the number.",
    rateLimited: "Too many attempts. Wait a little before trying again.",
    resend: "Send another code",
    editNumber: "Change phone number",
    bookingHistoryIntro:
      "Every booking request and booking outcome appears here. Each entry opens its authorised preserved details.",
    denied:
      "This booking is not available to this account. Sign out to use another account.",
    sessionUnavailable: "Account access is unavailable. Please try again.",
    retry: "Try again",
    verified: "Phone verified. You are signed in.",
    phone: "Iraqi phone number",
    phoneHint: "Use the format",
    sendCode: "Send verification code",
    code: "Verification code",
    verify: "Verify",
    invalidPhone: "Enter a valid Iraqi number beginning +964.",
    invalidCode: "The verification code could not be confirmed.",
    unavailable: "Verification is unavailable. Try again.",
    ownerApplicationCta: "Continue to Owner Application",
    administratorTitle: "Platform Administrator access",
    email: "Email",
    password: "Password",
    signIn: "Continue",
    mfaCode: "Authenticator app code",
    mfaSetup: "Scan this code in your authenticator app, then enter its code.",
    mfaQrAlt: "Authenticator app setup code",
    mfaChallenge: "Enter the code from your authenticator app.",
    administratorReady:
      "Multi-factor verification complete. Administrator access is ready.",
    reviewApplications: "Review submitted Owner Applications",
    manageCottageProfiles: "Manage Cottage Profiles",
    invalidSignIn:
      "The sign-in is invalid or this is not an administrator account.",
    personalInformation: "Personal information",
    accountNameIntro:
      "Only you can see your first name. Its first letter shows on your account button.",
    firstName: "First name",
    save: "Save",
    accountNameSaved: "Your first name is saved.",
    invalidFirstName:
      "Enter a first name of 1 to 50 characters that includes a letter and no phone number, email address, link or control character such as a tab.",
    accountNameUnavailable: "Your first name could not be saved. Try again.",
    home: "RentCottage home",
    accountNameStepTitle: "Add your first name",
    saveAndContinue: "Save and continue",
  },
};

export const hostedDemoAccessMessages: Record<
  Locale,
  Pick<
    (typeof accessMessages)[Locale],
    | "accessTitle"
    | "accessIntro"
    | "phone"
    | "phoneHint"
    | "sendCode"
    | "code"
    | "verify"
    | "resend"
    | "invalidCode"
    | "expiredCode"
    | "verified"
    | "invalidPhone"
    | "editNumber"
  > & { codeHint: string; notice: string }
> = {
  en: {
    accessTitle: "Invited demo access",
    accessIntro:
      "Sign into your invited synthetic identity using a simulated phone code.",
    phone: "Invited demo number",
    phoneHint:
      "Use the synthetic number supplied privately with your invitation.",
    sendCode: "Use simulated code",
    code: "Simulated invitation code",
    codeHint: "Use your private invitation code. No text message is sent.",
    verify: "Continue demo",
    resend: "Use simulated code again",
    invalidCode: "The simulated invitation code is invalid.",
    expiredCode:
      "The simulated invitation code expired. Ask for a renewed invitation.",
    verified:
      "Signed into the synthetic demo identity. Phone verification is simulated.",
    invalidPhone: "Enter the synthetic number supplied with your invitation.",
    editNumber: "Change demo number",
    notice:
      "Invited synthetic demo. Phone identity and verification are simulated. Real suppliers are unavailable.",
  },
  ar: {
    accessTitle: "دخول العرض بالدعوة",
    accessIntro: "ادخل بهويتك الاصطناعية المدعوة باستخدام رمز هاتف محاكى.",
    phone: "رقم العرض المدعو",
    phoneHint: "استخدم الرقم الاصطناعي المقدم لك بشكل خاص مع دعوتك.",
    sendCode: "استخدم الرمز المحاكى",
    code: "رمز الدعوة المحاكى",
    codeHint: "استخدم رمز دعوتك الخاص. لا تُرسل رسالة نصية.",
    verify: "تابع العرض",
    resend: "استخدم الرمز المحاكى مجددًا",
    invalidCode: "رمز الدعوة المحاكى غير صحيح.",
    expiredCode: "انتهت صلاحية رمز الدعوة المحاكى. اطلب تجديد الدعوة.",
    verified: "تم الدخول بهوية عرض اصطناعية. التحقق من الهاتف محاكاة.",
    invalidPhone: "أدخل الرقم الاصطناعي المقدم مع دعوتك.",
    editNumber: "غيّر رقم العرض",
    notice:
      "عرض اصطناعي بالدعوة. هوية الهاتف والتحقق منه محاكاة. الموردون الحقيقيون غير متاحين.",
  },
  ckb: {
    accessTitle: "دەستگەیشتنی پیشاندان بە بانگهێشت",
    accessIntro:
      "بە کۆدی تەلەفۆنی هاوشێوەکراو بچۆ ناو ناسنامە دەستکردە بانگهێشتکراوەکەت.",
    phone: "ژمارەی بانگهێشتی پیشاندان",
    phoneHint:
      "ئەو ژمارە دەستکردە بەکاربهێنە کە بە تایبەتی لەگەڵ بانگهێشتەکەت دراوە.",
    sendCode: "کۆدی هاوشێوەکراو بەکاربهێنە",
    code: "کۆدی بانگهێشتی هاوشێوەکراو",
    codeHint:
      "کۆدی تایبەتی بانگهێشتەکەت بەکاربهێنە. هیچ نامەیەکی دەقی نانێردرێت.",
    verify: "پیشاندان بەردەوام بکە",
    resend: "کۆدی هاوشێوەکراو دووبارە بەکاربهێنە",
    invalidCode: "کۆدی بانگهێشتی هاوشێوەکراو نادروستە.",
    expiredCode:
      "کۆدی بانگهێشتی هاوشێوەکراو بەسەرچووە. داوای نوێکردنەوەی بانگهێشت بکە.",
    verified:
      "بە ناسنامەی دەستکردی پیشاندان چوویتە ژوورەوە. پشتڕاستکردنەوەی تەلەفۆن هاوشێوەکراوە.",
    invalidPhone: "ژمارە دەستکردەکەی لەگەڵ بانگهێشتەکەت بنووسە.",
    editNumber: "ژمارەی پیشاندان بگۆڕە",
    notice:
      "پیشاندانی دەستکرد بە بانگهێشت. ناسنامە و پشتڕاستکردنەوەی تەلەفۆن هاوشێوەکراون. دابینکەرە ڕاستەقینەکان بەردەست نین.",
  },
};
