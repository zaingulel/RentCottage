import type { Locale } from "./routing";

export const accessMessages: Record<
  Locale,
  {
    phone: string;
    phoneHint: string;
    sendCode: string;
    code: string;
    verify: string;
    verifiedCustomer: string;
    verifiedOwner: string;
    invalidPhone: string;
    invalidCode: string;
    unavailable: string;
    roleConflict: string;
    ownerTitle: string;
    ownerIntro: string;
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
    invalidSignIn: string;
  }
> = {
  ar: {
    phone: "رقم الهاتف العراقي",
    phoneHint: "اكتب الرقم بصيغة +9647501234567",
    sendCode: "أرسل رمز التحقق",
    code: "رمز التحقق",
    verify: "تحقق",
    verifiedCustomer: "تم التحقق. لديك صلاحيات العميل فقط.",
    verifiedOwner: "تم التحقق. حساب المالك ما زال بانتظار الموافقة.",
    invalidPhone: "أدخل رقمًا عراقيًا صحيحًا يبدأ بـ +964.",
    invalidCode: "تعذر التحقق من الرمز.",
    unavailable: "التحقق غير متاح الآن. حاول مرة أخرى.",
    roleConflict: "هذا الرقم مرتبط بدور مختلف. استخدم هوية منفصلة.",
    ownerTitle: "دخول مالك البيت",
    ownerIntro: "تحقق من رقمك لبدء طلب المالك الخاص بك.",
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
    invalidSignIn: "بيانات الدخول غير صحيحة أو الحساب ليس لمسؤول.",
  },
  ckb: {
    phone: "ژمارە تەلەفۆنی عێراقی",
    phoneHint: "ژمارەکە بە شێوەی +9647501234567 بنووسە",
    sendCode: "کۆدی پشتڕاستکردنەوە بنێرە",
    code: "کۆدی پشتڕاستکردنەوە",
    verify: "پشتڕاست بکەرەوە",
    verifiedCustomer: "پشتڕاست کرایەوە. تەنها دەسەڵاتی کڕیار هەیە.",
    verifiedOwner: "پشتڕاست کرایەوە. هەژماری خاوەن چاوەڕێی پەسەندە.",
    invalidPhone: "ژمارەیەکی دروستی عێراقی بە +964 بنووسە.",
    invalidCode: "کۆدەکە پشتڕاست نەکرایەوە.",
    unavailable: "پشتڕاستکردنەوە ئێستا بەردەست نییە.",
    roleConflict: "ئەم ژمارەیە بە ڕۆڵێکی ترەوە بەستراوە.",
    ownerTitle: "چوونەژوورەوەی خاوەنی ماڵ",
    ownerIntro: "ژمارەکەت پشتڕاست بکەرەوە بۆ دەستپێکردنی داواکاری.",
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
    invalidSignIn:
      "زانیاری چوونەژوورەوە نادروستە یان هەژمارەکە بەڕێوەبەر نییە.",
  },
  en: {
    phone: "Iraqi phone number",
    phoneHint: "Use the format +9647501234567",
    sendCode: "Send verification code",
    code: "Verification code",
    verify: "Verify",
    verifiedCustomer: "Verified. You have Customer access only.",
    verifiedOwner: "Verified. Your Cottage Owner access is awaiting approval.",
    invalidPhone: "Enter a valid Iraqi number beginning +964.",
    invalidCode: "The verification code could not be confirmed.",
    unavailable: "Verification is unavailable. Try again.",
    roleConflict:
      "This number belongs to another role. Use a separate identity.",
    ownerTitle: "Cottage Owner access",
    ownerIntro: "Verify your phone to begin your private owner application.",
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
    invalidSignIn:
      "The sign-in is invalid or this is not an administrator account.",
  },
};
