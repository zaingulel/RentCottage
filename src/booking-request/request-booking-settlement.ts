import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createBookingSettlement } from "./booking-payout";
import { SupabaseBookingSettlementRepository } from "./supabase-booking-payout";
import { createRequestPaymentOperations } from "./request-payment-operations";
export function createRequestBookingSettlement(client: SupabaseClient) {
  const payment = createRequestPaymentOperations();
  if (!payment) throw new Error("Simulated settlement is unavailable");
  return createBookingSettlement({
    repository: new SupabaseBookingSettlementRepository(
      client,
      payment.serviceClient,
    ),
    operations: payment.operations,
  });
}
