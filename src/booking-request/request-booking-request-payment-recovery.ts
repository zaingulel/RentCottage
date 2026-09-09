import { createBookingRequestConfirmation } from "./booking-request-confirmation";
import { SupabaseBookingRequestConfirmationRepository } from "./supabase-booking-request-confirmation";
import { createBookingRequestPaymentObservation } from "./booking-request-payment-observation";
import { SupabaseBookingRequestPaymentObservationRepository } from "./supabase-booking-request-payment-observation";
import "server-only";
import { createPaymentOperationExecution } from "@/payment/payment-operation-execution";
import {
  SupabasePaymentOperationExecutionRepository,
  SupabaseSimulatorEffectRepository,
} from "@/payment/supabase-payment-operation-execution";

import { createClient } from "@supabase/supabase-js";
import { createRequestSupabaseClient } from "@/access/supabase-server";
import { getServerEnvironment } from "@/config/server-runtime";
import { DurablePaymentSimulator } from "@/payment/durable-payment-simulator";
import { bookingRequestTestRuntimeIsEnabled } from "./booking-request-test-runtime";
import { createBookingRequestPaymentRecovery } from "./booking-request-payment-recovery";
import { SupabaseBookingRequestPaymentRecoveryRepository } from "./supabase-booking-request-payment-recovery";

export async function createRequestBookingRequestPaymentRecovery() {
  if (!bookingRequestTestRuntimeIsEnabled()) return undefined;
  const { supabase } = getServerEnvironment();
  const customerClient = await createRequestSupabaseClient();
  const serviceClient = createClient(supabase.url, supabase.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const provider = new DurablePaymentSimulator({
    effects: new SupabaseSimulatorEffectRepository(serviceClient),
    now: () => new Date().toISOString(),
  });
  const operations = createPaymentOperationExecution({
    repository: new SupabasePaymentOperationExecutionRepository(serviceClient),
    provider,
    observation: createBookingRequestPaymentObservation({
      repository: new SupabaseBookingRequestPaymentObservationRepository(
        serviceClient,
      ),
    }),
  });
  return createBookingRequestPaymentRecovery({
    repository: new SupabaseBookingRequestPaymentRecoveryRepository(
      customerClient,
      serviceClient,
    ),

    operations,
    confirmation: createBookingRequestConfirmation({
      repository: new SupabaseBookingRequestConfirmationRepository(
        serviceClient,
      ),
    }),
  });
}
