import type {
  PaymentProviderAdapter,
  PaymentProviderIdentity,
} from "@/payment/payment-contract";
import {
  createBookingRequestCapture,
  type BookingRequestCaptureRepository,
} from "./booking-request-capture";
import {
  createBookingRequestCaptureRecovery,
  type BookingRequestCaptureRecoveryRepository,
  type BookingRequestCaptureRecoveryResult,
} from "./booking-request-capture-recovery";
import type { BookingRequestConfirmation } from "./booking-request-confirmation";

export interface BookingRequestCaptureProcessingRepository
  extends
    Omit<BookingRequestCaptureRepository, "complete" | "recordFailure">,
    BookingRequestCaptureRecoveryRepository {
  listQueued(
    limit: number,
    providerIdentity: PaymentProviderIdentity,
  ): Promise<readonly string[]>;
}

export function createBookingRequestCaptureProcessing({
  repository,
  provider,
  confirmation,
}: {
  repository: BookingRequestCaptureProcessingRepository;
  provider: PaymentProviderAdapter;
  confirmation: BookingRequestConfirmation;
}) {
  const capture = createBookingRequestCapture({ repository, provider });
  const recovery = createBookingRequestCaptureRecovery({
    repository,
    provider,
    confirmation,
  });
  return {
    async processDue(
      limit = 20,
    ): Promise<readonly BookingRequestCaptureRecoveryResult[]> {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
        return [{ status: "invalid" }];
      const results: BookingRequestCaptureRecoveryResult[] = [];
      try {
        results.push(...(await recovery.processDue(limit)));
      } catch {
        results.push({ status: "unavailable" });
      }
      let queued;
      try {
        queued = await repository.listQueued(limit, provider.identity);
      } catch {
        return [...results, { status: "unavailable" }];
      }
      for (const id of queued) {
        try {
          const completed = await capture.execute(id);
          if (completed.status === "complete")
            results.push({
              status: "confirmed",
              confirmation: await confirmation.execute(id, completed.snapshot),
            });
          else if (completed.status === "payment-required")
            results.push(completed);
          else
            results.push({
              status:
                completed.status === "expired"
                  ? "unavailable"
                  : completed.status,
            });
        } catch {
          results.push({ status: "unavailable" });
        }
      }
      return results;
    },
  };
}
