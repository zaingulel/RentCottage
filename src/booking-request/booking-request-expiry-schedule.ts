import { createBookingRequestPaymentRecovery } from "./booking-request-payment-recovery";
import { SupabaseBookingRequestPaymentRecoveryRepository } from "./supabase-booking-request-payment-recovery";
import { createBookingRequestConfirmation } from "./booking-request-confirmation";
import { SupabaseBookingRequestConfirmationRepository } from "./supabase-booking-request-confirmation";
import { createBookingRequestPaymentObservation } from "./booking-request-payment-observation";
import { SupabaseBookingRequestPaymentObservationRepository } from "./supabase-booking-request-payment-observation";
import { createPaymentOperationExecution } from "@/payment/payment-operation-execution";
import {
  SupabasePaymentOperationExecutionRepository,
  SupabaseSimulatorEffectRepository,
} from "@/payment/supabase-payment-operation-execution";
import { createClient } from "@supabase/supabase-js";

import { DurablePaymentSimulator } from "../payment/durable-payment-simulator-core";
import {
  createBookingRequestLifecycle,
  type BookingRequestLifecycleResult,
} from "./booking-request-lifecycle";
import {
  createBookingRequestPaymentRequiredExpiry,
  type PaymentRequiredExpiryResult,
} from "./booking-request-payment-required-expiry";
import { bookingRequestTestRuntimeIsEnabled } from "./booking-request-test-runtime-core";
import { SupabaseBookingRequestLifecycleRepository } from "./supabase-booking-request-lifecycle";
import { SupabaseBookingRequestPaymentRequiredExpiryRepository } from "./supabase-booking-request-payment-required-expiry";

interface BookingRequestExpiryScheduleEnvironment {
  readonly APP_ENVIRONMENT?: string;
  readonly SUPABASE_PROJECT_REF?: string;
  readonly SUPABASE_URL?: string;
  readonly SUPABASE_PUBLISHABLE_KEY?: string;
  readonly SUPABASE_SECRET_KEY?: string;
}

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
  if (
    !bookingRequestTestRuntimeIsEnabled(environment) ||
    !environment.SUPABASE_PUBLISHABLE_KEY ||
    !environment.SUPABASE_SECRET_KEY
  ) {
    throw new Error(
      "Scheduled booking-request expiry requires the exact local test runtime and secret key",
    );
  }

  let processDue = injectedProcessDue;
  let paymentRequiredDue = injectedPaymentRequiredDue;
  if (!processDue || !paymentRequiredDue) {
    const client = createClient(
      environment.SUPABASE_URL as string,
      environment.SUPABASE_SECRET_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const provider = new DurablePaymentSimulator({
      effects: new SupabaseSimulatorEffectRepository(client),
      now: () => new Date().toISOString(),
    });
    const operations = createPaymentOperationExecution({
      repository: new SupabasePaymentOperationExecutionRepository(client),
      provider,
      observation: createBookingRequestPaymentObservation({
        repository: new SupabaseBookingRequestPaymentObservationRepository(
          client,
        ),
      }),
    });
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
