import { createClient } from "@supabase/supabase-js";

import { createBookingRequestLifecycle } from "@/booking-request/booking-request-lifecycle";
import { SupabaseBookingRequestLifecycleRepository } from "@/booking-request/supabase-booking-request-lifecycle";
import type {
  PaymentProviderAdapter,
  ProviderOperationRequest,
} from "@/payment/payment-contract";
import { DurablePaymentSimulator } from "@/payment/durable-payment-simulator";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function send(message: object) {
  if (!process.send) throw new Error("Lifecycle worker requires an IPC parent");
  process.send(message);
}

function waitForContinue(): Promise<void> {
  return new Promise((resolve, reject) => {
    process.once("message", (message) => {
      if (message !== "continue") {
        reject(new Error("Lifecycle worker received an invalid continuation"));
        return;
      }
      resolve();
    });
  });
}

async function main() {
  const client = createClient(
    required("SUPABASE_URL"),
    required("SUPABASE_SECRET_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const durable = new DurablePaymentSimulator({
    client,
    now: () => new Date().toISOString(),
  });
  const pause = process.env.LIFECYCLE_WORKER_PAUSE ?? "none";
  let intercepted = false;
  const provider: PaymentProviderAdapter = {
    identity: durable.identity,
    async execute(request: ProviderOperationRequest) {
      if (intercepted || request.kind !== "release" || pause === "none") {
        return durable.execute(request);
      }
      intercepted = true;
      if (pause === "before-admission") {
        send({ stage: "permitted" });
        await waitForContinue();
        return durable.execute(request);
      }
      if (pause === "after-admission") {
        const result = await durable.execute(request);
        send({ stage: "admitted" });
        await waitForContinue();
        return result;
      }
      throw new Error(`Unknown lifecycle worker pause: ${pause}`);
    },
    query: (request) => durable.query(request),
    verifySignedEvent: () => durable.verifySignedEvent(),
  };
  const lifecycle = createBookingRequestLifecycle({
    repository: new SupabaseBookingRequestLifecycleRepository(
      client,
      durable.identity,
    ),
    provider,
  });
  const result = await lifecycle.act({
    actor: "customer",
    actorUserId: required("LIFECYCLE_CUSTOMER_ID"),
    bookingRequestId: required("LIFECYCLE_BOOKING_REQUEST_ID"),
    action: "withdraw",
  });
  send({ stage: "complete", result });
}

main().catch((error: unknown) => {
  send({
    stage: "error",
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
