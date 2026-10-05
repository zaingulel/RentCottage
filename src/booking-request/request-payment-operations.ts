import "server-only";
import { getServerEnvironment } from "@/config/server-runtime";
import { bookingRequestTestRuntimeIsEnabled } from "./booking-request-test-runtime";
import {
  createPaymentOperations,
  type PaymentOperations,
} from "./payment-operations";

export function createRequestPaymentOperations():
  | PaymentOperations
  | undefined {
  if (!bookingRequestTestRuntimeIsEnabled()) return undefined;
  const { name, supabase } = getServerEnvironment();
  return createPaymentOperations({
    APP_ENVIRONMENT: name,
    SUPABASE_PROJECT_REF: supabase.projectRef,
    SUPABASE_URL: supabase.url,
    SUPABASE_SECRET_KEY: supabase.secretKey,
  });
}
