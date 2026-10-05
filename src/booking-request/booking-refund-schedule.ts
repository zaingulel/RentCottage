import { createBookingRefund } from "./booking-refund";
import {
  createPaymentOperations,
  type PaymentOperationsEnvironment,
} from "./payment-operations";
import { SupabaseBookingRefundRepository } from "./supabase-booking-refund";

type RefundScheduleEnvironment = PaymentOperationsEnvironment & {
  readonly SUPABASE_PUBLISHABLE_KEY?: string;
};
export async function runScheduledBookingRefunds(
  environment: RefundScheduleEnvironment,
  injectedProcessDue?: ReturnType<typeof createBookingRefund>["processDue"],
) {
  const payment = createPaymentOperations(environment);
  if (!payment || !environment.SUPABASE_PUBLISHABLE_KEY)
    throw new Error(
      "Scheduled refunds require the exact local test runtime and credentials",
    );
  let processDue = injectedProcessDue;
  if (!processDue) {
    const { serviceClient: client, operations } = payment;
    processDue = createBookingRefund({
      repository: new SupabaseBookingRefundRepository(client),
      operations,
    }).processDue;
  }
  const results = await processDue(50);
  if (results.some(({ status }) => status === "unavailable"))
    throw new Error("Scheduled refund processing is incomplete");
  return results;
}
