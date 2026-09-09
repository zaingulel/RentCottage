import "server-only";
import { createPaymentOperationExecution } from "@/payment/payment-operation-execution";
import {
  SupabasePaymentOperationExecutionRepository,
  SupabaseSimulatorEffectRepository,
} from "@/payment/supabase-payment-operation-execution";

import { createClient } from "@supabase/supabase-js";

import { getServerEnvironment } from "@/config/server-runtime";

import { createBookingRequestSubmission } from "./booking-request-submission";
import { bookingRequestTestRuntimeIsEnabled } from "./booking-request-test-runtime";
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
  if (!bookingRequestTestRuntimeIsEnabled()) return undefined;
  const { DurablePaymentSimulator } =
    await import("@/payment/durable-payment-simulator");
  const client = getPrivilegedClient();
  const paymentProvider = new DurablePaymentSimulator({
    effects: new SupabaseSimulatorEffectRepository(client),
    now: () => new Date().toISOString(),
  });
  const evidenceRepository = new SupabasePaymentOperationExecutionRepository(
    client,
  );
  const operations = createPaymentOperationExecution({
    repository: evidenceRepository,
    provider: paymentProvider,
  });
  try {
    for (const query of await evidenceRepository.pendingAuthorizationQueries(
      paymentProvider.identity,
    )) {
      await operations.query(query);
    }
  } catch {
    console.error("Booking Request provider inquiry selection failed");
    return undefined;
  }
  const expiration = await client.rpc(
    "expire_booking_request_authorization_claims",
  );
  if (expiration.error) {
    console.error("Booking Request expiry reconciliation failed");
    return undefined;
  }
  return createBookingRequestSubmission({
    repository: new SupabaseBookingRequestSubmissionRepository(client),
    paymentProvider,
    operations,
    diagnostics: {
      record: (event) =>
        console.error("Booking Request submission failed", event),
    },
  });
}
