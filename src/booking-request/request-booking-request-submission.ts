import "server-only";
import { SupabasePaymentOperationExecutionRepository } from "@/payment/supabase-payment-operation-execution";

import { createBookingRequestSubmission } from "./booking-request-submission";
import { createRequestPaymentOperations } from "./request-payment-operations";
import { SupabaseBookingRequestSubmissionRepository } from "./supabase-booking-request-submission";

const sqlstate = /^[0-9A-Z]{5}$/;

function recordRecoveryFailure(
  phase: "recovery" | "reconciliation",
  code:
    | "booking_request_recovery_failed"
    | "booking_request_reconciliation_marker_failed",
  error: unknown,
  attemptId: string,
) {
  const state =
    error instanceof Object && "code" in error ? error.code : undefined;
  console.error("Booking Request submission failed", {
    phase,
    code,
    ...(typeof state === "string" && sqlstate.test(state)
      ? { sqlstate: state }
      : {}),
    attemptId,
  });
}

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
    try {
      await submission.recoverAuthorized(attempt);
    } catch (error) {
      recordRecoveryFailure(
        "recovery",
        "booking_request_recovery_failed",
        error,
        attempt.id,
      );
      try {
        await repository.markReconciliationRequired(attempt.id);
      } catch (markingError) {
        recordRecoveryFailure(
          "reconciliation",
          "booking_request_reconciliation_marker_failed",
          markingError,
          attempt.id,
        );
      }
    }
  }
  return submission;
}
