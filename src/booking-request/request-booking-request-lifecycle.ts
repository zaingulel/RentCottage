import "server-only";

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
    client: privilegedClient,
    now: () => new Date().toISOString(),
  });
  return createBookingRequestLifecycle({
    repository: new SupabaseBookingRequestLifecycleRepository(
      privilegedClient,
      provider.identity,
    ),
    provider,
  });
}
