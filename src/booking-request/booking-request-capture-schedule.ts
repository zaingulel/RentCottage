import {
  createBookingRequestPaymentRecovery,
  type PaymentRecoveryStatus,
} from "./booking-request-payment-recovery";
import { SupabaseBookingRequestPaymentRecoveryRepository } from "./supabase-booking-request-payment-recovery";
import { createClient } from "@supabase/supabase-js";
import { DurablePaymentSimulator } from "../payment/durable-payment-simulator-core";
import { bookingRequestTestRuntimeIsEnabled } from "./booking-request-test-runtime-core";
import { createBookingRequestCaptureProcessing } from "./booking-request-capture-processing";
import type { BookingRequestCaptureRecoveryResult } from "./booking-request-capture-recovery";
import { createBookingRequestConfirmation } from "./booking-request-confirmation";
import { SupabaseBookingRequestCaptureRepository } from "./supabase-booking-request-capture";
import { SupabaseBookingRequestConfirmationRepository } from "./supabase-booking-request-confirmation";

interface BookingRequestCaptureScheduleEnvironment {
  readonly APP_ENVIRONMENT?: string;
  readonly SUPABASE_PROJECT_REF?: string;
  readonly SUPABASE_URL?: string;
  readonly SUPABASE_PUBLISHABLE_KEY?: string;
  readonly SUPABASE_SECRET_KEY?: string;
}
type ProcessDue = (
  limit: number,
) => Promise<readonly BookingRequestCaptureRecoveryResult[]>;

export async function runScheduledBookingRequestCapture(
  environment: BookingRequestCaptureScheduleEnvironment,
  injectedProcessDue?: ProcessDue,
  injectedRecoveryDue?: (
    limit: number,
  ) => Promise<readonly { readonly status: PaymentRecoveryStatus }[]>,
) {
  if (
    !bookingRequestTestRuntimeIsEnabled(environment) ||
    !environment.SUPABASE_PUBLISHABLE_KEY ||
    !environment.SUPABASE_SECRET_KEY
  )
    throw new Error(
      "Scheduled capture requires the exact local test runtime and credentials",
    );
  let processDue = injectedProcessDue;
  let processRecoveryDue = injectedRecoveryDue;
  if (!processDue) {
    const client = createClient(
      environment.SUPABASE_URL as string,
      environment.SUPABASE_SECRET_KEY,
      {
        auth: { autoRefreshToken: false, persistSession: false },
      },
    );
    const provider = new DurablePaymentSimulator({
      client,
      now: () => new Date().toISOString(),
    });
    processRecoveryDue = createBookingRequestPaymentRecovery({
      repository: new SupabaseBookingRequestPaymentRecoveryRepository(
        client,
        client,
      ),
      provider,
    }).processDue;
    processDue = createBookingRequestCaptureProcessing({
      repository: new SupabaseBookingRequestCaptureRepository(client),
      provider,
      confirmation: createBookingRequestConfirmation({
        repository: new SupabaseBookingRequestConfirmationRepository(client),
      }),
    }).processDue;
  }
  const results = [
    ...(await processDue(50)),
    ...(await (processRecoveryDue?.(50) ?? [])),
  ];
  if (
    results.some(
      ({ status }) => status === "unavailable" || status === "invalid",
    )
  )
    throw new Error("Scheduled capture is incomplete");
  return results;
}
