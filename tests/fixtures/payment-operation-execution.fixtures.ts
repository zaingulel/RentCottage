import type { PaymentProviderAdapter } from "../../src/payment/payment-contract";
import type { PaymentOperationExecution } from "../../src/payment/payment-operation-execution";

// Application outcome fixtures supply already-recorded results; durable recording has its own public-seam observer.
export function withRecordedProviderResults<
  T extends
    | { provider: PaymentProviderAdapter }
    | { paymentProvider: PaymentProviderAdapter },
>(input: T): T & { operations: PaymentOperationExecution } {
  const provider = "provider" in input ? input.provider : input.paymentProvider;
  return {
    ...input,
    operations: {
      async execute(request) {
        return { status: "recorded", result: await provider.execute(request) };
      },
      async query(request) {
        return { status: "recorded", result: await provider.query(request) };
      },
    },
  };
}
