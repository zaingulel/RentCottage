import "server-only";
import { createPaymentOperationExecution } from "@/payment/payment-operation-execution";
import {
  SupabasePaymentOperationExecutionRepository,
  SupabaseSimulatorEffectRepository,
} from "@/payment/supabase-payment-operation-execution";

import { createClient } from "@supabase/supabase-js";

import { getServerEnvironment } from "@/config/server-runtime";
import { DurablePaymentSimulator } from "@/payment/durable-payment-simulator";

import { createBookingRequestLifecycle } from "./booking-request-lifecycle";
import { bookingRequestTestRuntimeIsEnabled } from "./booking-request-test-runtime";
import { SupabaseBookingRequestLifecycleRepository } from "./supabase-booking-request-lifecycle";

let privilegedClient: ReturnType<typeof createClient> | null = null;

export function createRequestBookingRequestLifecycle() {
  if (!bookingRequestTestRuntimeIsEnabled()) return undefined;
  if (!privilegedClient) {
    const { supabase } = getServerEnvironment();
    privilegedClient = createClient(supabase.url, supabase.secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  const provider = new DurablePaymentSimulator({
    effects: new SupabaseSimulatorEffectRepository(privilegedClient),
    now: () => new Date().toISOString(),
  });
  const operations = createPaymentOperationExecution({
    repository: new SupabasePaymentOperationExecutionRepository(
      privilegedClient,
    ),
    provider: provider,
  });
  return createBookingRequestLifecycle({
    repository: new SupabaseBookingRequestLifecycleRepository(
      privilegedClient,
      provider.identity,
    ),
    provider,
    operations,
  });
}
