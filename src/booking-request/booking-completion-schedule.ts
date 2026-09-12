import { createClient } from "@supabase/supabase-js";

import { bookingRequestTestRuntimeIsEnabled } from "./booking-request-test-runtime-core";
import {
  createBookingCompletion,
  type BookingCompletionResult,
} from "./booking-completion";
import { SupabaseBookingCompletionRepository } from "./supabase-booking-completion";

type CompletionScheduleEnvironment = Parameters<
  typeof bookingRequestTestRuntimeIsEnabled
>[0] & {
  readonly SUPABASE_PUBLISHABLE_KEY?: string;
  readonly SUPABASE_SECRET_KEY?: string;
};

type ProcessDue = (
  limit: number,
) => Promise<readonly BookingCompletionResult[]>;

export async function runScheduledBookingCompletion(
  environment: CompletionScheduleEnvironment,
  injectedProcessDue?: ProcessDue,
) {
  if (
    !bookingRequestTestRuntimeIsEnabled(environment) ||
    !environment.SUPABASE_PUBLISHABLE_KEY ||
    !environment.SUPABASE_SECRET_KEY
  )
    throw new Error(
      "Scheduled booking completion requires the exact local test runtime and credentials",
    );
  const processDue =
    injectedProcessDue ??
    createBookingCompletion(
      new SupabaseBookingCompletionRepository(
        createClient(
          environment.SUPABASE_URL as string,
          environment.SUPABASE_SECRET_KEY,
          {
            auth: { autoRefreshToken: false, persistSession: false },
          },
        ),
      ),
    ).processDue;
  return processDue(50);
}
