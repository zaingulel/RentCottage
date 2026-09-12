// Separate process observer: use the real application, adapters and simulator,
// with the disposable PostgreSQL transport in place of HTTP authentication.
import { execFileSync } from "node:child_process";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createBookingSettlement } from "../src/booking-request/booking-payout";
import { SupabaseBookingSettlementRepository } from "../src/booking-request/supabase-booking-payout";
import { createPaymentOperationExecution } from "../src/payment/payment-operation-execution";
import { DurablePaymentSimulator } from "../src/payment/durable-payment-simulator-core";
import {
  SupabasePaymentOperationExecutionRepository,
  SupabaseSimulatorEffectRepository,
} from "../src/payment/supabase-payment-operation-execution";
import { createBookingRequestPaymentObservation } from "../src/booking-request/booking-request-payment-observation";
import { SupabaseBookingRequestPaymentObservationRepository } from "../src/booking-request/supabase-booking-request-payment-observation";
const container = process.env.SUPABASE_DB_CONTAINER;
if (
  container !== `supabase_db_${process.env.SUPABASE_LOCAL_PROJECT}` ||
  !/^supabase_db_rentcottage-[a-z0-9-]+$/.test(container)
)
  throw new Error("Disposable fixture database is required");
const quote = (value: unknown) =>
  value === null
    ? "null"
    : `'${(typeof value === "object" ? JSON.stringify(value) : String(value)).replaceAll("'", "''")}'`;
function client(role: "authenticated" | "service_role") {
  return {
    async rpc(name: string, args: Record<string, unknown>) {
      if (
        !/^[a-z_]+$/.test(name) ||
        Object.keys(args).some((key) => !/^[a-z_]+$/.test(key))
      )
        throw new Error("Invalid fixture routine");
      const authority =
        role === "authenticated"
          ? `set local request.jwt.claim.sub='10000000-0000-4000-8000-000000003801'; set local request.jwt.claims='{"sub":"10000000-0000-4000-8000-000000003801","role":"authenticated","aal":"aal2"}';`
          : "";
      const input = `begin;set local role ${role};${authority}select to_jsonb(public.${name}(${Object.entries(
        args,
      )
        .map(([key, value]) => `${key}=>${quote(value)}`)
        .join(",")}));commit;`;
      const output = execFileSync(
        "docker",
        [
          "exec",
          "-i",
          container!,
          "psql",
          "-X",
          "-qAt",
          "-v",
          "ON_ERROR_STOP=1",
          "-U",
          "postgres",
          "-d",
          "postgres",
        ],
        { input, encoding: "utf8" },
      );
      return { data: JSON.parse(output.trim()), error: null };
    },
  } as unknown as SupabaseClient;
}
const service = client("service_role");
const actualObservation = createBookingRequestPaymentObservation({
  repository: new SupabaseBookingRequestPaymentObservationRepository(service),
});
const operations = createPaymentOperationExecution({
  repository: new SupabasePaymentOperationExecutionRepository(service),
  provider: new DurablePaymentSimulator({
    effects: new SupabaseSimulatorEffectRepository(service),
    now: () => new Date().toISOString(),
  }),
  observation: {
    async record(admission, result) {
      if (process.argv[2] === "effect-before-recording") {
        process.stdout.write(`EFFECT_PERSISTED ${admission.operationId}\n`);
        process.exit(0);
      }
      return actualObservation.record(admission, result);
    },
  },
});
const repository = new SupabaseBookingSettlementRepository(
  client("authenticated"),
  service,
);
const result = await createBookingSettlement({ repository, operations }).settle(
  {
    bookingRequestId: "60000000-0000-4000-8000-000000001001",
    commandId: "90000000-0000-4000-8000-000000002280",
    reason: "Settlement review",
  },
);
process.stdout.write(JSON.stringify(result) + "\n");
