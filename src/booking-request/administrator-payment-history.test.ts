import { expect, it } from "vitest";

import { administratorPaymentHistoryCodeMessages } from "@/i18n/administrator-payment-history-messages";

import { parseAdministratorPaymentHistory } from "./administrator-payment-history";

const event = {
  id: "10000000-0000-4000-8000-000000000137",
  kind: "physical-attempt",
  source: "provider-operation",
  provenance: "observed",
  operationKind: "capture",
  amountFils: "105000000",
  currency: "IQD",
  providerOccurredAt: "2026-09-08T10:00:00.123456+00:00",
  recordedAt: "2026-09-08T10:00:01.123456+00:00",
};
const history = {
  bookingRequestReference: "RC-REQ-0000000000000137",
  simulated: true,
  current: {
    requestStatus: "accepted",
    paymentStatus: "payment-required",
    expiryStatus: null,
    reasonCode: null,
    paymentRequiredDeadline: "2026-09-08T12:00:00+00:00",
  },
  historyCoverage: "complete",
  events: [event],
};

it("accepts the closed support-safe wire shape with microsecond timestamps", () => {
  expect(parseAdministratorPaymentHistory(history)).toEqual(history);
});

const operationId = "20000000-0000-4000-8000-000000000137";
it.each([
  ["providerRequestId", "request"],
  ["providerReference", "reference"],
  ["movementReference", "movement"],
])(
  "validates the exact operation-bound internal alias for %s",
  (field, kind) => {
    const value = {
      ...event,
      providerOperationId: operationId,
      [field]: `internal-${kind}:${operationId}`,
    };
    expect(
      parseAdministratorPaymentHistory({ ...history, events: [value] })
        .events[0],
    ).toEqual(value);
    for (const invalid of [
      `internal-${kind}:${operationId}-private`,
      `internal-${kind}:secret`,
      `internal-wrong:${operationId}`,
      `internal-${kind}:${event.id}`,
    ]) {
      expect(() =>
        parseAdministratorPaymentHistory({
          ...history,
          events: [{ ...value, [field]: invalid }],
        }),
      ).toThrow("invalid");
    }
    for (const invalid of [
      "private-provider-token",
      `sim-${kind}:${operationId}`,
      `sim-${kind}-${operationId}-private`,
    ]) {
      expect(() =>
        parseAdministratorPaymentHistory({
          ...history,
          events: [{ ...value, [field]: invalid }],
        }),
      ).toThrow("invalid");
    }
    for (const safe of [
      "reference-unavailable",
      `sim-${kind}-${operationId}`,
      `sim-capture-${kind}-${operationId.replaceAll("-", "")}`,
    ]) {
      expect(
        parseAdministratorPaymentHistory({
          ...history,
          events: [{ ...value, [field]: safe }],
        }).events[0],
      ).toEqual({ ...value, [field]: safe });
    }
  },
);

it.each([
  { ...history, simulated: false },
  { ...history, rawPayload: "must not enter the display model" },
  { ...history, current: { ...history.current, customerName: "private" } },
  {
    ...history,
    current: { ...history.current, paymentRequiredDeadline: undefined },
  },
  { ...history, events: [{ ...event, amountFils: "0" }] },
  { ...history, events: [{ ...event, amountFils: "9223372036854775808" }] },
  { ...history, events: [{ ...event, currency: undefined }] },
  { ...history, events: [{ ...event, source: "raw-webhook" }] },
  {
    ...history,
    events: [{ ...event, reasonCode: "customer name in diagnostic" }],
  },
  { ...history, events: [{ ...event, signedPayload: "private" }] },
  { ...history, bookingRequestReference: "customer-phone-0750" },
  { ...history, events: [{ ...event, id: "not-a-uuid" }] },
  { ...history, events: [{ ...event, amountFils: "105.00" }] },
  { ...history, events: [{ ...event, recordedAt: "unknown" }] },
  { ...history, events: [event, event] },
])("rejects malformed or ambiguous provider data", (value) => {
  expect(() => parseAdministratorPaymentHistory(value)).toThrow("invalid");
});

// Finite reasons emitted by the canonical correction and expiry procedures.
it.each([
  "replacement-capture-succeeded",
  "source-evidence-invalid",
  "capture-occurrence-unknown",
  "original-capture-unresolved",
  "recovery-evidence-invalid",
  "unexplained-recovery-provider-operation",
  "recovery-operation-indeterminate",
  "corrective-capture-invalid",
  "unexplained-provider-operation",
  "original-release-indeterminate",
  "original-release-failed",
  "replacement-authorization-invalid",
  "replacement-release-indeterminate",
  "replacement-release-failed",
  "expiry-evidence-invalid",
  "expiry-release-failed",
  "expiry-release-indeterminate",
  "expiry-refund-failed",
  "expiry-refund-indeterminate",
  "inventory-evidence-invalid",
  "legacy-unresolved-money",
  "legacy-confirmation-evidence-invalid",
  "unsafe-recovery-original-release-indeterminate",
  "unsafe-recovery-original-release-failed",
  "unsafe-recovery-replacement-authorization-indeterminate",
  "unsafe-recovery-replacement-capture-indeterminate",
  "unsafe-recovery-replacement-release-indeterminate",
  "unsafe-recovery-replacement-release-failed",
])(
  "retains and labels canonical support reason %s in every locale",
  (reasonCode) => {
    const value = {
      ...history,
      current: { ...history.current, reasonCode },
      events: [{ ...event, reasonCode }],
    };
    expect(parseAdministratorPaymentHistory(value)).toEqual(value);
    for (const messages of Object.values(
      administratorPaymentHistoryCodeMessages,
    )) {
      expect(messages[reasonCode as keyof typeof messages]).toBeTruthy();
      expect(messages[reasonCode as keyof typeof messages]).not.toBe(
        reasonCode,
      );
    }
  },
);
