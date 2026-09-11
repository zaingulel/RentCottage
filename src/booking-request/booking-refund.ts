import type {
  ProviderOperationRequest,
  ProviderReconciliationQuery,
  RefundAllocation,
} from "@/payment/payment-contract";
import type { PaymentOperationExecution } from "@/payment/payment-operation-execution";
import {
  refundCapacity,
  refundAllocationTotal,
} from "@/payment/payment-refund-allocation";

export interface BookingRefundFacts {
  readonly bookingRequestId: string;
  readonly revision: string;
  readonly captured: RefundAllocation;
  readonly obligation: RefundAllocation;
  readonly refunded: RefundAllocation;
  readonly reserved: RefundAllocation;
  readonly intents: readonly {
    readonly id: string;
    readonly state:
      | "requested"
      | "processing"
      | "unknown"
      | "succeeded"
      | "failed";
    readonly automatic: boolean;
  }[];
}
export type BookingRefundClaim =
  | { readonly status: "execute"; readonly request: ProviderOperationRequest }
  | { readonly status: "query"; readonly query: ProviderReconciliationQuery }
  | { readonly status: "processing" }
  | { readonly status: "stale" };
export interface BookingRefundRepository {
  facts(bookingRequestId: string): Promise<BookingRefundFacts>;
  requestAutomatic(
    bookingRequestId: string,
    revision: string,
    allocation: RefundAllocation,
  ): Promise<{ readonly status: "requested" | "stale" }>;
  claim(intentId: string): Promise<BookingRefundClaim>;
  due(limit: number): Promise<readonly string[]>;
}
export type BookingRefundResult = {
  readonly status:
    | "settled"
    | "processing"
    | "attention-required"
    | "unavailable";
};
export function selectBookingRefund(
  facts: BookingRefundFacts,
):
  | { readonly action: "request"; readonly allocation: RefundAllocation }
  | { readonly action: "process"; readonly intentId: string }
  | { readonly action: "settled" | "attention-required" } {
  const capacity = refundCapacity(facts);
  const pending = facts.intents.find((intent) =>
    ["requested", "processing", "unknown"].includes(intent.state),
  );
  if (pending) return { action: "process", intentId: pending.id };
  if (refundAllocationTotal(facts.reserved) > 0)
    return { action: "attention-required" };
  const owed = {
    bookingPriceFils: Math.max(
      0,
      facts.obligation.bookingPriceFils - facts.refunded.bookingPriceFils,
    ),
    bookingServiceFeeFils: Math.max(
      0,
      facts.obligation.bookingServiceFeeFils -
        facts.refunded.bookingServiceFeeFils,
    ),
  };
  if (refundAllocationTotal(owed) === 0)
    return {
      action:
        refundAllocationTotal(facts.obligation) === 0 &&
        refundAllocationTotal(facts.refunded) <
          refundAllocationTotal(facts.captured) &&
        facts.intents.some((intent) => intent.state === "failed")
          ? "attention-required"
          : "settled",
    };
  if (
    facts.intents.some(
      (intent) => intent.automatic && intent.state === "failed",
    )
  )
    return { action: "attention-required" };
  refundCapacity({
    captured: capacity.available,
    refunded: owed,
    reserved: { bookingPriceFils: 0, bookingServiceFeeFils: 0 },
  });
  return { action: "request", allocation: owed };
}
export function createBookingRefund({
  repository,
  operations,
}: {
  repository: BookingRefundRepository;
  operations: PaymentOperationExecution;
}) {
  async function resume(
    bookingRequestId: string,
  ): Promise<BookingRefundResult> {
    for (let progress = 0; progress < 8; progress += 1) {
      const facts = await repository.facts(bookingRequestId);
      if (facts.bookingRequestId !== bookingRequestId)
        throw new Error("Refund facts belong to another booking.");
      const selected = selectBookingRefund(facts);
      if (selected.action === "request") {
        await repository.requestAutomatic(
          bookingRequestId,
          facts.revision,
          selected.allocation,
        );
        continue;
      }
      if (selected.action !== "process") return { status: selected.action };
      const claim = await repository.claim(selected.intentId);
      if (claim.status === "stale") continue;
      if (claim.status === "processing") return { status: "processing" };
      const execution =
        claim.status === "execute"
          ? await operations.execute(claim.request)
          : await operations.query(claim.query);
      if (execution.status === "not-admitted") continue;
      if (execution.status !== "recorded") return { status: "processing" };
      if (execution.result.outcome === "indeterminate")
        return { status: "attention-required" };
    }
    return { status: "processing" };
  }
  return {
    resume,
    async processDue(limit: number): Promise<readonly BookingRefundResult[]> {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
        throw new Error("Invalid refund batch size.");
      const results: BookingRefundResult[] = [];
      for (const id of await repository.due(limit)) {
        try {
          results.push(await resume(id));
        } catch {
          results.push({ status: "unavailable" });
        }
      }
      return results;
    },
  };
}
