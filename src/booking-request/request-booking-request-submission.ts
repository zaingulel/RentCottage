import "server-only";
import { SupabasePaymentOperationExecutionRepository } from "@/payment/supabase-payment-operation-execution";

import { prepareBookingRequestSubmission } from "./booking-request-submission-recovery";
import { createRequestPaymentOperations } from "./request-payment-operations";
import { SupabaseBookingRequestSubmissionRepository } from "./supabase-booking-request-submission";

export async function createRequestBookingRequestSubmission() {
  const payment = createRequestPaymentOperations();
  if (!payment) return undefined;
  const {
    serviceClient: client,
    provider: paymentProvider,
    operations,
  } = payment;
  const evidenceRepository = new SupabasePaymentOperationExecutionRepository(
    client,
  );
  const repository = new SupabaseBookingRequestSubmissionRepository(client);
  return prepareBookingRequestSubmission({
    repository,
    evidenceRepository,
    paymentProvider,
    operations,
    diagnostics: {
      record: (event) =>
        console.error("Booking Request submission failed", event),
    },
  });
}
