import type {
  PaymentProviderAdapter,
  PaymentProviderIdentity,
  ProviderReconciliationQuery,
} from "@/payment/payment-contract";
import type { PaymentOperationExecution } from "@/payment/payment-operation-execution";

import {
  createBookingRequestSubmission,
  type BookingRequestDiagnostics,
  type BookingRequestSubmission,
  type BookingRequestSubmissionRepository,
  type RecoverableSubmissionAttempt,
} from "./booking-request-submission";

export interface BookingRequestSubmissionRecoveryRepository {
  dueAuthorizedRecoveries(
    identity: PaymentProviderIdentity,
  ): Promise<readonly RecoverableSubmissionAttempt[]>;
  expireAuthorizationClaims(): Promise<boolean>;
}

export interface PendingBookingRequestAuthorizationQueries {
  pendingAuthorizationQueries(
    identity: PaymentProviderIdentity,
  ): Promise<readonly ProviderReconciliationQuery[]>;
}

export async function prepareBookingRequestSubmission({
  repository,
  evidenceRepository,
  paymentProvider,
  operations,
  diagnostics,
}: {
  repository: BookingRequestSubmissionRepository &
    BookingRequestSubmissionRecoveryRepository;
  evidenceRepository: PendingBookingRequestAuthorizationQueries;
  paymentProvider: PaymentProviderAdapter;
  operations: PaymentOperationExecution;
  diagnostics?: BookingRequestDiagnostics;
}): Promise<BookingRequestSubmission | undefined> {
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
  if (!(await repository.expireAuthorizationClaims())) {
    console.error("Booking Request expiry reconciliation failed");
    return undefined;
  }
  const submission = createBookingRequestSubmission({
    repository,
    paymentProvider,
    operations,
    diagnostics,
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
