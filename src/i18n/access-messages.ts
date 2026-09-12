import type { Locale } from "./routing";

export const accessMessages: Record<
  Locale,
  {
    account: string;
    signInAccount: string;
    accessTitle: string;
    accessIntro: string;
    myBookings: string;
    ownerBookings: string;
    listCottage: string;
    manageCottages: string;
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
  }
> = {
  ar: {
    account: "الحساب",
    signInAccount: "تسجيل الدخول",
    accessTitle: "سجّل الدخول أو أنشئ حسابًا",
    accessIntro:
      "تحقق من هاتفك للعودة إلى حجوزاتك. يُنشأ حساب للأرقام الجديدة.",
    myBookings: "حجوزاتي",
    ownerBookings: "حجوزات أكواخي",
    listCottage: "أدرج كوخك",
    manageCottages: "إدارة أكواخي",
    signOut: "تسجيل الخروج",
    enrollTitle: "انضم كمالك كوخ",
    enrollIntro:
      "استخدم الحساب نفسه للحجز وإدارة الأكواخ. ابدأ طلب مالك خاصًا؛ يلزم الحصول على الموافقة قبل نشر كوخك.",
    enroll: "ابدأ طلب المالك",
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
    ownerApplicationCta: "تابع إلى طلب المالك",
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
  },
  ckb: {
    account: "هەژمار",
    signInAccount: "چوونەژوورەوە",
    accessTitle: "بچۆ ژوورەوە یان هەژمارێک دروست بکە",
    accessIntro:
      "ژمارەکەت پشتڕاست بکەرەوە بۆ گەڕانەوە بۆ حجزەکانت. بۆ ژمارەی نوێ هەژمار دروست دەکرێت.",
    myBookings: "حجزەکانم",
    ownerBookings: "حجزەکانی کۆتێجەکانم",
    listCottage: "کۆتێجەکەت تۆمار بکە",
    manageCottages: "بەڕێوەبردنی کۆتێجەکانم",
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
    invalidPhone: "ژمارەیەکی دروستی عێراقی بە +964 بنووسە.",
    invalidCode: "کۆدەکە پشتڕاست نەکرایەوە.",
    unavailable: "پشتڕاستکردنەوە ئێستا بەردەست نییە.",
    ownerApplicationCta: "بەردەوام بە بۆ داواکاری خاوەن",
    administratorTitle: "چوونەژوورەوەی بەڕێوەبەری پلاتفۆرم",
    email: "ئیمەیڵ",
    password: "وشەی نهێنی",
    signIn: "بەردەوام بە",
    mfaCode: "کۆدی ئەپی پشتڕاستکەرەوە",
    mfaSetup: "کۆدەکە بە ئەپی پشتڕاستکەرەوە سکان بکە و کۆدەکە بنووسە.",
    mfaQrAlt: "کۆدی ڕێکخستنی ئەپی پشتڕاستکەرەوە",
    mfaChallenge: "کۆدی ئەپی پشتڕاستکەرەوە بنووسە.",
    administratorReady: "پشتڕاستکردنەوەی دوو هەنگاو تەواو بوو.",
    reviewApplications: "داواکارییە نێردراوەکانی خاوەن بپشکنە",
    manageCottageProfiles: "پرۆفایلەکانی کۆتێج بەڕێوەببە",
    invalidSignIn:
      "زانیاری چوونەژوورەوە نادروستە یان هەژمارەکە بەڕێوەبەر نییە.",
  },
  en: {
    account: "Account",
    signInAccount: "Sign in",
    accessTitle: "Sign in or create an account",
    accessIntro:
      "Verify your phone to return to your bookings. New numbers create an account.",
    myBookings: "My bookings",
    ownerBookings: "Bookings for my cottages",
    listCottage: "List your cottage",
    manageCottages: "Manage my cottages",
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
  },
};
