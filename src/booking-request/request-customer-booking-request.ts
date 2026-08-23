import "server-only";

import { createRequestSupabaseClient } from "@/access/supabase-server";
import { bookingRequestTestRuntimeIsEnabled } from "./booking-request-test-runtime";
import { getCustomerBookingRequest } from "./customer-booking-request";

export async function loadCustomerBookingRequest(reference: string) {
  if (!bookingRequestTestRuntimeIsEnabled()) return undefined;
  return getCustomerBookingRequest(
    await createRequestSupabaseClient(),
    reference,
  );
}
