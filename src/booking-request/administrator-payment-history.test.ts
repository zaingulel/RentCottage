import { expect, it } from "vitest";

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
