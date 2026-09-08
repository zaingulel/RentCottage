import { expect, it, vi } from "vitest";

import { getAdministratorPaymentHistory } from "./supabase-administrator-payment-history";

const client = (result: unknown) =>
  ({ rpc: vi.fn().mockResolvedValue(result) }) as never;

it("classifies PostgreSQL 42501 as AAL2 access required", async () => {
  await expect(
    getAdministratorPaymentHistory(
      client({ data: null, error: { code: "42501" } }),
      "RC-REQ-0000000000000137",
    ),
  ).resolves.toEqual({ status: "access_required" });
});

it("distinguishes unknown references from provider failure", async () => {
  await expect(
    getAdministratorPaymentHistory(
      client({ data: null, error: null }),
      "RC-REQ-0000000000000137",
    ),
  ).resolves.toEqual({ status: "not_found" });
  await expect(
    getAdministratorPaymentHistory(
      client({ data: null, error: { code: "XX000" } }),
      "RC-REQ-0000000000000137",
    ),
  ).rejects.toThrow("unavailable");
});

it("parses a successful support-safe result", async () => {
  const data = {
    bookingRequestReference: "RC-REQ-0000000000000137",
    simulated: true,
    current: {
      requestStatus: "accepted",
      paymentStatus: "paid-confirmed",
      expiryStatus: null,
      reasonCode: null,
      paymentRequiredDeadline: null,
    },
    historyCoverage: "complete",
    events: [
      {
        id: "10000000-0000-4000-8000-000000000137",
        kind: "terminal-outcome",
        source: "confirmation",
        provenance: "observed",
        recordedAt: "2026-09-08T10:00:00+00:00",
      },
    ],
  };
  await expect(
    getAdministratorPaymentHistory(
      client({ data, error: null }),
      "RC-REQ-0000000000000137",
    ),
  ).resolves.toEqual({ status: "ready", history: data });
});
