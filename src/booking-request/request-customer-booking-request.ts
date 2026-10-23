import "server-only";

import { createRequestSupabaseClient } from "@/access/supabase-server";
import { fictionalSupplierEnvironment } from "./fictional-supplier-environment";
import { customerBookingRequestDisplay } from "./booking-request-display";
import { getCustomerBookingRequest } from "./customer-booking-request";

export async function loadCustomerBookingRequest(reference: string) {
  if (!fictionalSupplierEnvironment()) return undefined;
  const request = await getCustomerBookingRequest(
    await createRequestSupabaseClient(),
    reference,
  );
  return request ? customerBookingRequestDisplay(request) : null;
}
