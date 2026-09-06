import "server-only";

import { createRequestSupabaseClient } from "@/access/supabase-server";
import { bookingRequestTestRuntimeIsEnabled } from "./booking-request-test-runtime";
import { customerBookingRequestDisplay } from "./booking-request-display";
import { getCustomerBookingRequest } from "./customer-booking-request";

export async function loadCustomerBookingRequest(reference: string) {
  if (!bookingRequestTestRuntimeIsEnabled()) return undefined;
  const request = await getCustomerBookingRequest(
    await createRequestSupabaseClient(),
    reference,
  );
  return request ? customerBookingRequestDisplay(request) : null;
}
