import { createClient } from "@supabase/supabase-js";

import { DurablePaymentSimulator } from "../payment/durable-payment-simulator-core";
import { createBookingRequestLifecycle } from "./booking-request-lifecycle";
import { bookingRequestTestRuntimeIsEnabled } from "./booking-request-test-runtime-core";
import { SupabaseBookingRequestLifecycleRepository } from "./supabase-booking-request-lifecycle";

interface BookingRequestExpiryScheduleEnvironment {
  readonly APP_ENVIRONMENT?: string;
  readonly SUPABASE_PROJECT_REF?: string;
  readonly SUPABASE_URL?: string;
  readonly SUPABASE_PUBLISHABLE_KEY?: string;
  readonly SUPABASE_SECRET_KEY?: string;
}

type ProcessDue = (limit: number) => Promise<unknown>;

export async function runScheduledBookingRequestExpiry(
  environment: BookingRequestExpiryScheduleEnvironment,
  injectedProcessDue?: ProcessDue,
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

  if (injectedProcessDue) return injectedProcessDue(50);

  const client = createClient(
    environment.SUPABASE_URL as string,
    environment.SUPABASE_SECRET_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const provider = new DurablePaymentSimulator({
    client,
    now: () => new Date().toISOString(),
  });
  const lifecycle = createBookingRequestLifecycle({
    repository: new SupabaseBookingRequestLifecycleRepository(
      client,
      provider.identity,
    ),
    provider,
  });
  return lifecycle.processDue(50);
}
