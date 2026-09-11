import { createClient } from "@supabase/supabase-js";
import { DurablePaymentSimulator } from "@/payment/durable-payment-simulator-core";
import { createPaymentOperationExecution } from "@/payment/payment-operation-execution";
import {
  SupabasePaymentOperationExecutionRepository,
  SupabaseSimulatorEffectRepository,
} from "@/payment/supabase-payment-operation-execution";
import { createBookingRequestPaymentObservation } from "./booking-request-payment-observation";
import { SupabaseBookingRequestPaymentObservationRepository } from "./supabase-booking-request-payment-observation";
import { bookingRequestTestRuntimeIsEnabled } from "./booking-request-test-runtime-core";
import { createBookingRefund } from "./booking-refund";
import { SupabaseBookingRefundRepository } from "./supabase-booking-refund";

type RefundScheduleEnvironment = Parameters<
  typeof bookingRequestTestRuntimeIsEnabled
>[0] & {
  readonly SUPABASE_PUBLISHABLE_KEY?: string;
  readonly SUPABASE_SECRET_KEY?: string;
};
export async function runScheduledBookingRefunds(
  environment: RefundScheduleEnvironment,
  injectedProcessDue?: ReturnType<typeof createBookingRefund>["processDue"],
) {
  if (
    !bookingRequestTestRuntimeIsEnabled(environment) ||
    !environment.SUPABASE_PUBLISHABLE_KEY ||
    !environment.SUPABASE_SECRET_KEY
  )
    throw new Error(
      "Scheduled refunds require the exact local test runtime and credentials",
    );
  let processDue = injectedProcessDue;
  if (!processDue) {
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
    processDue = createBookingRefund({
      repository: new SupabaseBookingRefundRepository(client),
      operations,
    }).processDue;
  }
  const results = await processDue(50);
  if (results.some(({ status }) => status === "unavailable"))
    throw new Error("Scheduled refund processing is incomplete");
  return results;
}
