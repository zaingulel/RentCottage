import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getServerEnvironment } from "@/config/server-runtime";

import { createBookingRequestSubmission } from "./booking-request-submission";
import { SupabaseBookingRequestSubmissionRepository } from "./supabase-booking-request-submission";

let privilegedClient: ReturnType<typeof createClient> | null = null;

function getPrivilegedClient() {
  if (!privilegedClient) {
    const { supabase } = getServerEnvironment();
    privilegedClient = createClient(supabase.url, supabase.secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return privilegedClient;
}

export async function createRequestBookingRequestSubmission() {
  const environment = getServerEnvironment();
  if (environment.name !== "test") return undefined;
  const { PaymentSimulator } = await import("@/payment/payment-simulator");
  const paymentProvider = new PaymentSimulator({
    now: () => new Date().toISOString(),
    outcomes: ["succeeded"],
    reconciliationOutcomes: ["succeeded"],
  });
  return createBookingRequestSubmission({
    repository: new SupabaseBookingRequestSubmissionRepository(
      getPrivilegedClient(),
    ),
    paymentProvider,
    diagnostics: {
      record: (event) =>
        console.error("Booking Request submission failed", event),
    },
  });
}
