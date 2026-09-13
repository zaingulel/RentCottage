import { expect, it, vi } from "vitest";
import {
  createBookingNotificationDelivery,
  type NotificationBinding,
  type NotificationCandidate,
  type NotificationLease,
} from "./notification-delivery";
const eventId = "00000000-0000-4000-8000-000000000228";
const candidate: NotificationCandidate = {
  receiptId: null,
  bookingReference: null,
  event: {
    id: eventId,
    sourceId: "00000000-0000-4000-8000-000000000229",
    kind: "request_new",
    deadlineAt: "2101-01-01T08:00:00Z",
  },
  recipientUserId: "00000000-0000-4000-8000-000000000230",
  recipientRole: "cottage_owner",
  bookingRequestReference: "RC-REQ-0000000000000228",
  locale: "ckb",
};
it.each([false, true])(
  "request delivery reconciles durable effects first: historical=%s",
  async (historical) => {
    const calls: string[] = [];
    let prepared: NotificationBinding;
    const effect = {
      effectId: "effect",
      supplierDeliveryReference: "fictional",
      executedAt: "2101-01-01T00:00:00Z",
    };
    const repository = {
      listCandidates: async () => [candidate],
      prepare: async (binding: NotificationBinding) => {
        calls.push("prepare");
        prepared = binding;
      },
      lease: async (receiptId: string | null, id?: string) => {
        expect(receiptId).toBeNull();
        expect(id).toBe(eventId);
        calls.push("lease");
        return {
          ...prepared,
          payloadSha256: "a".repeat(64),
          leaseGeneration: 1,
          leaseToken: "token",
          leaseExpiresAt: "2101-01-01T01:00:00Z",
        } as NotificationLease;
      },
      completeDelivered: async () => {
        calls.push("complete");
        return { status: "delivered" as const, historical };
      },
      recordFailure: vi.fn(),
      recordUnknown: vi.fn(),
    };
    const adapter = {
      query: async () => {
        calls.push("query");
        return historical
          ? { status: "found" as const, ...effect }
          : { status: "not-found" as const };
      },
      execute: async () => {
        calls.push("execute");
        return { status: "delivered" as const, ...effect };
      },
    };
    await expect(
      createBookingNotificationDelivery({ repository, adapter }).processDue(10),
    ).resolves.toEqual([{ status: "delivered", historical }]);
    expect(calls).toEqual(
      historical
        ? ["prepare", "lease", "query", "complete"]
        : ["prepare", "lease", "query", "execute", "complete"],
    );
    expect(prepared!).toMatchObject({
      logicalId: `booking-event:${eventId}`,
      locale: "ckb",
      recipientRole: "cottage_owner",
      receiptId: null,
      payload: {
        bookingReference: null,
        kind: "request_new",
        linkLabel: "بینینی داواکاری حجز",
      },
    });
  },
);
