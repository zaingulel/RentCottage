import { describe, expect, it, vi } from "vitest";
import type { PaymentProviderAdapter } from "@/payment/payment-contract";
import { createBookingRequestCaptureProcessing } from "./booking-request-capture-processing";

function setup() {
  const repository = {
    claimDue: vi.fn().mockResolvedValue([{ status: "unavailable" }]),
    listQueued: vi.fn().mockResolvedValue(["queued-first", "queued-second"]),
    lease: vi
      .fn()
      .mockRejectedValueOnce(new Error("item unavailable"))
      .mockResolvedValue({ status: "processing" }),
    complete: vi.fn(),
  };
  const provider: PaymentProviderAdapter = {
    identity: {
      provider: "fictional-payments",
      environment: "local-test",
      merchantId: "fictional-merchant",
      terminalId: "fictional-terminal",
    },
    execute: vi.fn(),
    query: vi.fn(),
    verifySignedEvent: () => false,
  };
  return {
    repository,
    processing: createBookingRequestCaptureProcessing({
      repository,
      provider,
      confirmation: { execute: vi.fn() },
    }),
  };
}
describe("Booking Request capture processing", () => {
  it("reports unavailable recovery and capture independently while continuing the next queued request", async () => {
    const { processing } = setup();
    await expect(processing.processDue()).resolves.toEqual([
      { status: "unavailable" },
      { status: "unavailable" },
      { status: "processing" },
    ]);
  });
  it("continues queued work when recovery selection is unavailable", async () => {
    const { processing, repository } = setup();
    repository.claimDue.mockRejectedValue(new Error("recovery unavailable"));
    await expect(processing.processDue()).resolves.toEqual([
      { status: "unavailable" },
      { status: "unavailable" },
      { status: "processing" },
    ]);
  });
  it.each([0, 51, 1.5, NaN, Infinity])(
    "rejects invalid bound %s before access",
    async (limit) => {
      const { processing, repository } = setup();
      await expect(processing.processDue(limit)).resolves.toEqual([
        { status: "invalid" },
      ]);
      expect(repository.claimDue).not.toHaveBeenCalled();
      expect(repository.listQueued).not.toHaveBeenCalled();
    },
  );
});
