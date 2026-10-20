import { expect, it } from "vitest";
import type { OwnerBookingEarningsFacts } from "@/booking-request/owner-booking-earnings";
import type { BookingMoneyRow } from "./administrator-booking-money";
import { administratorBookingMoneyCsv } from "./administrator-booking-money-export";

const uuid = (n: number) =>
  `43000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const exportId = uuid(999);
const recordedAt = "2026-10-20T09:00:00.123456+00:00";
const zero = { bookingPriceFils: 0, bookingServiceFeeFils: 0 };
const maturity = {
  status: "completed",
  effectivePeriodEnd: "2026-10-01T12:00:00Z",
  assessedAt: "2026-10-01T12:00:01Z",
  reviewExpiresAt: "2026-10-15T12:00:00Z",
  reviewAvailable: true,
  payoutPrerequisiteAt: "2026-10-01T12:00:00Z",
  payoutPrerequisiteAvailable: true,
} as const;
const facts: Extract<OwnerBookingEarningsFacts, { status: "captured" }> = {
  status: "captured",
  captured: { bookingPriceFils: 100_000_000, bookingServiceFeeFils: 5_000_000 },
  refunded: { bookingPriceFils: 10_000_000, bookingServiceFeeFils: 0 },
  reserved: zero,
  obligation: zero,
  marketplaceCommissionRateBasisPoints: 1000,
  marketplaceCommissionAmountFils: 10_000_000,
  refunds: [
    {
      state: "succeeded",
      allocation: { bookingPriceFils: 10_000_000, bookingServiceFeeFils: 0 },
    },
  ],
  maturity,
  administratorHoldActive: false,
  disputes: [],
  settlement: {
    amountFils: 90_000_000,
    state: "succeeded",
    retrySafe: false,
    receipt: { paidFils: 90_000_000, recordedAt: "2026-10-02T12:00:00Z" },
  },
  recovery: {
    status: "paid",
    paidFils: 90_000_000,
    ownerEntitlementFils: 81_000_000,
    paidWhileBlocked: false,
    recoveryExposureFils: 9_000_000,
    recoveryBalanceFils: 9_000_000,
    automaticOwnerDebitFils: 0,
  },
};
const booking = (
  n = 1,
  change: Partial<BookingMoneyRow> = {},
): BookingMoneyRow => ({
  bookingRequestId: uuid(n),
  reference: `RC-REQ-${String(n).padStart(16, "0")}`,
  confirmedAt: "2026-10-01T00:00:00.000001+00:00",
  state: "completed",
  earnings: facts,
  refundRecords: [
    {
      id: uuid(900 + n),
      source: "administrator",
      state: "succeeded",
      bookingPriceFils: 10_000_000,
      bookingServiceFeeFils: 0,
      requestedAt: "2026-10-02T12:00:00.000001+03:00",
    },
  ],
  settlementIntentId: uuid(800 + n),
  ...change,
});
const record = (bookings: readonly BookingMoneyRow[]) => ({
  exportId,
  recordedAt,
  selection: { bookings, missingPaymentEvidence: [] },
});
const englishHeader =
  '"Export record ID","Export recorded at","Record type","Booking reference","Booking request ID","Record ID","Booking status","Refund source","Refund status","Owner Payout record ID","Confirmed at","Refund requested at","Booking Price - Iraqi dinars (IQD)","Booking Service Fees - Iraqi dinars (IQD)","Customer Total - Iraqi dinars (IQD)","Marketplace Commission at capture - Iraqi dinars (IQD)","Booking Price refunded - Iraqi dinars (IQD)","Booking Service Fees refunded - Iraqi dinars (IQD)","Refunds not yet completed - Iraqi dinars (IQD)","Marketplace Commission after refunds - Iraqi dinars (IQD)","Owner share at capture - Iraqi dinars (IQD)","Owner share after refunds - Iraqi dinars (IQD)","Reduction in owner share from refunds - Iraqi dinars (IQD)","Paid to owners - Iraqi dinars (IQD)","Expected, not yet paid - Iraqi dinars (IQD)","To recover from owners already paid - Iraqi dinars (IQD)","Refund record: Booking Price - Iraqi dinars (IQD)","Refund record: Booking Service Fees - Iraqi dinars (IQD)"\r\n';

it("serializes recorded money with exact dinar fractions and identifiable adjustments", () => {
  const golden =
    "\uFEFF" +
    englishHeader +
    '"43000000-0000-4000-8000-000000000999","2026-10-20T09:00:00.123456+00:00","Booking","RC-REQ-0000000000000001","43000000-0000-4000-8000-000000000001","43000000-0000-4000-8000-000000000001","Completed booking","Not applicable","Not applicable","43000000-0000-4000-8000-000000000801","2026-10-01T00:00:00.000001+00:00","Not applicable","100000","5000","105000","10000","10000","0","0","9000","90000","81000","9000","90000","0","9000","Not applicable","Not applicable"\r\n' +
    '"43000000-0000-4000-8000-000000000999","2026-10-20T09:00:00.123456+00:00","Refund","RC-REQ-0000000000000001","43000000-0000-4000-8000-000000000001","43000000-0000-4000-8000-000000000901","Completed booking","Refund approved","Returned","43000000-0000-4000-8000-000000000801","2026-10-01T00:00:00.000001+00:00","2026-10-02T12:00:00.000001+03:00","Not applicable","Not applicable","Not applicable","Not applicable","Not applicable","Not applicable","Not applicable","Not applicable","Not applicable","Not applicable","Not applicable","Not applicable","Not applicable","Not applicable","10000","0"\r\n';
  expect(administratorBookingMoneyCsv(record([booking()]), "en")).toBe(golden);
  for (const pendingState of ["requested", "processing", "unknown"] as const) {
    const pending = {
      id: uuid(911),
      source: "cancellation",
      state: pendingState,
      bookingPriceFils: 1000,
      bookingServiceFeeFils: 125,
      requestedAt: "2026-10-04T12:00:00.000002+00:00",
    } as const;
    const failed = {
      id: uuid(910),
      source: "dispute",
      state: "failed",
      bookingPriceFils: 0,
      bookingServiceFeeFils: 1,
      requestedAt: "2026-10-03T12:00:00.000002+00:00",
    } as const;
    const adjusted: typeof facts = {
      ...facts,
      reserved: { bookingPriceFils: 1000, bookingServiceFeeFils: 125 },
      refunds: [
        ...facts.refunds,
        {
          state: pendingState,
          allocation: { bookingPriceFils: 1000, bookingServiceFeeFils: 125 },
        },
        {
          state: "failed",
          allocation: { bookingPriceFils: 0, bookingServiceFeeFils: 1 },
        },
      ],
    };
    const csv = administratorBookingMoneyCsv(
      record([
        booking(1, {
          earnings: adjusted,
          refundRecords: [pending, failed, ...booking().refundRecords],
        }),
      ]),
      "en",
    );
    expect(csv).toContain(',"10000","10000","0","1.125","9000"');
    expect(csv).toContain(',"1","0.125"\r\n');
    expect(csv).toContain(',"0","0.001"\r\n');
    expect(csv).toContain(
      '"Dispute refund award","Failed: no funds returned under this approval"',
    );
    expect(csv.indexOf(`"${uuid(911)}"`)).toBeLessThan(
      csv.indexOf(`"${uuid(910)}"`),
    );
    expect(csv.indexOf(`"${uuid(910)}"`)).toBeLessThan(
      csv.indexOf(`"${uuid(901)}"`),
    );
  }
  for (const [fils, literal] of [
    [0, "0"],
    [1, "0.001"],
    [125, "0.125"],
    [50_000_125, "50000.125"],
    [Number.MAX_SAFE_INTEGER, "9007199254740.991"],
  ] as const) {
    const feeOnly = {
      ...facts,
      captured: { bookingPriceFils: 0, bookingServiceFeeFils: fils },
      refunded: zero,
      refunds: [],
      marketplaceCommissionAmountFils: 0,
      settlement: null,
      recovery: { status: "unsettled" } as const,
    };
    const csv = administratorBookingMoneyCsv(
      record([
        booking(1, {
          earnings: feeOnly,
          refundRecords: [],
          settlementIntentId: null,
        }),
      ]),
      "en",
    );
    expect(csv).toContain(
      `,"0","${literal}","${literal}","0","0","0","0","0","0","0","0","0","0","0","Not applicable","Not applicable"\r\n`,
    );
  }
});

it("marks every money cell unavailable for missing or inconsistent evidence", () => {
  const unavailable = booking(3, { earnings: { status: "unavailable" } });
  const disagreeing = booking(2, {
    refundRecords: [
      { ...booking(2).refundRecords[0], bookingPriceFils: 9_000_000 },
    ],
  });
  const missing = {
    bookingRequestId: uuid(4),
    reference: "RC-REQ-0000000000000004",
    confirmedAt: "2026-10-03T00:00:00.000001+00:00",
  };
  const csv = administratorBookingMoneyCsv(
    {
      exportId,
      recordedAt,
      selection: {
        bookings: [booking(), disagreeing, unavailable],
        missingPaymentEvidence: [missing],
      },
    },
    "en",
  );
  const lines = csv.split("\r\n");
  expect(lines).toHaveLength(9);
  expect(lines[1]).toContain(
    `"Booking","RC-REQ-0000000000000004","${uuid(4)}","${uuid(4)}","Payment evidence unavailable","Not applicable","Not applicable","Not applicable","2026-10-03T00:00:00.000001+00:00","Not applicable"`,
  );
  const unavailableMoney = Array(16)
    .fill('"Payment evidence unavailable"')
    .join(",");
  for (const index of [1, 2, 3, 4, 5])
    expect(lines[index]).toMatch(new RegExp(unavailableMoney + "$"));
  expect(lines[2]).toContain(`"Booking","RC-REQ-0000000000000003"`);
  expect(lines[3]).toContain(
    `"Refund","RC-REQ-0000000000000003","${uuid(3)}","${uuid(903)}","Completed booking","Refund approved","Returned"`,
  );
  expect(lines[4]).toContain(`"Booking","RC-REQ-0000000000000002"`);
  expect(lines[6]).toContain('"100000","5000","105000"');
  expect(lines[7]).toContain('"10000","0"');
});

it("quotes multilingual CSV and neutralizes formula-leading text", () => {
  for (const [text, escaped] of [
    ['he said "نعم", باشە\nnext', '"he said ""نعم"", باشە\nnext"'],
    ["=1", '"\'=1"'],
    ["+1", '"\'+1"'],
    ["-1", '"\'-1"'],
    ["@1", '"\'@1"'],
    ["＝1", '"\'＝1"'],
    ["＋1", '"\'＋1"'],
    ["－1", '"\'－1"'],
    ["＠1", '"\'＠1"'],
    ["  =1", '"\'  =1"'],
    ["\tplain", '"\'\tplain"'],
    ["\rplain", '"\'\rplain"'],
    ["\nplain", '"\'\nplain"'],
  ]) {
    const csv = administratorBookingMoneyCsv(
      record([booking(1, { reference: text })]),
      "en",
    );
    expect(csv).toContain(`,"Booking",${escaped},"${uuid(1)}"`);
  }
  for (const [locale, prefix, priceHeader, recordType] of [
    [
      "en",
      '\uFEFF"Export record ID","Export recorded at","Record type"',
      '"Booking Price - Iraqi dinars (IQD)"',
      '"Booking"',
    ],
    [
      "ar",
      '\uFEFF"معرّف سجل التصدير","وقت تسجيل التصدير","نوع السجل"',
      '"سعر الحجز - دينار عراقي (IQD)"',
      '"حجز"',
    ],
    [
      "ckb",
      '\uFEFF"ناسنامەی تۆماری هەناردەکردن","کاتی تۆمارکردنی هەناردەکردن","جۆری تۆمار"',
      '"نرخی حجز - دیناری عێراقی (IQD)"',
      '"حجز"',
    ],
  ] as const) {
    const csv = administratorBookingMoneyCsv(record([booking()]), locale);
    expect(csv.startsWith(prefix)).toBe(true);
    expect(csv).toContain(priceHeader);
    expect(csv).toContain(`,${recordType},"RC-REQ-0000000000000001"`);
    expect(csv).toContain(',"100000","5000","105000"');
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.match(/\uFEFF/g)).toHaveLength(1);
  }
});
