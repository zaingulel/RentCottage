import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabasePaymentOperationExecutionRepository } from "./supabase-payment-operation-execution";
import {
  bookingSettlementPermitFrom,
  bookingSettlementRequestMatches,
  type BookingSettlementExecutionPermit,
} from "./booking-settlement-contract";
const intentId = "90000000-0000-4000-8000-000000003810";
const identity = {
  provider: "fictional-payments",
  environment: "local-test",
  merchantId: "fictional-merchant",
  terminalId: "fictional-terminal",
};
const permit: BookingSettlementExecutionPermit = {
  purpose: "booking-settlement",
  attemptId: "91000000-0000-4000-8000-000000003810",
  generation: 2,
  leaseToken: "92000000-0000-4000-8000-000000003810",
  idempotencyKey: `${intentId}:settlement:2`,
  notBefore: "2026-09-11T20:00:00.000Z",
  notAfter: "2026-09-11T20:00:30.000Z",
  binding: {
    kind: "settlement",
    bookingRequestId: "60000000-0000-4000-8000-000000001001",
    settlementIntentId: intentId,
    captureOperationId: "80000000-0000-4000-8000-000000001001",
    paymentLifecycleId: "73000000-0000-4000-8000-000000001001",
    logicalOperationId: `${intentId}:settlement`,
    attemptId: `${intentId}:settlement:2`,
    amountFils: 90000000,
    currency: "IQD",
    requestFingerprint: "a".repeat(64),
    providerIdentity: identity,
  },
};
describe("booking settlement execution binding", () => {
  it("keeps the captured source and exact physical generation with an explicit partial amount", () => {
    expect(bookingSettlementPermitFrom(permit)).toEqual(permit);
    expect(
      bookingSettlementRequestMatches(permit.binding, permit, identity),
    ).toBe(true);
  });
  const withBinding = (change: object) => ({
    ...permit,
    binding: { ...permit.binding, ...change },
  });
  const named = (id: string, generation: number) => ({
    ...permit,
    generation,
    idempotencyKey: `${id}:settlement:${generation}`,
    binding: {
      ...permit.binding,
      settlementIntentId: id,
      logicalOperationId: `${id}:settlement`,
      attemptId: `${id}:settlement:${generation}`,
    },
  });
  const invalidPermits: [string, unknown][] = [
    ["no permit", null],
    ["purpose", { ...permit, purpose: "booking-refund" }],
    ["missing binding", { ...permit, binding: null }],
    ["operation kind", withBinding({ kind: "refund" })],
    ["attempt identifier", { ...permit, attemptId: "unbound" }],
    ["lease token", { ...permit, leaseToken: "unbound" }],
    [
      "Booking Request identifier",
      withBinding({ bookingRequestId: "unbound" }),
    ],
    ["settlement intent identifier", named("unbound", 2)],
    [
      "capture operation identifier",
      withBinding({ captureOperationId: "unbound" }),
    ],
    [
      "Payment Lifecycle identifier",
      withBinding({ paymentLifecycleId: "unbound" }),
    ],
    ["generation below one", named(intentId, 0)],
    ["fractional generation", named(intentId, 1.5)],
    ["unreadable lease start", { ...permit, notBefore: "not-a-time" }],
    ["lease end equal to its start", { ...permit, notAfter: permit.notBefore }],
    [
      "lease start that is not text",
      { ...permit, notBefore: [permit.notBefore] },
    ],
    ["lease end that is not text", { ...permit, notAfter: [permit.notAfter] }],
    [
      "logical operation name",
      withBinding({ logicalOperationId: `${intentId}:refund` }),
    ],
    [
      "generation that disagrees with the attempt name",
      { ...permit, generation: 1 },
    ],
    [
      "idempotency key",
      { ...permit, idempotencyKey: `${intentId}:settlement:3` },
    ],
    ["zero amount", withBinding({ amountFils: 0 })],
    ["fractional amount", withBinding({ amountFils: 0.1 })],
    ["currency", withBinding({ currency: "USD" })],
    [
      "short request fingerprint",
      withBinding({ requestFingerprint: "a".repeat(63) }),
    ],
    [
      "upper-case request fingerprint",
      withBinding({ requestFingerprint: "A".repeat(64) }),
    ],
    [
      "request fingerprint that is not text",
      withBinding({ requestFingerprint: ["a".repeat(64)] }),
    ],
    ["missing provider identity", withBinding({ providerIdentity: null })],
    [
      "empty provider",
      withBinding({ providerIdentity: { ...identity, provider: "" } }),
    ],
    [
      "empty provider environment",
      withBinding({ providerIdentity: { ...identity, environment: "" } }),
    ],
    [
      "empty merchant",
      withBinding({ providerIdentity: { ...identity, merchantId: "" } }),
    ],
    [
      "empty terminal",
      withBinding({ providerIdentity: { ...identity, terminalId: "" } }),
    ],
    ["extra field", { ...permit, unrelatedEvidence: true }],
    ["extra binding field", withBinding({ unrelatedEvidence: true })],
    [
      "extra provider identity field",
      withBinding({
        providerIdentity: { ...identity, unrelatedEvidence: true },
      }),
    ],
  ];
  it.each(invalidPermits)(
    "rejects invalid durable execution authority: %s",
    (_rule, value) => {
      expect(() => bookingSettlementPermitFrom(value)).toThrow(
        "Settlement permit is invalid",
      );
      expect(
        bookingSettlementRequestMatches(permit.binding, value, identity),
      ).toBe(false);
    },
  );
  it("rejects a changed amount before shared provider execution", () => {
    expect(
      bookingSettlementRequestMatches(
        { ...permit.binding, amountFils: 115000000 },
        permit,
        identity,
      ),
    ).toBe(false);
  });
  it("rejects a changed physical identity before shared provider execution", () => {
    expect(
      bookingSettlementRequestMatches(
        { ...permit.binding, attemptId: `${intentId}:settlement:3` },
        permit,
        identity,
      ),
    ).toBe(false);
  });
  it("rejects provider account drift before shared provider execution", () => {
    expect(
      bookingSettlementRequestMatches(permit.binding, permit, {
        ...identity,
        merchantId: "another-merchant",
      }),
    ).toBe(false);
  });
});

