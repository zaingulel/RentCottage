import "server-only";
import { createRequestSupabaseClient } from "@/access/supabase-server";
import { bookingRequestTestRuntimeIsEnabled } from "@/booking-request/booking-request-test-runtime";
import {
  SupabaseBookingNotificationStatusRepository,
  type RequestNotificationStatus,
} from "./notification-status-repository";

export type RequestNotificationPresentation =
  | {
      readonly status: "available";
      readonly notices: readonly RequestNotificationStatus[];
    }
  | { readonly status: "unavailable" };
export async function loadRequestNotificationStatus(
  reference: string,
  role: "customer" | "cottage_owner",
): Promise<RequestNotificationPresentation> {
  if (!bookingRequestTestRuntimeIsEnabled()) return { status: "unavailable" };
  try {
    const repository = new SupabaseBookingNotificationStatusRepository(
      await createRequestSupabaseClient(),
    );
    return {
      status: "available",
      notices: await repository.listRequest(reference, role),
    };
  } catch {
    return { status: "unavailable" };
  }
}
