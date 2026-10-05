import { createBookingRequestPaymentRecovery } from "./booking-request-payment-recovery";
import { SupabaseBookingRequestPaymentRecoveryRepository } from "./supabase-booking-request-payment-recovery";
import { createBookingRequestConfirmation } from "./booking-request-confirmation";
import { SupabaseBookingRequestConfirmationRepository } from "./supabase-booking-request-confirmation";
import {
  createBookingRequestLifecycle,
  type BookingRequestLifecycleResult,
} from "./booking-request-lifecycle";
import {
  createBookingRequestPaymentRequiredExpiry,
  type PaymentRequiredExpiryResult,
} from "./booking-request-payment-required-expiry";
import {
  preparePaymentOperations,
  type PaymentOperationsEnvironment,
} from "./payment-operations";
import { SupabaseBookingRequestLifecycleRepository } from "./supabase-booking-request-lifecycle";
import { SupabaseBookingRequestPaymentRequiredExpiryRepository } from "./supabase-booking-request-payment-required-expiry";

type BookingRequestExpiryScheduleEnvironment = PaymentOperationsEnvironment & {
  readonly SUPABASE_PUBLISHABLE_KEY?: string;
};

type ProcessDue = (
  limit: number,
) => Promise<
  readonly (BookingRequestLifecycleResult | PaymentRequiredExpiryResult)[]
>;

export async function runScheduledBookingRequestExpiry(
  environment: BookingRequestExpiryScheduleEnvironment,
  injectedProcessDue?: ProcessDue,
  injectedPaymentRequiredDue?: ProcessDue,
) {
  const assemblePayment = environment.SUPABASE_PUBLISHABLE_KEY
    ? preparePaymentOperations(environment)
    : undefined;
  if (!assemblePayment) {
    throw new Error(
      "Scheduled booking-request expiry requires the exact local test runtime and secret key",
    );
  }

  let processDue = injectedProcessDue;
  let paymentRequiredDue = injectedPaymentRequiredDue;
  if (!processDue || !paymentRequiredDue) {
    const { serviceClient: client, provider, operations } = assemblePayment();
    processDue ??= createBookingRequestLifecycle({
      repository: new SupabaseBookingRequestLifecycleRepository(
        client,
        provider.identity,
      ),
      provider,
      operations,
    }).processDue;
    paymentRequiredDue ??= createBookingRequestPaymentRequiredExpiry({
      repository: new SupabaseBookingRequestPaymentRequiredExpiryRepository(
        client,
      ),
      provider,
      operations,
      recovery: createBookingRequestPaymentRecovery({
        repository: new SupabaseBookingRequestPaymentRecoveryRepository(
          client,
          client,
        ),
        operations,
        confirmation: createBookingRequestConfirmation({
          repository: new SupabaseBookingRequestConfirmationRepository(client),
        }),
      }),
    }).processDue;
  }
  const drains = await Promise.allSettled([
    Promise.resolve().then(() => processDue(50)),
    Promise.resolve().then(() => paymentRequiredDue(50)),
  ]);
  const results = drains.flatMap((drain) =>
    drain.status === "fulfilled" ? drain.value : [],
  );
  if (
    drains.some((drain) => drain.status === "rejected") ||
    results.some(
      ({ status }) => status === "unavailable" || status === "invalid",
    )
  )
    throw new Error("Scheduled booking-request expiry is incomplete");
  return results;
}
