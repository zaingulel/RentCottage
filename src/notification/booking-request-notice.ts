import { formatIraqDateTime } from "@/i18n/format";
import type {
  PaidConfirmationNoticeLocale,
  PaidConfirmationRecipientRole,
} from "./paid-confirmation-notice";

export const requestNoticeKinds = [
  "request_new",
  "request_accepted",
  "request_payment_required",
  "request_declined",
  "request_withdrawn",
  "request_expired",
  "recovery_processing",
  "recovery_retryable",
  "recovery_attention",
] as const;
export type RequestNoticeKind = (typeof requestNoticeKinds)[number];
export function isRequestNoticeKind(
  value: unknown,
): value is RequestNoticeKind {
  return requestNoticeKinds.some((kind) => kind === value);
}
export type RequestNoticeEvent = {
  readonly id: string;
  readonly sourceId: string;
  readonly kind: RequestNoticeKind;
  readonly deadlineAt: string | null;
};
export type BookingRequestNotice = {
  readonly kind: RequestNoticeKind;
  readonly title: string;
  readonly body: string;
  readonly bookingReference: null;
  readonly bookingRequestReference: string;
  readonly deadlineAt: string | null;
  readonly detailsPath: string;
  readonly linkLabel: string;
  readonly fictional: true;
};
export const requestNoticeTitles = {
  en: {
    request_new: "New Booking Request",
    request_accepted: "Booking Request accepted",
    request_payment_required: "Payment required",
    request_declined: "Booking Request declined",
    request_withdrawn: "Booking Request withdrawn",
    request_expired: "Booking Request expired",
    recovery_processing: "Payment recovery processing",
    recovery_retryable: "Payment recovery can be retried",
    recovery_attention: "Payment recovery needs attention",
  },
  ar: {
    request_new: "طلب حجز جديد",
    request_accepted: "تم قبول طلب الحجز",
    request_payment_required: "الدفع مطلوب",
    request_declined: "تم رفض طلب الحجز",
    request_withdrawn: "تم سحب طلب الحجز",
    request_expired: "انتهت مهلة طلب الحجز",
    recovery_processing: "معالجة إعادة محاولة الدفع",
    recovery_retryable: "يمكن إعادة محاولة الدفع",
    recovery_attention: "إعادة محاولة الدفع تحتاج إلى متابعة",
  },
  ckb: {
    request_new: "داواکارییەکی نوێی حجز",
    request_accepted: "داواکاری حجز پەسەند کرا",
    request_payment_required: "پارەدان پێویستە",
    request_declined: "داواکاری حجز ڕەت کرایەوە",
    request_withdrawn: "داواکاری حجز کشایەوە",
    request_expired: "کاتی داواکاری حجز بەسەرچوو",
    recovery_processing: "دووبارە هەوڵی پارەدان لە پرۆسەدایە",
    recovery_retryable: "دەکرێت دووبارە هەوڵی پارەدان بدرێت",
    recovery_attention: "دووبارە هەوڵی پارەدان پێویستی بە بەدواداچوون هەیە",
  },
} satisfies Record<
  PaidConfirmationNoticeLocale,
  Record<RequestNoticeKind, string>
>;
const messages = {
  en: {
    accepted:
      "The owner accepted this request. Payment is processing; the booking is not yet confirmed.",
    view: "Open your authenticated Booking Request for its current status.",
    deadline: "Deadline",
    link: "View Booking Request",
  },
  ar: {
    accepted:
      "وافق المالك على هذا الطلب. تجري معالجة الدفع؛ لم يتم تأكيد الحجز بعد.",
    view: "افتح طلب الحجز بعد تسجيل الدخول للاطلاع على حالته الحالية.",
    deadline: "المهلة",
    link: "عرض طلب الحجز",
  },
  ckb: {
    accepted:
      "خاوەن موڵک ئەم داواکارییەی پەسەند کرد. پارەدان لە پرۆسەدایە؛ حجزەکە هێشتا پشتڕاست نەکراوەتەوە.",
    view: "بۆ زانینی دۆخی ئێستا بچۆ ژوورەوە و داواکاری حجزەکەت بکەرەوە.",
    deadline: "کۆتا کات",
    link: "بینینی داواکاری حجز",
  },
};
export function bookingRequestNotice(candidate: {
  readonly event: RequestNoticeEvent;
  readonly locale: PaidConfirmationNoticeLocale;
  readonly recipientRole: PaidConfirmationRecipientRole;
  readonly bookingRequestReference: string;
}): BookingRequestNotice {
  const { event, locale, recipientRole, bookingRequestReference } = candidate;
  const copy = messages[locale];
  return {
    kind: event.kind,
    title: requestNoticeTitles[locale][event.kind],
    body: `${event.kind === "request_accepted" ? copy.accepted : copy.view}${event.deadlineAt ? ` ${copy.deadline}: ${formatIraqDateTime(event.deadlineAt, locale)}.` : ""}`,
    bookingReference: null,
    bookingRequestReference,
    deadlineAt: event.deadlineAt,
    detailsPath: `/${locale}/${recipientRole === "customer" ? "booking-requests" : "owner/booking-requests"}/${bookingRequestReference}`,
    linkLabel: copy.link,
    fictional: true,
  };
}
