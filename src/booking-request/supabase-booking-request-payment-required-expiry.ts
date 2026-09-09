import type { SupabaseClient } from "@supabase/supabase-js";
import type { PaymentProviderIdentity } from "@/payment/payment-contract";
import type {
  BookingRequestPaymentRequiredExpiryRepository,
  PaymentRequiredExpiryCommand,
  PaymentRequiredExpiryResult,
} from "./booking-request-payment-required-expiry";
import { bookingRequestPaymentFactsFrom } from "./supabase-booking-request-payment-observation";
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
export class SupabaseBookingRequestPaymentRequiredExpiryRepository implements BookingRequestPaymentRequiredExpiryRepository {
  constructor(private readonly serviceClient: SupabaseClient) {}

  async due(
    limit: number,
    providerIdentity: PaymentProviderIdentity,
  ): Promise<readonly string[]> {
    const { data, error } = await this.serviceClient.rpc(
      "claim_due_booking_request_payment_required_expiries",
      { target_limit: limit, target_provider_identity: providerIdentity },
    );
    if (error || !Array.isArray(data) || data.length > limit)
      throw new Error("Payment Required expiry batch is invalid");
    const ids = data.map((item) => record(item)?.bookingRequestId);
    if (
      !ids.every((id) => typeof id === "string" && uuid.test(id)) ||
      new Set(ids).size !== ids.length
    )
      throw new Error("Payment Required expiry batch is invalid");
    return ids as string[];
  }

  async facts(bookingRequestId: string) {
    const { data, error } = await this.serviceClient.rpc(
      "get_booking_request_payment_facts",
      { target_booking_request_id: bookingRequestId },
    );
    if (error) throw new Error("Payment Required expiry facts are unavailable");
    const facts = bookingRequestPaymentFactsFrom(data);
    if (facts.bookingRequestId !== bookingRequestId)
      throw new Error("Expiry facts belong to another Booking Request");
    return facts;
  }
  async prepare(
    bookingRequestId: string,
    providerIdentity: PaymentProviderIdentity,
    command: PaymentRequiredExpiryCommand,
  ): Promise<
    | { readonly status: "prepared" }
    | { readonly status: "stale" }
    | PaymentRequiredExpiryResult
  > {
    const { data, error } = await this.serviceClient.rpc(
      "prepare_booking_request_payment_required_expiry",
      {
        target_booking_request_id: bookingRequestId,
        target_provider_identity: providerIdentity,
        target_command: command,
      },
    );
    if (
      error ||
      ![
        "prepared",
        "stale",
        "quarantined",
        "expired",
        "confirmed",
        "not-due",
      ].includes(data?.status)
    )
      throw new Error("Payment Required expiry preparation is unavailable");
    return { status: data.status };
  }

  async finalize(
    bookingRequestId: string,
  ): Promise<PaymentRequiredExpiryResult> {
    const { data, error } = await this.serviceClient.rpc(
      "finalize_booking_request_payment_required_expiry",
      { target_booking_request_id: bookingRequestId },
    );
    const value = record(data);
    if (
      error ||
      !value ||
      value.bookingRequestId !== bookingRequestId ||
      ![
        "processing",
        "attention-required",
        "quarantined",
        "expired",
        "confirmed",
        "not-due",
      ].includes(value.status as string)
    )
      throw new Error("Payment Required expiry finalization is unavailable");
    return { status: value.status } as PaymentRequiredExpiryResult;
  }
}
