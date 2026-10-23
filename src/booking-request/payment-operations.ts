import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readServerEnvironment } from "@/config/server-environment";
import { DurablePaymentSimulator } from "@/payment/durable-payment-simulator-core";
import type { PaymentProviderAdapter } from "@/payment/payment-contract";
import {
  createPaymentOperationExecution,
  type PaymentOperationExecution,
} from "@/payment/payment-operation-execution";
import {
  SupabasePaymentOperationExecutionRepository,
  SupabaseSimulatorEffectRepository,
} from "@/payment/supabase-payment-operation-execution";
import { createBookingRequestPaymentObservation } from "./booking-request-payment-observation";
import { fictionalSupplierEnvironment } from "./fictional-supplier-environment-core";
import { SupabaseBookingRequestPaymentObservationRepository } from "./supabase-booking-request-payment-observation";

export type PaymentOperationsEnvironment = NonNullable<
  Parameters<typeof fictionalSupplierEnvironment>[0]
>;

export interface PaymentOperations {
  readonly serviceClient: SupabaseClient;
  readonly provider: PaymentProviderAdapter;
  readonly operations: PaymentOperationExecution;
}

export function preparePaymentOperations(
  environment: PaymentOperationsEnvironment,
): (() => PaymentOperations) | undefined {
  const failedInitialCaptureLifecycleId =
    environment.HOSTED_DEMO_FAILED_CAPTURE_LIFECYCLE_ID !== undefined
      ? readServerEnvironment(environment).failedInitialCaptureLifecycleId
      : undefined;
  const supplierEnvironment = fictionalSupplierEnvironment(environment);
  const secretKey = environment.SUPABASE_SECRET_KEY;
  if (!supplierEnvironment || !secretKey) return undefined;
  return () => {
    const serviceClient = createClient(
      environment.SUPABASE_URL as string,
      secretKey,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const provider = new DurablePaymentSimulator({
      environment: supplierEnvironment,
      failedInitialCaptureLifecycleId,
      effects: new SupabaseSimulatorEffectRepository(serviceClient),
      now: () => new Date().toISOString(),
    });
    const operations = createPaymentOperationExecution({
      repository: new SupabasePaymentOperationExecutionRepository(
        serviceClient,
      ),
      provider,
      observation: createBookingRequestPaymentObservation({
        repository: new SupabaseBookingRequestPaymentObservationRepository(
          serviceClient,
        ),
      }),
    });
    return { serviceClient, provider, operations };
  };
}

export function createPaymentOperations(
  environment: PaymentOperationsEnvironment,
): PaymentOperations | undefined {
  return preparePaymentOperations(environment)?.();
}
