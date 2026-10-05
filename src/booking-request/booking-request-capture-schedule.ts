import {
  createBookingRequestPaymentRecovery,
  type PaymentRecoveryStatus,
} from "./booking-request-payment-recovery";
import { SupabaseBookingRequestPaymentRecoveryRepository } from "./supabase-booking-request-payment-recovery";
import {
  preparePaymentOperations,
  type PaymentOperationsEnvironment,
} from "./payment-operations";
import { createBookingRequestCaptureProcessing } from "./booking-request-capture-processing";
import type { BookingRequestCaptureRecoveryResult } from "./booking-request-capture-recovery";
import { createBookingRequestConfirmation } from "./booking-request-confirmation";
import { SupabaseBookingRequestCaptureRepository } from "./supabase-booking-request-capture";
import { SupabaseBookingRequestConfirmationRepository } from "./supabase-booking-request-confirmation";

type BookingRequestCaptureScheduleEnvironment = PaymentOperationsEnvironment & {
  readonly SUPABASE_PUBLISHABLE_KEY?: string;
};
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
  const assemblePayment = environment.SUPABASE_PUBLISHABLE_KEY
    ? preparePaymentOperations(environment)
    : undefined;
  if (!assemblePayment)
    throw new Error(
      "Scheduled capture requires the exact local test runtime and credentials",
    );
  let processDue = injectedProcessDue;
  let processRecoveryDue = injectedRecoveryDue;
  if (!processDue) {
    const { serviceClient: client, provider, operations } = assemblePayment();
    processRecoveryDue = createBookingRequestPaymentRecovery({
      repository: new SupabaseBookingRequestPaymentRecoveryRepository(
        client,
        client,
      ),

      operations,
      confirmation: createBookingRequestConfirmation({
        repository: new SupabaseBookingRequestConfirmationRepository(client),
      }),
    }).processDue;
    processDue = createBookingRequestCaptureProcessing({
      repository: new SupabaseBookingRequestCaptureRepository(client),
      provider,
      operations,
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
