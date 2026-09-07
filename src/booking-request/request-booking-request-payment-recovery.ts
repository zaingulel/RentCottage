import "server-only";
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
  return createBookingRequestPaymentRecovery({
    repository: new SupabaseBookingRequestPaymentRecoveryRepository(
      customerClient,
      serviceClient,
    ),
    provider: new DurablePaymentSimulator({
      client: serviceClient,
      now: () => new Date().toISOString(),
    }),
  });
}
