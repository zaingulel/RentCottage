import { createBookingRequestConfirmation } from "./booking-request-confirmation";
import { SupabaseBookingRequestConfirmationRepository } from "./supabase-booking-request-confirmation";
import "server-only";

import { createRequestSupabaseClient } from "@/access/supabase-server";
import { createBookingRequestPaymentRecovery } from "./booking-request-payment-recovery";
import { createRequestPaymentOperations } from "./request-payment-operations";
import { SupabaseBookingRequestPaymentRecoveryRepository } from "./supabase-booking-request-payment-recovery";

export async function createRequestBookingRequestPaymentRecovery() {
  const payment = createRequestPaymentOperations();
  if (!payment) return undefined;
  const { serviceClient, operations } = payment;
  const customerClient = await createRequestSupabaseClient();
  return createBookingRequestPaymentRecovery({
    repository: new SupabaseBookingRequestPaymentRecoveryRepository(
      customerClient,
      serviceClient,
    ),

    operations,
    confirmation: createBookingRequestConfirmation({
      repository: new SupabaseBookingRequestConfirmationRepository(
        serviceClient,
      ),
    }),
  });
}
