import { createClient } from "@supabase/supabase-js";

import { fictionalSupplierEnvironment } from "./fictional-supplier-environment-core";
import {
  createBookingCompletion,
  type BookingCompletionResult,
} from "./booking-completion";
import { SupabaseBookingCompletionRepository } from "./supabase-booking-completion";

type CompletionScheduleEnvironment = NonNullable<
  Parameters<typeof fictionalSupplierEnvironment>[0]
>;

type ProcessDue = (
  limit: number,
) => Promise<readonly BookingCompletionResult[]>;

export async function runScheduledBookingCompletion(
  environment: CompletionScheduleEnvironment,
  injectedProcessDue?: ProcessDue,
) {
  if (
    !fictionalSupplierEnvironment(environment) ||
    !environment.SUPABASE_PUBLISHABLE_KEY ||
    !environment.SUPABASE_SECRET_KEY
  )
    throw new Error(
      "Scheduled booking completion requires an approved fictional runtime and credentials",
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
