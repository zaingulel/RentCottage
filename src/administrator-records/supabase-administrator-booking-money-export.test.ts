import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { createServerClient, cookies } = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  cookies: vi.fn(),
}));
vi.mock("@supabase/ssr", () => ({ createServerClient }));
vi.mock("next/headers", () => ({ cookies }));
vi.mock("server-only", () => ({}));
import { exportAdministratorBookingMoney } from "./supabase-administrator-booking-money-export";

const uuid = (n: number) =>
  `43000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const zero = { bookingPriceFils: 0, bookingServiceFeeFils: 0 };
const earnings = {
  status: "captured",
  captured: { bookingPriceFils: 100_000_000, bookingServiceFeeFils: 5_000_000 },
  refunded: zero,
  reserved: zero,
  obligation: zero,
  marketplaceCommissionRateBasisPoints: 1000,
  marketplaceCommissionAmountFils: 10_000_000,
  refunds: [],
  maturity: {
    status: "completed",
    effectivePeriodEnd: "2026-10-01T12:00:00Z",
    assessedAt: "2026-10-01T12:00:01Z",
    reviewExpiresAt: "2026-10-15T12:00:00Z",
    reviewAvailable: true,
    payoutPrerequisiteAt: "2026-10-01T12:00:00Z",
    payoutPrerequisiteAvailable: true,
  },
  administratorHoldActive: false,
  disputes: [],
  settlement: null,
  recovery: { status: "unsettled" },
};
const booking = (n: number) => ({
  bookingRequestId: uuid(n),
  reference: `RC-REQ-${String(n).padStart(16, "0")}`,
  confirmedAt: "2026-10-01T00:00:00.123456+00:00",
  state: "completed",
  earnings: structuredClone(earnings),
  refundRecords: [] as {
    id: string;
    source: string;
    state: string;
    bookingPriceFils: number;
    bookingServiceFeeFils: number;
    requestedAt: string;
  }[],
  settlementIntentId: null as string | null,
});
const recorded = (count = 1) => ({
  status: "recorded",
  exportId: uuid(999),
  recordedAt: "2026-10-20T09:00:00.123456+00:00",
  selection: {
    status: "ready",
    bookings: Array.from({ length: count }, (_, i) => booking(i + 1)),
    missingPaymentEvidence: [],
  },
});
const rpc = vi.fn();
const getUser = vi.fn();
const maybeSingle = vi.fn();
const select = vi.fn();
const eq = vi.fn();
const from = vi.fn();
const logged = vi.spyOn(console, "error").mockImplementation(() => {});
let authorization: unknown;
let reply: unknown;
let exportError: object | null;
const search = {
  state: "completed",
  from: "2026-10-01",
  through: "2026-10-31",
};
const normalized = { ...search, afterAt: null, afterId: null };
beforeEach(() => {
  vi.clearAllMocks();
  for (const [key, value] of Object.entries({
    APP_ENVIRONMENT: "test",
    SUPABASE_PROJECT_REF: "local-test",
    SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_PUBLISHABLE_KEY: "synthetic-publishable",
    SUPABASE_SECRET_KEY: "synthetic-secret",
    PRIVILEGED_AUDIT_HMAC_KEY:
      "synthetic-audit-hmac-key-at-least-32-characters",
  }))
    vi.stubEnv(key, value);
  vi.stubEnv("DEPLOYMENT_COMMIT", undefined);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_SECRET_KEY", undefined);
  vi.stubEnv("NEXT_PUBLIC_PRIVILEGED_AUDIT_HMAC_KEY", undefined);
  authorization = true;
  reply = recorded();
  exportError = null;
  getUser.mockResolvedValue({ data: { user: { id: uuid(700) } }, error: null });
  maybeSingle.mockResolvedValue({
    data: {
      user_id: uuid(700),
      role: "platform_administrator",
      owner_approval_state: null,
    },
    error: null,
  });
  eq.mockReturnValue({ maybeSingle });
  select.mockReturnValue({ eq });
  from.mockReturnValue({ select });
  rpc.mockImplementation(async (name: string) =>
    name === "is_platform_administrator"
      ? { data: authorization, error: null }
      : { data: reply, error: exportError },
  );
  createServerClient.mockReturnValue({ rpc, from, auth: { getUser } });
  cookies.mockResolvedValue({ getAll: () => [], set: vi.fn() });
});
afterEach(() => {
  vi.unstubAllEnvs();
});

it("refuses unrecorded or malformed export replies without producing CSV", async () => {
  reply = recorded(26);
  const admitted = await exportAdministratorBookingMoney(search, "en");
  expect(admitted.status).toBe("ready");
  if (admitted.status !== "ready")
    throw new Error("A recorded selection did not produce CSV");
  expect(admitted.exportId).toBe(uuid(999));
  expect(admitted.csv.match(/,"Booking",/g)).toHaveLength(26);
  expect(admitted.csv).toContain(`"${uuid(1)}"`);
  expect(admitted.csv).toContain(`"${uuid(26)}"`);
  expect(rpc.mock.calls.map(([name]) => name)).toEqual([
    "is_platform_administrator",
    "record_administrator_booking_money_export",
  ]);
  expect(rpc).toHaveBeenLastCalledWith(
    "record_administrator_booking_money_export",
    {
      target_state: "completed",
      target_from: "2026-10-01",
      target_through: "2026-10-31",
    },
  );
  expect(from).toHaveBeenCalledWith("account_contexts");
  expect(eq).toHaveBeenCalledWith("user_id", uuid(700));
  for (const call of createServerClient.mock.calls)
    expect(call.slice(0, 2)).toEqual([
      "http://127.0.0.1:54321",
      "synthetic-publishable",
    ]);

  for (const [data, expected] of [
    [{ status: "empty" }, { status: "empty", search: normalized }],
    [
      { status: "too_many", limit: 500 },
      { status: "too_many", limit: 500, search: normalized },
    ],
  ]) {
    reply = data;
    await expect(
      exportAdministratorBookingMoney(search, "en"),
    ).resolves.toEqual(expected);
  }
  reply = recorded(500);
  expect((await exportAdministratorBookingMoney({}, "en")).status).toBe(
    "ready",
  );
  expect(rpc).toHaveBeenLastCalledWith(
    "record_administrator_booking_money_export",
    { target_state: null, target_from: null, target_through: null },
  );
  reply = recorded();
  await exportAdministratorBookingMoney(
    { state: "", from: "", through: "" },
    "en",
  );
  expect(rpc).toHaveBeenLastCalledWith(
    "record_administrator_booking_money_export",
    { target_state: null, target_from: null, target_through: null },
  );

  for (const corruptEvidence of [false, true]) {
    const knownUnavailable = recorded();
    if (corruptEvidence)
      knownUnavailable.selection.bookings[0].refundRecords.push({
        id: uuid(901),
        source: "administrator",
        state: "succeeded",
        bookingPriceFils: 10_000_000,
        bookingServiceFeeFils: 0,
        requestedAt: "2026-10-02T00:00:00.123456+00:00",
      });
    else
      Object.assign(knownUnavailable.selection.bookings[0], {
        earnings: { status: "unavailable" },
      });
    reply = knownUnavailable;
    const outcome = await exportAdministratorBookingMoney({}, "en");
    expect(outcome.status).toBe("ready");
    if (outcome.status !== "ready")
      throw new Error("Known unavailable evidence was refused");
    expect(outcome.csv).toContain('"Payment evidence unavailable"');
  }
  const malformed: [string, unknown][] = [
    ["unrecorded ready", recorded().selection],
    ["no reply", null],
    ["unknown status", { ...recorded(), status: "ready" }],
    ["wrong cap", { status: "too_many", limit: 499 }],
    ["extra refusal data", { status: "empty", actorUserId: "PRIVATE-ACTOR" }],
    ["extra envelope data", { ...recorded(), actorUserId: "PRIVATE-ACTOR" }],
    [
      "no selection",
      {
        status: "recorded",
        exportId: uuid(999),
        recordedAt: recorded().recordedAt,
      },
    ],
    ["bad export ID", { ...recorded(), exportId: "=PRIVATE-ID" }],
    [
      "bad export time",
      { ...recorded(), recordedAt: "2026-13-20T09:00:00.123456+00:00" },
    ],
    [
      "no time offset",
      { ...recorded(), recordedAt: "2026-10-20T09:00:00.123456" },
    ],
    ["empty recorded selection", recorded(0)],
    ["501 rows", recorded(501)],
    [
      "extra selection data",
      {
        ...recorded(),
        selection: { ...recorded().selection, email: "PRIVATE-EMAIL" },
      },
    ],
    ...(
      [
        [
          "bad booking ID",
          (r: ReturnType<typeof booking>) => {
            r.bookingRequestId = "PRIVATE-ID";
          },
        ],
        [
          "hostile reference",
          (r: ReturnType<typeof booking>) => {
            r.reference = "=PRIVATE-FORMULA";
          },
        ],
        [
          "bad confirmation time",
          (r: ReturnType<typeof booking>) => {
            r.confirmedAt = "2026-10-01T00:00:00";
          },
        ],
        [
          "bad payout ID",
          (r: ReturnType<typeof booking>) => {
            r.settlementIntentId = "PRIVATE-ID";
          },
        ],
        [
          "negative money",
          (r: ReturnType<typeof booking>) => {
            r.earnings.captured.bookingPriceFils = -1;
          },
        ],
        [
          "fractional money",
          (r: ReturnType<typeof booking>) => {
            r.earnings.captured.bookingServiceFeeFils = 1.5;
          },
        ],
        [
          "unsafe money",
          (r: ReturnType<typeof booking>) => {
            r.earnings.captured.bookingServiceFeeFils =
              Number.MAX_SAFE_INTEGER + 1;
          },
        ],
        [
          "extra booking field",
          (r: ReturnType<typeof booking>) => {
            Object.assign(r, { phone: "PRIVATE-PHONE" });
          },
        ],
        [
          "extra earnings field",
          (r: ReturnType<typeof booking>) => {
            Object.assign(r.earnings, { address: "PRIVATE-ADDRESS" });
          },
        ],
        [
          "extra nested amount field",
          (r: ReturnType<typeof booking>) => {
            Object.assign(r.earnings.captured, {
              providerPayload: "PRIVATE-PAYLOAD",
            });
          },
        ],
        [
          "extra nested maturity field",
          (r: ReturnType<typeof booking>) => {
            Object.assign(r.earnings.maturity, { reason: "PRIVATE-REASON" });
          },
        ],
      ] as const
    ).map(([name, corrupt]) => {
      const data = recorded();
      corrupt(data.selection.bookings[0]);
      return [name, data] as [string, unknown];
    }),
  ];
  const duplicate = recorded(2);
  for (const row of duplicate.selection.bookings)
    row.refundRecords.push({
      id: uuid(800),
      source: "administrator",
      state: "succeeded",
      bookingPriceFils: 0,
      bookingServiceFeeFils: 0,
      requestedAt: "2026-10-02T00:00:00.123456+00:00",
    });
  malformed.push(["duplicate refund IDs across bookings", duplicate]);
  for (const [label, corrupt] of [
    [
      "bad refund ID",
      (r: ReturnType<typeof booking>["refundRecords"][number]) => {
        r.id = "PRIVATE-ID";
      },
    ],
    [
      "bad refund time",
      (r: ReturnType<typeof booking>["refundRecords"][number]) => {
        r.requestedAt = "not-a-time";
      },
    ],
    [
      "negative refund",
      (r: ReturnType<typeof booking>["refundRecords"][number]) => {
        r.bookingPriceFils = -1;
      },
    ],
    [
      "extra refund field",
      (r: ReturnType<typeof booking>["refundRecords"][number]) => {
        Object.assign(r, { providerPayload: "PRIVATE-PAYLOAD" });
      },
    ],
  ] as const) {
    const data = recorded();
    data.selection.bookings[0].refundRecords.push({
      ...duplicate.selection.bookings[0].refundRecords[0],
    });
    corrupt(data.selection.bookings[0].refundRecords[0]);
    malformed.push([label, data]);
  }

  const overflow = recorded(2);
  for (const row of overflow.selection.bookings) {
    row.earnings.captured = {
      bookingPriceFils: 5_000_000_000_000_000,
      bookingServiceFeeFils: 0,
    };
    row.earnings.marketplaceCommissionAmountFils = 500_000_000_000_000;
  }
  malformed.push(["unsafe aggregate", overflow]);
  for (const [label, data] of malformed) {
    rpc.mockClear();
    reply = data;
    await expect(
      exportAdministratorBookingMoney({}, "en"),
      label,
    ).resolves.toEqual({ status: "unavailable" });
    expect(
      rpc.mock.calls.map(([name]) => name),
      label,
    ).toEqual([
      "is_platform_administrator",
      "record_administrator_booking_money_export",
    ]);
  }
  for (const input of [
    null,
    [],
    { afterAt: "" },
    { afterId: uuid(1) },
    { actor: uuid(1) },
    { limit: "500" },
    { state: 1 },
    { state: "paid" },
    { from: "2026-13-01" },
    { from: "2026-10-02", through: "2026-10-01" },
  ]) {
    rpc.mockClear();
    await expect(exportAdministratorBookingMoney(input, "en")).resolves.toEqual(
      { status: "invalid" },
    );
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "is_platform_administrator",
    ]);
  }
  reply = recorded();
  exportError = { code: "42501", message: "PRIVATE-ERROR" };
  await expect(exportAdministratorBookingMoney({}, "en")).resolves.toEqual({
    status: "access_required",
  });
  exportError = {
    code: "PGRST500",
    message: "PRIVATE-ERROR",
    token: "PRIVATE-SECRET",
  };
  await expect(exportAdministratorBookingMoney({}, "en")).resolves.toEqual({
    status: "unavailable",
  });
  exportError = null;
  rpc.mockClear();
  rpc
    .mockResolvedValueOnce({ data: true, error: null })
    .mockRejectedValueOnce(new Error("PRIVATE-TRANSPORT"));
  await expect(exportAdministratorBookingMoney({}, "en")).resolves.toEqual({
    status: "unavailable",
  });
  expect(rpc.mock.calls.map(([name]) => name)).toEqual([
    "is_platform_administrator",
    "record_administrator_booking_money_export",
  ]);
  for (const role of ["customer", "cottage_owner"]) {
    maybeSingle.mockResolvedValue({
      data: {
        user_id: uuid(700),
        role,
        owner_approval_state: role === "cottage_owner" ? "approved" : null,
      },
      error: null,
    });
    rpc.mockClear();
    await expect(
      exportAdministratorBookingMoney({ state: "paid" }, "en"),
    ).resolves.toEqual({
      status: "access_required",
    });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "is_platform_administrator",
    ]);
  }
  maybeSingle.mockResolvedValue({
    data: {
      user_id: uuid(700),
      role: "platform_administrator",
      owner_approval_state: null,
    },
    error: null,
  });
  for (const [decision, status] of [
    [false, "access_required"],
    [null, "unavailable"],
    ["allowed", "unavailable"],
  ] as const) {
    authorization = decision;
    rpc.mockClear();
    await expect(exportAdministratorBookingMoney({}, "en")).resolves.toEqual({
      status,
    });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "is_platform_administrator",
    ]);
  }
  authorization = true;
  getUser.mockResolvedValue({ data: { user: null }, error: null });
  rpc.mockClear();
  await expect(exportAdministratorBookingMoney({}, "en")).resolves.toEqual({
    status: "access_required",
  });
  expect(rpc.mock.calls.map(([name]) => name)).toEqual([
    "is_platform_administrator",
  ]);
  expect(logged.mock.calls.length).toBeGreaterThan(0);
  for (const call of logged.mock.calls)
    expect(call).toEqual([
      "Administrator records request failed",
      {
        operation: expect.stringMatching(
          /^booking_money_export(?:_authorization)?$/,
        ),
        outcome: "unavailable",
      },
    ]);
  expect(JSON.stringify(logged.mock.calls)).not.toMatch(
    /PRIVATE-|synthetic-secret|synthetic-audit/,
  );
});
