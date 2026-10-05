import "server-only";

import { createBookingRequestLifecycle } from "./booking-request-lifecycle";
import { createRequestPaymentOperations } from "./request-payment-operations";
import { SupabaseBookingRequestLifecycleRepository } from "./supabase-booking-request-lifecycle";

export function createRequestBookingRequestLifecycle() {
  const payment = createRequestPaymentOperations();
  if (!payment) return undefined;
  const { serviceClient, provider, operations } = payment;
  return createBookingRequestLifecycle({
    repository: new SupabaseBookingRequestLifecycleRepository(
      serviceClient,
      provider.identity,
    ),
    provider,
    operations,
  });
}
