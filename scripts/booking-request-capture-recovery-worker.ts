import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { createBookingRequestCaptureProcessing } from "@/booking-request/booking-request-capture-processing";
import { createBookingRequestCapture } from "@/booking-request/booking-request-capture";
import { createBookingRequestCaptureRecovery } from "@/booking-request/booking-request-capture-recovery";
import { createBookingRequestConfirmation } from "@/booking-request/booking-request-confirmation";
import { SupabaseBookingRequestCaptureRepository } from "@/booking-request/supabase-booking-request-capture";
import { SupabaseBookingRequestConfirmationRepository } from "@/booking-request/supabase-booking-request-confirmation";
import { DurablePaymentSimulator } from "@/payment/durable-payment-simulator-core";
import type { PaymentProviderAdapter } from "@/payment/payment-contract";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
function localApiUrl(): string {
  const workdir = process.env.SUPABASE_LOCAL_WORKDIR;
  const status = spawnSync(
    "npx",
    [
      "supabase",
      "status",
      "--output",
      "json",
      ...(workdir ? ["--workdir", workdir] : []),
    ],
    {
      encoding: "utf8",
      env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
      timeout: 10_000,
    },
  );
  try {
    const data: unknown = JSON.parse(status.stdout);
    if (
      status.status !== 0 ||
      !data ||
      typeof data !== "object" ||
      !("API_URL" in data) ||
      typeof data.API_URL !== "string"
    )
      throw new Error();
    const url = new URL(data.API_URL);
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      data.API_URL !== url.origin ||
      required("SUPABASE_URL") !== url.origin
    )
      throw new Error();
    return url.origin;
  } catch {
    throw new Error(
      "Capture worker API must match the disposable local Supabase origin",
    );
  }
}
function send(message: object) {
  if (!process.send) throw new Error("Capture worker requires an IPC parent");
  process.send(message);
}
async function main() {
  const mode = required("CAPTURE_WORKER_MODE");
  const client = createClient(localApiUrl(), required("SUPABASE_SECRET_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const durable = new DurablePaymentSimulator({
    client,
    now: () => new Date().toISOString(),
    executeOutcome: mode.includes("failure") ? "failed" : "succeeded",
  });
  const lostResponse = new Error(
    "Capture response lost after durable execution",
  );
  const provider: PaymentProviderAdapter = {
    identity: durable.identity,
    async execute(request) {
      const result = await durable.execute(request);
      send({ stage: "execute", request, result });
      if (
        mode === "lose-response" ||
        mode === "process-lose-response" ||
        mode === "failure-lose-response"
      )
        throw lostResponse;
      return result;
    },
    async query(request) {
      send({ stage: "query", request });
      if (mode === "pause-query")
        await new Promise<void>((resolve, reject) => {
          process.once("message", (message) =>
            message === "continue"
              ? resolve()
              : reject(new Error("Invalid continuation")),
          );
        });
      return durable.query(request);
    },
    verifySignedEvent: () => false,
  };
  const repository = new SupabaseBookingRequestCaptureRepository(client);
  const confirmation = createBookingRequestConfirmation({
    repository: new SupabaseBookingRequestConfirmationRepository(client),
  });
  if (
    [
      "process",
      "process-lose-response",
      "process-interrupt-confirmation",
    ].includes(mode)
  ) {
    const result = await createBookingRequestCaptureProcessing({
      repository,
      provider,
      confirmation:
        mode === "process-interrupt-confirmation"
          ? {
              execute: async () => {
                throw new Error("Interrupted confirmation");
              },
            }
          : confirmation,
    }).processDue();
    send({ stage: "complete", result });
  } else if (
    mode === "lose-response" ||
    mode === "capture-only" ||
    mode === "failure-lose-response"
  ) {
    try {
      const result = await createBookingRequestCapture({
        repository,
        provider,
      }).execute(required("CAPTURE_BOOKING_REQUEST_ID"));
      send({ stage: "complete", result });
    } catch (error) {
      if (error !== lostResponse) throw error;
      send({ stage: "complete", result: "interrupted" });
    }
  } else if (
    mode === "recover" ||
    mode === "recover-failure" ||
    mode === "pause-query"
  ) {
    const result = await createBookingRequestCaptureRecovery({
      repository,
      provider,
      confirmation,
    }).processDue();
    send({ stage: "complete", result });
  } else throw new Error("Invalid Capture worker mode");
}
main().catch((error: unknown) => {
  send({
    stage: "error",
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
