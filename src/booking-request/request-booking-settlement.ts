import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getServerEnvironment } from "@/config/server-runtime";
import { DurablePaymentSimulator } from "@/payment/durable-payment-simulator";
import { createPaymentOperationExecution } from "@/payment/payment-operation-execution";
import {
  SupabasePaymentOperationExecutionRepository,
  SupabaseSimulatorEffectRepository,
} from "@/payment/supabase-payment-operation-execution";
import { createBookingRequestPaymentObservation } from "./booking-request-payment-observation";
import { SupabaseBookingRequestPaymentObservationRepository } from "./supabase-booking-request-payment-observation";
import { createBookingSettlement } from "./booking-payout";
import { SupabaseBookingSettlementRepository } from "./supabase-booking-payout";
import { bookingRequestTestRuntimeIsEnabled } from "./booking-request-test-runtime";
export function createRequestBookingSettlement(client: SupabaseClient) {
  if (!bookingRequestTestRuntimeIsEnabled())
    throw new Error("Simulated settlement is unavailable");
  const { supabase } = getServerEnvironment();
  const serviceClient = createClient(supabase.url, supabase.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return createBookingSettlement({
    repository: new SupabaseBookingSettlementRepository(client, serviceClient),
    operations: createPaymentOperationExecution({
      repository: new SupabasePaymentOperationExecutionRepository(
        serviceClient,
      ),
      provider: new DurablePaymentSimulator({
        effects: new SupabaseSimulatorEffectRepository(serviceClient),
        now: () => new Date().toISOString(),
      }),
      observation: createBookingRequestPaymentObservation({
        repository: new SupabaseBookingRequestPaymentObservationRepository(
          serviceClient,
        ),
      }),
    }),
  });
}
