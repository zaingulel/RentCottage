import "server-only";
import { SupabasePaymentOperationExecutionRepository } from "@/payment/supabase-payment-operation-execution";

import { createBookingRequestSubmission } from "./booking-request-submission";
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
  const repository = new SupabaseBookingRequestSubmissionRepository(client);
  const submission = createBookingRequestSubmission({
    repository,
    paymentProvider,
    operations,
    diagnostics: {
      record: (event) =>
        console.error("Booking Request submission failed", event),
    },
  });
  let recoveries;
  try {
    recoveries = await repository.dueAuthorizedRecoveries(
      paymentProvider.identity,
    );
  } catch {
    console.error("Booking Request recovery selection failed");
    return undefined;
  }
  for (const attempt of recoveries) {
    await submission.recoverAuthorized(attempt);
  }
  return submission;
}
