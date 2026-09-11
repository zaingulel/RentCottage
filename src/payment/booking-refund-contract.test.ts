import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabasePaymentOperationExecutionRepository } from "./supabase-payment-operation-execution";
import {
  bookingRefundPermitFrom,
  bookingRefundRequestMatches,
  type BookingRefundExecutionPermit,
} from "./booking-refund-contract";
const intentId = "90000000-0000-4000-8000-000000003810";
const identity = {
  provider: "fictional-payments",
  environment: "local-test",
  merchantId: "fictional-merchant",
  terminalId: "fictional-terminal",
};
const permit: BookingRefundExecutionPermit = {
  purpose: "booking-refund",
  attemptId: "91000000-0000-4000-8000-000000003810",
  generation: 2,
  leaseToken: "92000000-0000-4000-8000-000000003810",
  idempotencyKey: `${intentId}:refund:2`,
  notBefore: "2026-09-11T20:00:00.000Z",
  notAfter: "2026-09-11T20:00:30.000Z",
  binding: {
    kind: "refund",
    bookingRequestId: "60000000-0000-4000-8000-000000001001",
    refundIntentId: intentId,
    captureOperationId: "80000000-0000-4000-8000-000000001001",
    paymentLifecycleId: "73000000-0000-4000-8000-000000001001",
    logicalOperationId: `${intentId}:refund`,
    attemptId: `${intentId}:refund:2`,
    amountFils: 31000000,
    currency: "IQD",
    requestFingerprint: "a".repeat(64),
    providerIdentity: identity,
  },
};
describe("booking refund execution binding", () => {
  it("keeps the captured source and exact physical generation with an explicit partial amount", () => {
    expect(bookingRefundPermitFrom(permit)).toEqual(permit);
    expect(bookingRefundRequestMatches(permit.binding, permit, identity)).toBe(
      true,
    );
  });
  it.each([
    { ...permit, generation: 1 },
    { ...permit, notAfter: permit.notBefore },
    {
      ...permit,
      binding: { ...permit.binding, captureOperationId: "unbound" },
    },
    { ...permit, binding: { ...permit.binding, amountFils: 0 } },
    { ...permit, binding: { ...permit.binding, amountFils: 0.1 } },
  ])("rejects invalid durable execution authority", (value) => {
    expect(() => bookingRefundPermitFrom(value)).toThrow(
      "Refund permit is invalid",
    );
  });
  it("rejects a changed amount before shared provider execution", () => {
    expect(
      bookingRefundRequestMatches(
        { ...permit.binding, amountFils: 115000000 },
        permit,
        identity,
      ),
    ).toBe(false);
  });
  it("rejects a changed physical identity before shared provider execution", () => {
    expect(
      bookingRefundRequestMatches(
        { ...permit.binding, attemptId: `${intentId}:refund:3` },
        permit,
        identity,
      ),
    ).toBe(false);
  });
  it("rejects provider account drift before shared provider execution", () => {
    expect(
      bookingRefundRequestMatches(permit.binding, permit, {
        ...identity,
        merchantId: "another-merchant",
      }),
    ).toBe(false);
  });
});

describe("shared refund provider repository", () => {
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
  it("routes the bound permit to durable refund admission", async () => {
    const test = fixture();
    expect(
      await test.repository.admit(
        { ...permit.binding, executionPermit: permit },
        identity,
      ),
    ).toEqual({ status: "not-admitted" });
    expect(test.rpc).toHaveBeenCalledExactlyOnceWith("admit_booking_refund", {
      target_permit: permit,
    });
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
          refundPermit: permit,
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
          operationKind: "refund",
          amountFils: 31000000,
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
          refundPermit: permit,
          providerRequestId: null,
          providerReference: null,
        },
        { ...identity, merchantId: "another-merchant" },
      ),
    ).rejects.toThrow("permit is invalid");
    expect(test.rpc).not.toHaveBeenCalled();
  });
});
