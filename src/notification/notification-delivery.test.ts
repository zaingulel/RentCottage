import { describe, expect, it, vi } from "vitest";

import { createPaidConfirmationNotificationDelivery } from "./notification-delivery";
import type {
  NotificationDeliveryAdapter,
  NotificationDeliveryRepository,
  NotificationLease,
} from "./notification-delivery";

const candidate = {
  receiptId: "00000000-0000-4000-8000-000000000035",
  recipientUserId: "00000000-0000-4000-8000-000000000036",
  recipientRole: "customer" as const,
  bookingRequestReference: "RC-REQ-AAAAAAAAAAAAAAAA",
  bookingReference: "CONFIRMED-BOOKING-35",
  locale: "en" as const,
};
const lease: NotificationLease = {
  ...candidate,
  logicalId: `paid-confirmation:${candidate.receiptId}`,
  templateVersion: "paid-confirmation-v1",
  payload: {
    kind: "paid-confirmation",
    title: "Booking confirmed",
    body: "Your booking CONFIRMED-BOOKING-35 is confirmed and paid.",
    bookingReference: "CONFIRMED-BOOKING-35",
    detailsPath: "/en/booking-requests/RC-REQ-AAAAAAAAAAAAAAAA",
    linkLabel: "View confirmed booking",
    fictional: true,
  },
  payloadSha256: "a".repeat(64),
  leaseGeneration: 1,
  leaseToken: "00000000-0000-4000-8000-000000000037",
  leaseExpiresAt: "2099-08-21T10:05:00.000Z",
};

function setup() {
  const repository: NotificationDeliveryRepository = {
    listCandidates: vi.fn().mockResolvedValue([candidate]),
    prepare: vi.fn().mockResolvedValue(undefined),
    lease: vi.fn().mockResolvedValue(lease),
    completeDelivered: vi.fn().mockResolvedValue({
      status: "delivered",
      historical: false,
    }),
    recordFailure: vi.fn().mockResolvedValue({ status: "retryable" }),
    recordUnknown: vi.fn().mockResolvedValue({ status: "uncertain" }),
  };
  const adapter: NotificationDeliveryAdapter = {
    query: vi.fn().mockResolvedValue({ status: "not-found" }),
    execute: vi.fn().mockResolvedValue({
      status: "delivered",
      effectId: "00000000-0000-4000-8000-000000000038",
      supplierDeliveryReference: "fictional-notice-35",
      executedAt: "2099-08-21T10:00:00.000Z",
    }),
  };
  return { repository, adapter };
}

describe("paid confirmation notification delivery", () => {
  it("queries before first execution and completes from one effect", async () => {
    const { repository, adapter } = setup();
    const delivery = createPaidConfirmationNotificationDelivery({
      repository,
      adapter,
    });

    await expect(delivery.processDue(10)).resolves.toEqual([
      { status: "delivered", historical: false },
    ]);
    expect(adapter.query).toHaveBeenCalledExactlyOnceWith(lease);
    expect(adapter.execute).toHaveBeenCalledExactlyOnceWith(lease);
    expect(repository.completeDelivered).toHaveBeenCalledWith(
      lease,
      expect.objectContaining({ status: "delivered" }),
    );
  });

  it("reconciles a crash-persisted supplier effect without executing again", async () => {
    const { repository, adapter } = setup();
    vi.mocked(adapter.query).mockResolvedValue({
      status: "found",
      effectId: "00000000-0000-4000-8000-000000000038",
      supplierDeliveryReference: "fictional-notice-35",
      executedAt: "2099-08-21T10:00:00.000Z",
    });

    await createPaidConfirmationNotificationDelivery({
      repository,
      adapter,
    }).processDue(10);

    expect(adapter.execute).not.toHaveBeenCalled();
    expect(repository.completeDelivered).toHaveBeenCalledExactlyOnceWith(
      lease,
      expect.objectContaining({ status: "found" }),
    );
  });

  it.each([
    ["failed", "recordFailure", "retryable"],
    ["unknown", "recordUnknown", "uncertain"],
  ] as const)(
    "keeps a supplier %s truthful",
    async (status, recorder, expected) => {
      const { repository, adapter } = setup();
      vi.mocked(adapter.execute).mockResolvedValue({ status });

      await expect(
        createPaidConfirmationNotificationDelivery({
          repository,
          adapter,
        }).processDue(10),
      ).resolves.toEqual([{ status: expected }]);
      expect(repository[recorder]).toHaveBeenCalledExactlyOnceWith(lease);
      expect(repository.completeDelivered).not.toHaveBeenCalled();
    },
  );

  it("does not let stale work write an outcome", async () => {
    const { repository, adapter } = setup();
    vi.mocked(adapter.query).mockResolvedValue({ status: "stale" });
    await expect(
      createPaidConfirmationNotificationDelivery({
        repository,
        adapter,
      }).processDue(10),
    ).resolves.toEqual([{ status: "stale" }]);
    expect(adapter.execute).not.toHaveBeenCalled();
    expect(repository.completeDelivered).not.toHaveBeenCalled();
  });

  it("retains a database suppression without inventing delivery", async () => {
    const { repository, adapter } = setup();
    vi.mocked(adapter.execute).mockResolvedValue({ status: "suppressed" });
    await expect(
      createPaidConfirmationNotificationDelivery({
        repository,
        adapter,
      }).processDue(10),
    ).resolves.toEqual([{ status: "suppressed" }]);
    expect(repository.completeDelivered).not.toHaveBeenCalled();
  });

  it.each(["query", "complete"] as const)(
    "records an uncertain lease and surfaces a %s interruption",
    async (operation) => {
      const { repository, adapter } = setup();
      if (operation === "query")
        vi.mocked(adapter.query).mockRejectedValue(
          new Error("query interrupted"),
        );
      else
        vi.mocked(repository.completeDelivered).mockRejectedValue(
          new Error("completion interrupted"),
        );

      await expect(
        createPaidConfirmationNotificationDelivery({
          repository,
          adapter,
        }).processDue(10),
      ).rejects.toThrow(
        `${operation === "query" ? "query" : "completion"} interrupted`,
      );
      expect(repository.recordUnknown).toHaveBeenCalledExactlyOnceWith(lease);
    },
  );
});
