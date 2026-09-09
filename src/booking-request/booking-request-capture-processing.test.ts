import { withRecordedProviderResults } from "../../tests/fixtures/payment-operation-execution.fixtures";
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
    recordFailure: vi.fn(),
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
    processing: createBookingRequestCaptureProcessing(
      withRecordedProviderResults({
        repository,
        provider,
        confirmation: { execute: vi.fn() },
      }),
    ),
  };
}
describe("Booking Request capture processing", () => {
  it("settles Payment Required capture work without confirmation or another execution", async () => {
    const { processing, repository } = setup();
    repository.claimDue.mockResolvedValue([]);
    repository.listQueued.mockResolvedValue(["failed-capture"]);
    repository.lease.mockReset().mockResolvedValue({
      status: "payment-required",
      window: {
        recordedAt: "2099-01-01T00:00:00.000Z",
        deadline: "2099-01-01T00:20:00.000Z",
      },
    });
    await expect(processing.processDue()).resolves.toEqual([
      {
        status: "payment-required",
        window: {
          recordedAt: "2099-01-01T00:00:00.000Z",
          deadline: "2099-01-01T00:20:00.000Z",
        },
      },
    ]);
  });
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
