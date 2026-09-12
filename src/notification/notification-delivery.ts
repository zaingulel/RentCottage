import {
  bookingEventNotice,
  type BookingEventNotice,
  type BookingNoticeEvent,
} from "./booking-event-notice";
import {
  paidConfirmationNotice,
  type PaidConfirmationNotice,
  type PaidConfirmationNoticeLocale,
  type PaidConfirmationRecipientRole,
} from "./paid-confirmation-notice";

export interface NotificationCandidate {
  readonly receiptId: string;
  readonly event?: BookingNoticeEvent;
  readonly recipientUserId: string;
  readonly recipientRole: PaidConfirmationRecipientRole;
  readonly bookingRequestReference: string;
  readonly bookingReference: string;
  readonly locale: PaidConfirmationNoticeLocale;
}

export interface NotificationBinding extends NotificationCandidate {
  readonly logicalId: string;
  readonly templateVersion: "paid-confirmation-v1" | "booking-event-v1";
  readonly payload: PaidConfirmationNotice | BookingEventNotice;
}

export interface NotificationLease extends NotificationBinding {
  readonly payloadSha256: string;
  readonly leaseGeneration: number;
  readonly leaseToken: string;
  readonly leaseExpiresAt: string;
}

export type NotificationEffect = {
  readonly effectId: string;
  readonly supplierDeliveryReference: string;
  readonly executedAt: string;
};

export type NotificationQueryResult =
  | ({ readonly status: "found" } & NotificationEffect)
  | { readonly status: "not-found" | "stale" };

export type NotificationExecuteResult =
  | ({ readonly status: "delivered" } & NotificationEffect)
  | { readonly status: "failed" | "unknown" | "stale" | "suppressed" };

export interface NotificationDeliveryAdapter {
  query(lease: NotificationLease): Promise<NotificationQueryResult>;
  execute(lease: NotificationLease): Promise<NotificationExecuteResult>;
}

export type NotificationDeliveryResult =
  | { readonly status: "delivered"; readonly historical: boolean }
  | {
      readonly status:
        | "retryable"
        | "uncertain"
        | "stale"
        | "suppressed"
        | "unavailable";
    };

export interface NotificationDeliveryRepository {
  listCandidates(limit: number): Promise<readonly NotificationCandidate[]>;
  prepare(binding: NotificationBinding): Promise<void>;
  lease(receiptId: string, eventId?: string): Promise<NotificationLease | null>;
  completeDelivered(
    lease: NotificationLease,
    effect: { readonly status: "found" | "delivered" } & NotificationEffect,
  ): Promise<NotificationDeliveryResult>;
  recordFailure(lease: NotificationLease): Promise<NotificationDeliveryResult>;
  recordUnknown(lease: NotificationLease): Promise<NotificationDeliveryResult>;
}

function bindingFor(candidate: NotificationCandidate): NotificationBinding {
  if (candidate.event)
    return {
      ...candidate,
      logicalId: `booking-event:${candidate.event.id}`,
      templateVersion: "booking-event-v1",
      payload: bookingEventNotice({ ...candidate, event: candidate.event }),
    };
  return {
    ...candidate,
    logicalId: `paid-confirmation:${candidate.receiptId}`,
    templateVersion: "paid-confirmation-v1",
    payload: paidConfirmationNotice(candidate),
  };
}

export function createBookingNotificationDelivery({
  repository,
  adapter,
}: {
  readonly repository: NotificationDeliveryRepository;
  readonly adapter: NotificationDeliveryAdapter;
}) {
  async function processCandidate(
    candidate: NotificationCandidate,
  ): Promise<NotificationDeliveryResult> {
    await repository.prepare(bindingFor(candidate));
    const lease = candidate.event
      ? await repository.lease(candidate.receiptId, candidate.event.id)
      : await repository.lease(candidate.receiptId);
    if (!lease) return { status: "unavailable" };

    let queried: NotificationQueryResult;
    try {
      queried = await adapter.query(lease);
    } catch (error) {
      await repository.recordUnknown(lease);
      throw error;
    }
    if (queried.status === "found")
      try {
        return await repository.completeDelivered(lease, queried);
      } catch (error) {
        await repository.recordUnknown(lease);
        throw error;
      }
    if (queried.status === "stale") return { status: "stale" };

    let executed: NotificationExecuteResult;
    try {
      executed = await adapter.execute(lease);
    } catch {
      return repository.recordUnknown(lease);
    }
    switch (executed.status) {
      case "delivered":
        try {
          return await repository.completeDelivered(lease, executed);
        } catch (error) {
          await repository.recordUnknown(lease);
          throw error;
        }
      case "failed":
        return repository.recordFailure(lease);
      case "unknown":
        return repository.recordUnknown(lease);
      case "stale":
        return { status: "stale" };
      case "suppressed":
        return { status: "suppressed" };
    }
  }

  return {
    async processDue(limit: number): Promise<NotificationDeliveryResult[]> {
      const candidates = await repository.listCandidates(limit);
      const results: NotificationDeliveryResult[] = [];
      const failures: unknown[] = [];
      for (const candidate of candidates) {
        try {
          results.push(await processCandidate(candidate));
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length > 0)
        throw new AggregateError(failures, "Booking notification batch failed");
      return results;
    },
  };
}
