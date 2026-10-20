import { administratorBookingMoneyExportMessages } from "@/i18n/administrator-booking-money-export-messages";
import { administratorTotalsMessages } from "@/i18n/administrator-totals-messages";
import { bookingLifecycleMessages } from "@/i18n/booking-lifecycle-messages";
import { bookingManagementMessages } from "@/i18n/booking-management-messages";
import { bookingPayoutMessages } from "@/i18n/administrator-payment-history-messages";
import type { Locale } from "@/i18n/routing";
import {
  bookingMoneyFigures,
  newerFirst,
  type BookingMoneySelection,
} from "./administrator-booking-money";

export type RecordedBookingMoneyExport = {
  readonly exportId: string;
  readonly recordedAt: string;
  readonly selection: BookingMoneySelection;
};

const figureColumns = [
  ["bookingPriceFils", "bookingPrice"],
  ["bookingServiceFeeFils", "bookingServiceFees"],
  ["customerTotalFils", "customerTotal"],
  ["commissionAtCaptureFils", "commissionAtCapture"],
  ["refundedBookingPriceFils", "refundedBookingPrice"],
  ["refundedBookingServiceFeeFils", "refundedBookingServiceFees"],
  ["pendingRefundFils", "pendingRefunds"],
  ["commissionAfterRefundsFils", "commissionAfterRefunds"],
  ["ownerShareAtCaptureFils", "ownerShareAtCapture"],
  ["ownerShareAfterRefundsFils", "ownerShareAfterRefunds"],
  ["ownerShareReductionFils", "ownerShareReduction"],
  ["paidPayoutFils", "paidPayouts"],
  ["expectedUnpaidPayoutFils", "unpaidPayouts"],
  ["toRecoverFils", "toRecover"],
] as const;

function cell(value: string | number): string {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error("Invalid export amount");
    const fils = BigInt(value);
    const fraction = (fils % 1000n)
      .toString()
      .padStart(3, "0")
      .replace(/0+$/, "");
    value = `${fils / 1000n}${fraction ? `.${fraction}` : ""}`;
  } else if (/^[\t\r\n]|^\s*[=+\-@＝＋－＠]/u.test(value)) {
    value = "'" + value;
  }
  return `"${value.replaceAll('"', '""')}"`;
}

export function administratorBookingMoneyCsv(
  record: RecordedBookingMoneyExport,
  locale: Locale,
): string {
  const copy = administratorBookingMoneyExportMessages[locale];
  const totals = administratorTotalsMessages[locale];
  const notApplicable = copy.notApplicable;
  const header = [
    copy.exportRecordId,
    copy.recordedAt,
    copy.recordType,
    copy.reference,
    copy.bookingRequestId,
    copy.recordId,
    copy.bookingStatus,
    copy.refundSource,
    copy.refundStatus,
    copy.payoutRecordId,
    copy.confirmedAt,
    copy.refundRequestedAt,
    ...figureColumns.map(([, label]) => `${totals[label]} - ${copy.currency}`),
    `${copy.refundBookingPrice} - ${copy.currency}`,
    `${copy.refundBookingServiceFees} - ${copy.currency}`,
  ];
  const rows: (string | number)[][] = [header];
  const bookings = [
    ...record.selection.bookings.map((row) => ({ row, details: row })),
    ...record.selection.missingPaymentEvidence.map((row) => ({
      row,
      details: null,
    })),
  ].sort((a, b) => newerFirst(a.row, b.row));
  for (const { row: booking, details } of bookings) {
    const derived = details
      ? bookingMoneyFigures(details)
      : ({ status: "unavailable" } as const);
    const identity = [record.exportId, record.recordedAt];
    const status = details
      ? bookingLifecycleMessages[locale][details.state]
      : totals.evidenceUnavailable;
    const payout = details?.settlementIntentId ?? notApplicable;
    rows.push([
      ...identity,
      copy.booking,
      booking.reference,
      booking.bookingRequestId,
      booking.bookingRequestId,
      status,
      notApplicable,
      notApplicable,
      payout,
      booking.confirmedAt,
      notApplicable,
      ...figureColumns.map(([key]) =>
        derived.status === "available"
          ? derived.figures[key]
          : totals.evidenceUnavailable,
      ),
      ...(derived.status === "available"
        ? [notApplicable, notApplicable]
        : [totals.evidenceUnavailable, totals.evidenceUnavailable]),
    ]);
    for (const refund of details?.refundRecords ?? []) {
      const source =
        refund.source === "dispute"
          ? bookingPayoutMessages[locale].disputeRefund
          : refund.source === "administrator"
            ? bookingManagementMessages[locale].approved
            : bookingManagementMessages[locale].automatic;
      rows.push([
        ...identity,
        copy.refund,
        booking.reference,
        booking.bookingRequestId,
        refund.id,
        status,
        source,
        bookingManagementMessages[locale][refund.state],
        payout,
        booking.confirmedAt,
        refund.requestedAt,
        ...figureColumns.map(() =>
          derived.status === "available"
            ? notApplicable
            : totals.evidenceUnavailable,
        ),
        ...(derived.status === "available"
          ? [refund.bookingPriceFils, refund.bookingServiceFeeFils]
          : [totals.evidenceUnavailable, totals.evidenceUnavailable]),
      ]);
    }
  }
  return (
    "\uFEFF" + rows.map((row) => row.map(cell).join(",") + "\r\n").join("")
  );
}
