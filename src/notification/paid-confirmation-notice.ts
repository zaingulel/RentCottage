export type PaidConfirmationNoticeLocale = "ar" | "ckb" | "en";
export type PaidConfirmationRecipientRole = "customer" | "cottage_owner";

export interface PaidConfirmationNotice {
  readonly kind: "paid-confirmation";
  readonly title: string;
  readonly body: string;
  readonly bookingReference: string;
  readonly detailsPath: string;
  readonly linkLabel: string;
  readonly fictional: true;
}

const messages = {
  en: {
    title: "Booking confirmed",
    body: (reference: string) =>
      `Your booking ${reference} is confirmed and paid.`,
    linkLabel: "View confirmed booking",
  },
  ar: {
    title: "تم تأكيد الحجز",
    body: (reference: string) => `تم تأكيد الحجز ${reference} واستلام الدفعة.`,
    linkLabel: "عرض الحجز المؤكد",
  },
  ckb: {
    title: "حجزەکە پشتڕاست کرایەوە",
    body: (reference: string) =>
      `حجزی ${reference} پشتڕاست کرایەوە و پارەکە وەرگیرا.`,
    linkLabel: "بینینی حجزە پشتڕاستکراوەکە",
  },
} satisfies Record<
  PaidConfirmationNoticeLocale,
  {
    readonly title: string;
    readonly body: (reference: string) => string;
    readonly linkLabel: string;
  }
>;

export function paidConfirmationNotice({
  locale,
  recipientRole,
  bookingRequestReference,
  bookingReference,
}: {
  readonly locale: PaidConfirmationNoticeLocale;
  readonly recipientRole: PaidConfirmationRecipientRole;
  readonly bookingRequestReference: string;
  readonly bookingReference: string;
}): PaidConfirmationNotice {
  const message = messages[locale];
  const route =
    recipientRole === "customer"
      ? `/${locale}/booking-requests/${bookingRequestReference}`
      : `/${locale}/owner/booking-requests/${bookingRequestReference}`;
  return {
    kind: "paid-confirmation",
    title: message.title,
    body: message.body(bookingReference),
    bookingReference,
    detailsPath: route,
    linkLabel: message.linkLabel,
    fictional: true,
  };
}
