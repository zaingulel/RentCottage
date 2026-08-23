import type {
  PaymentLifecycleSnapshot,
  PaymentProviderAdapter,
  PaymentProviderIdentity,
  ProviderExecutionPermit,
} from "@/payment/payment-contract";
import { rehydratePaymentAuthorizationLifecycle } from "@/payment/payment-lifecycle";

import { isContactSafeBookingRequestText } from "./booking-request-content";
import type { BookingRequestStatus } from "./booking-request-status";
export type { BookingRequestStatus } from "./booking-request-status";

export const bookingRequestDeclineReasons = [
  "cottage_unavailable",
  "cannot_accommodate_request",
  "other",
] as const;

export type BookingRequestDeclineReason =
  (typeof bookingRequestDeclineReasons)[number];
export type BookingRequestAction =
  | {
      readonly actor: "owner";
      readonly actorUserId: string;
      readonly bookingRequestId: string;
      readonly action: "accept";
    }
  | {
      readonly actor: "owner";
      readonly actorUserId: string;
      readonly bookingRequestId: string;
      readonly action: "decline";
      readonly declineReason: BookingRequestDeclineReason;
      readonly declineNote: string | null;
    }
  | {
      readonly actor: "customer";
      readonly actorUserId: string;
      readonly bookingRequestId: string;
      readonly action: "withdraw";
    };

export type BookingRequestLifecycleResult =
  | {
      readonly status: BookingRequestStatus;
      readonly bookingRequestReference: string;
    }
  | { readonly status: "access-required" | "invalid" | "unavailable" };

export interface BookingRequestReleaseWork {
  readonly status: "release-required";
  readonly workId: string;
  readonly attemptId: string;
  readonly leaseGeneration: number;
  readonly leaseToken: string;
  readonly leaseExpiresAt: string;
  readonly bookingRequestReference: string;
  readonly paymentLifecycleId: string;
  readonly authorizedAmountFils: number;
  readonly paymentSnapshot: PaymentLifecycleSnapshot;
  readonly paymentProviderIdentity: PaymentProviderIdentity;
}

export interface BookingRequestLifecycleRepository {
  claim(
    input: BookingRequestAction,
  ): Promise<BookingRequestLifecycleResult | BookingRequestReleaseWork>;
  claimDue(
    limit: number,
  ): Promise<
    readonly (BookingRequestLifecycleResult | BookingRequestReleaseWork)[]
  >;
  savePaymentSnapshot(
    work: BookingRequestReleaseWork,
    snapshot: PaymentLifecycleSnapshot,
  ): Promise<ProviderExecutionPermit | void>;
  finalize(
    work: BookingRequestReleaseWork,
  ): Promise<BookingRequestLifecycleResult>;
}

export interface BookingRequestLifecycle {
  act(input: BookingRequestAction): Promise<BookingRequestLifecycleResult>;
  processDue(limit?: number): Promise<readonly BookingRequestLifecycleResult[]>;
}

function sameProvider(
  left: PaymentProviderIdentity,
  right: PaymentProviderIdentity,
) {
  return (
    left.provider === right.provider &&
    left.environment === right.environment &&
    left.merchantId === right.merchantId &&
    left.terminalId === right.terminalId
  );
}

function validAction(input: BookingRequestAction): boolean {
  if (
    !/^[0-9a-f-]{36}$/i.test(input.actorUserId) ||
    !/^[0-9a-f-]{36}$/i.test(input.bookingRequestId)
  ) {
    return false;
  }
  if (input.action !== "decline") return true;
  const note = input.declineNote ?? "";
  return (
    bookingRequestDeclineReasons.includes(input.declineReason) &&
    note === note.trim() &&
    note.length <= 500 &&
    isContactSafeBookingRequestText(note)
  );
}

export function createBookingRequestLifecycle({
  repository,
  provider,
}: {
  repository: BookingRequestLifecycleRepository;
  provider: PaymentProviderAdapter;
}): BookingRequestLifecycle {
  const finish = async (
    claimed: BookingRequestLifecycleResult | BookingRequestReleaseWork,
  ): Promise<BookingRequestLifecycleResult> => {
    if (claimed.status !== "release-required") return claimed;
    if (!sameProvider(claimed.paymentProviderIdentity, provider.identity)) {
      return { status: "unavailable" };
    }
    if (
      !Number.isSafeInteger(claimed.authorizedAmountFils) ||
      claimed.authorizedAmountFils < 1 ||
      claimed.paymentSnapshot.customerTotalFils !==
        claimed.authorizedAmountFils ||
      claimed.paymentSnapshot.authorization?.amountFils !==
        claimed.authorizedAmountFils
    ) {
      return { status: "unavailable" };
    }
    try {
      const payment = rehydratePaymentAuthorizationLifecycle(
        {
          paymentLifecycleId: claimed.paymentLifecycleId,
          bookingPriceFils: claimed.paymentSnapshot.bookingPriceFils,
          bookingServiceFeeFils: claimed.paymentSnapshot.bookingServiceFeeFils,
        },
        provider,
        claimed.paymentSnapshot,
        {
          save: (snapshot) => repository.savePaymentSnapshot(claimed, snapshot),
        },
      );
      const stored = payment.snapshot().release;
      let release = stored
        ? stored.status === "pending"
          ? await payment.reconcile(stored.logicalOperationId)
          : stored
        : await payment.release(claimed.authorizedAmountFils);
      if (release.status === "failed" && release.retrySafe) {
        release = await payment.retry(release.logicalOperationId);
      }
      return release.status === "succeeded"
        ? repository.finalize(claimed)
        : {
            status: "processing",
            bookingRequestReference: claimed.bookingRequestReference,
          };
    } catch {
      return {
        status: "processing",
        bookingRequestReference: claimed.bookingRequestReference,
      };
    }
  };

  return {
    async act(input) {
      if (!validAction(input)) return { status: "invalid" };
      return finish(await repository.claim(input));
    },
    async processDue(limit = 20) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
        return [{ status: "invalid" }];
      }
      const claimed = await repository.claimDue(limit);
      const results = [];
      for (const work of claimed) results.push(await finish(work));
      return results;
    },
  };
}
