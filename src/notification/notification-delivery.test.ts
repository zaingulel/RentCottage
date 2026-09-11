import { describe, expect, it, vi } from "vitest";

import { createBookingNotificationDelivery } from "./notification-delivery";
import type {
  NotificationCandidate,
  NotificationDeliveryAdapter,
  NotificationDeliveryRepository,
  NotificationLease,
} from "./notification-delivery";

const candidate: NotificationCandidate = {
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
const secondCandidate = {
  ...candidate,
  receiptId: "00000000-0000-4000-8000-000000000045",
  recipientUserId: "00000000-0000-4000-8000-000000000046",
  recipientRole: "cottage_owner" as const,
};
const secondLease: NotificationLease = {
  ...lease,
  ...secondCandidate,
  logicalId: `paid-confirmation:${secondCandidate.receiptId}`,
  payload: {
    ...lease.payload,
    detailsPath: `/en/owner/booking-requests/${secondCandidate.bookingRequestReference}`,
  },
  leaseGeneration: 2,
  leaseToken: "00000000-0000-4000-8000-000000000047",
};

function setup(candidates = [candidate]) {
  const repository: NotificationDeliveryRepository = {
    listCandidates: vi.fn().mockResolvedValue(candidates),
    prepare: vi.fn().mockResolvedValue(undefined),
    lease: vi
      .fn()
      .mockImplementation(async (receiptId) =>
        receiptId === candidate.receiptId ? lease : secondLease,
      ),
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
  it("delivers requested and returned refund events separately to the same receipt", async () => {
    const candidates = [
      {
        ...candidate,
        event: {
          id: "00000000-0000-4000-8000-000000000081",
          kind: "refund_requested" as const,
          allocation: {
            bookingPriceFils: 30000000,
            bookingServiceFeeFils: 1000000,
          },
        },
      },
      {
        ...candidate,
        event: {
          id: "00000000-0000-4000-8000-000000000082",
          kind: "refund_returned" as const,
          allocation: {
            bookingPriceFils: 30000000,
            bookingServiceFeeFils: 1000000,
          },
        },
      },
    ];
    const { repository, adapter } = setup(candidates);
    await createBookingNotificationDelivery({ repository, adapter }).processDue(
      10,
    );
    expect(repository.prepare).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        logicalId: "booking-event:00000000-0000-4000-8000-000000000081",
        templateVersion: "booking-event-v1",
        payload: expect.objectContaining({
          kind: "refund_requested",
          title: "Refund requested",
          body: expect.stringContaining("IQD 31,000"),
        }),
      }),
    );
    expect(repository.prepare).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        logicalId: "booking-event:00000000-0000-4000-8000-000000000082",
        payload: expect.objectContaining({
          kind: "refund_returned",
          title: "Refund returned",
          body: expect.stringContaining("IQD 31,000"),
        }),
      }),
    );
    expect(repository.lease).toHaveBeenNthCalledWith(
      1,
      candidate.receiptId,
      candidates[0].event.id,
    );
    expect(repository.lease).toHaveBeenNthCalledWith(
      2,
      candidate.receiptId,
      candidates[1].event.id,
    );
  });

  it("queries before first execution and completes from one effect", async () => {
    const { repository, adapter } = setup();
    const delivery = createBookingNotificationDelivery({
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

    await createBookingNotificationDelivery({
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
        createBookingNotificationDelivery({
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
      createBookingNotificationDelivery({
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
      createBookingNotificationDelivery({
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
      const interruption = new Error(
        `${operation === "query" ? "query" : "completion"} interrupted`,
      );
      if (operation === "query")
        vi.mocked(adapter.query).mockRejectedValue(interruption);
      else
        vi.mocked(repository.completeDelivered).mockRejectedValue(interruption);

      await expect(
        createBookingNotificationDelivery({
          repository,
          adapter,
        }).processDue(10),
      ).rejects.toEqual(
        expect.objectContaining({
          name: "AggregateError",
          message: "Booking notification batch failed",
          errors: [interruption],
        }),
      );
      expect(repository.recordUnknown).toHaveBeenCalledExactlyOnceWith(lease);
    },
  );

  it.each(["query", "complete"] as const)(
    "records an uncertain first lease, delivers the next notice, then surfaces the %s interruption",
    async (operation) => {
      const { repository, adapter } = setup([candidate, secondCandidate]);
      const interruption = new Error(`${operation} interrupted`);
      if (operation === "query")
        vi.mocked(adapter.query).mockRejectedValueOnce(interruption);
      else
        vi.mocked(repository.completeDelivered).mockRejectedValueOnce(
          interruption,
        );

      const processing = createBookingNotificationDelivery({
        repository,
        adapter,
      }).processDue(10);

      await expect(processing).rejects.toEqual(
        expect.objectContaining({
          name: "AggregateError",
          errors: [interruption],
        }),
      );
      expect(repository.recordUnknown).toHaveBeenCalledExactlyOnceWith(lease);
      expect(adapter.execute).toHaveBeenCalledWith(secondLease);
      expect(repository.completeDelivered).toHaveBeenCalledWith(
        secondLease,
        expect.objectContaining({ status: "delivered" }),
      );
    },
  );

  it.each(["prepare", "lease", "recordUnknown"] as const)(
    "does not let a first candidate %s failure block a later notice",
    async (operation) => {
      const { repository, adapter } = setup([candidate, secondCandidate]);
      const failure = new Error(`${operation} failed`);
      if (operation === "prepare")
        vi.mocked(repository.prepare).mockRejectedValueOnce(failure);
      else if (operation === "lease")
        vi.mocked(repository.lease).mockRejectedValueOnce(failure);
      else {
        vi.mocked(adapter.query).mockRejectedValueOnce(
          new Error("query interrupted"),
        );
        vi.mocked(repository.recordUnknown).mockRejectedValueOnce(failure);
      }

      const processing = createBookingNotificationDelivery({
        repository,
        adapter,
      }).processDue(10);

      await expect(processing).rejects.toEqual(
        expect.objectContaining({
          name: "AggregateError",
          errors: [failure],
        }),
      );
      expect(adapter.execute).toHaveBeenCalledExactlyOnceWith(secondLease);
      expect(repository.completeDelivered).toHaveBeenCalledExactlyOnceWith(
        secondLease,
        expect.objectContaining({ status: "delivered" }),
      );
    },
  );

  it("reconciles one candidate without a second effect and still delivers the next notice", async () => {
    const { repository, adapter } = setup([candidate, secondCandidate]);
    vi.mocked(adapter.query)
      .mockResolvedValueOnce({
        status: "found",
        effectId: "00000000-0000-4000-8000-000000000038",
        supplierDeliveryReference: "fictional-notice-35",
        executedAt: "2099-08-21T10:00:00.000Z",
      })
      .mockResolvedValueOnce({ status: "not-found" });

    await expect(
      createBookingNotificationDelivery({
        repository,
        adapter,
      }).processDue(10),
    ).resolves.toEqual([
      { status: "delivered", historical: false },
      { status: "delivered", historical: false },
    ]);
    expect(adapter.execute).toHaveBeenCalledExactlyOnceWith(secondLease);
    expect(repository.completeDelivered).toHaveBeenNthCalledWith(
      1,
      lease,
      expect.objectContaining({ status: "found" }),
    );
  });

  it("preserves an empty batch and a candidate-listing failure", async () => {
    const { repository, adapter } = setup([]);
    const delivery = createBookingNotificationDelivery({
      repository,
      adapter,
    });

    await expect(delivery.processDue(10)).resolves.toEqual([]);
    expect(repository.prepare).not.toHaveBeenCalled();

    const listingFailure = new Error("candidate listing failed");
    vi.mocked(repository.listCandidates).mockRejectedValueOnce(listingFailure);
    await expect(delivery.processDue(10)).rejects.toBe(listingFailure);
  });
});