describe("shared settlement provider repository", () => {
  const fixture = () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: { status: "not-admitted" }, error: null });
    return {
      rpc,
      repository: new SupabasePaymentOperationExecutionRepository({
        rpc,
      } as unknown as SupabaseClient),
    };
  };
  it("routes the bound permit to durable settlement admission", async () => {
    const test = fixture();
    expect(
      await test.repository.admit(
        { ...permit.binding, executionPermit: permit },
        identity,
      ),
    ).toEqual({ status: "not-admitted" });
    expect(test.rpc).toHaveBeenCalledExactlyOnceWith(
      "admit_booking_settlement",
      {
        target_permit: permit,
      },
    );
  });
  it("does not ask the database to admit a changed amount", async () => {
    const test = fixture();
    await expect(
      test.repository.admit(
        { ...permit.binding, amountFils: 115000000, executionPermit: permit },
        identity,
      ),
    ).rejects.toThrow("does not match");
    expect(test.rpc).not.toHaveBeenCalled();
  });
  it("reconciles with the durable command fingerprint and original physical identity", async () => {
    const test = fixture();
    expect(
      await test.repository.reload(
        {
          ...permit.binding,
          settlementPermit: permit,
          providerRequestId: null,
          providerReference: null,
        },
        identity,
      ),
    ).toEqual({ status: "not-admitted" });
    expect(test.rpc).toHaveBeenCalledExactlyOnceWith(
      "reload_booking_request_payment_operation",
      {
        target_operation: {
          providerIdentity: identity,
          paymentLifecycleId: permit.binding.paymentLifecycleId,
          logicalOperationId: permit.binding.logicalOperationId,
          physicalAttemptId: permit.binding.attemptId,
          operationKind: "settlement",
          amountFils: 90000000,
          currency: "IQD",
          requestFingerprint: permit.binding.requestFingerprint,
        },
        target_provider_request_id: null,
        target_provider_reference: null,
      },
    );
  });
  it("refuses a changed provider identity during reconciliation", async () => {
    const test = fixture();
    await expect(
      test.repository.reload(
        {
          ...permit.binding,
          settlementPermit: permit,
          providerRequestId: null,
          providerReference: null,
        },
        { ...identity, merchantId: "another-merchant" },
      ),
    ).rejects.toThrow("permit is invalid");
    expect(test.rpc).not.toHaveBeenCalled();
  });
});
