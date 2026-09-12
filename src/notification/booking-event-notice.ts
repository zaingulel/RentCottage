import { formatFilsAsIqd } from "@/i18n/format";
import type { RefundAllocation } from "@/payment/payment-contract";
import { refundAllocationTotal } from "@/payment/payment-refund-allocation";
import {
  paidConfirmationNotice,
  type PaidConfirmationNotice,
  type PaidConfirmationNoticeLocale,
  type PaidConfirmationRecipientRole,
} from "./paid-confirmation-notice";

export type BookingNoticeEventKind =
  | "cancelled"
  | "refund_requested"
  | "refund_returned"
  | "refund_attention";
export interface BookingNoticeEvent {
  readonly id: string;
  readonly kind: BookingNoticeEventKind;
  readonly allocation: RefundAllocation;
}
export interface BookingEventNotice extends Omit<
  PaidConfirmationNotice,
  "kind"
> {
  readonly kind: BookingNoticeEventKind;
  readonly allocation: RefundAllocation;
}
const messages = {
  en: {
    cancelled: "Booking cancelled",
    refund_requested: "Refund requested",
    refund_returned: "Refund returned",
    refund_attention: "Refund attention recorded",
    cancellation:
      "This booking is cancelled. View your booking for refund progress.",
    requested: (amount: string) =>
      `A refund of ${amount} was requested. View your booking for its current status.`,
    returned: (amount: string) =>
      `A refund of ${amount} has been verified as returned.`,
    attention: (amount: string) =>
      `A refund of ${amount} required attention. View your booking for its current status.`,
    price: "Booking price",
    fee: "Service fee",
    link: "View booking",
  },
  ar: {
    cancelled: "تم إلغاء الحجز",
    refund_requested: "تم طلب الاسترداد",
    refund_returned: "تم رد المبلغ",
    refund_attention: "تم تسجيل حاجة الاسترداد إلى متابعة",
    cancellation: "تم إلغاء هذا الحجز. افتح الحجز لمتابعة الاسترداد.",
    requested: (amount: string) =>
      `تم طلب استرداد ${amount}. افتح الحجز للاطلاع على حالته الحالية.`,
    returned: (amount: string) => `تم التحقق من رد مبلغ ${amount}.`,
    attention: (amount: string) =>
      `استرداد ${amount} تطلب متابعة. افتح الحجز للاطلاع على حالته الحالية.`,
    price: "سعر الحجز",
    fee: "رسوم الخدمة",
    link: "عرض الحجز",
  },
  ckb: {
    cancelled: "حجزەکە هەڵوەشایەوە",
    refund_requested: "داوای گەڕاندنەوەی پارە کرا",
    refund_returned: "پارەکە گەڕێندرایەوە",
    refund_attention: "پێویستی گەڕاندنەوەی پارە بە بەدواداچوون تۆمار کرا",
    cancellation:
      "ئەم حجزە هەڵوەشاوەتەوە. بۆ زانینی دۆخی گەڕاندنەوەی پارە حجزەکەت بکەرەوە.",
    requested: (amount: string) =>
      `داوای گەڕاندنەوەی ${amount} کرا. بۆ زانینی دۆخی ئێستای حجزەکەت بیکەرەوە.`,
    returned: (amount: string) => `گەڕاندنەوەی ${amount} پشتڕاست کراوەتەوە.`,
    attention: (amount: string) =>
      `گەڕاندنەوەی ${amount} پێویستی بە بەدواداچوون هەبوو. بۆ زانینی دۆخی ئێستای حجزەکەت بیکەرەوە.`,
    price: "نرخی حجز",
    fee: "کرێی خزمەتگوزاری",
    link: "بینینی حجز",
  },
};
export function bookingEventNotice(candidate: {
  readonly event: BookingNoticeEvent;
  readonly locale: PaidConfirmationNoticeLocale;
  readonly recipientRole: PaidConfirmationRecipientRole;
  readonly bookingRequestReference: string;
  readonly bookingReference: string;
}): BookingEventNotice {
  const { event, locale } = candidate;
  const copy = messages[locale];
  const total = formatFilsAsIqd(
    refundAllocationTotal(event.allocation),
    locale,
  );
  const status =
    event.kind === "cancelled"
      ? copy.cancellation
      : event.kind === "refund_requested"
        ? copy.requested(total)
        : event.kind === "refund_returned"
          ? copy.returned(total)
          : copy.attention(total);
  return {
    ...paidConfirmationNotice(candidate),
    kind: event.kind,
    title: copy[event.kind],
    body:
      event.kind === "cancelled"
        ? status
        : `${status} ${copy.price}: ${formatFilsAsIqd(event.allocation.bookingPriceFils, locale)}. ${copy.fee}: ${formatFilsAsIqd(event.allocation.bookingServiceFeeFils, locale)}.`,
    linkLabel: copy.link,
    allocation: {
      bookingPriceFils: event.allocation.bookingPriceFils,
      bookingServiceFeeFils: event.allocation.bookingServiceFeeFils,
    },
  };
}
