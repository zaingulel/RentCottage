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

const requestNotificationStatusTimeoutMilliseconds = 10_000;

function withinRequestNotificationStatusDeadline<T>(
  read: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    requestNotificationStatusTimeoutMilliseconds,
  );
  return new Promise<T>((resolve, reject) => {
    const abort = () =>
      reject(new Error("Request notification status timed out"));
    controller.signal.addEventListener("abort", abort, { once: true });
    read(controller.signal).then(
      (value) => {
        controller.signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        controller.signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  }).finally(() => clearTimeout(timeout));
}

export async function loadRequestNotificationStatus(
  reference: string,
  role: "customer" | "cottage_owner",
): Promise<RequestNotificationPresentation> {
  if (!bookingRequestTestRuntimeIsEnabled()) return { status: "unavailable" };
  try {
    const notices = await withinRequestNotificationStatusDeadline(
      async (signal) => {
        const client = await createRequestSupabaseClient();
        if (signal.aborted)
          throw new Error("Request notification status timed out");
        return new SupabaseBookingNotificationStatusRepository(
          client,
        ).listRequest(reference, role, signal);
      },
    );
    return {
      status: "available",
      notices,
    };
  } catch {
    return { status: "unavailable" };
  }
}
