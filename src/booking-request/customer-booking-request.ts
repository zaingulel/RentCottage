import type { SupabaseClient } from "@supabase/supabase-js";

import {
  validateQuotedItems,
  type BookingQuoteItem,
} from "@/booking-quote/booking-quote";
import {
  bookingRequestDeclineReasons,
  type BookingRequestDeclineReason,
} from "./booking-request-lifecycle";
import {
  isBookingRequestStatus,
  type BookingRequestStatus,
} from "./booking-request-status";
import { isContactSafeBookingRequestText } from "./booking-request-content";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface CustomerBookingRequest {
  readonly id: string;
  readonly bookingRequestReference: string;
  readonly status: BookingRequestStatus;
  readonly cottageName: string;
  readonly bookingPeriod: BookingQuoteItem[];
  readonly partySize: number;
  readonly bookingPriceIqd: number;
  readonly serviceFeeIqd: number;
  readonly customerTotalIqd: number;
  readonly responseDeadline: string;
  readonly declineReason: BookingRequestDeclineReason | null;
  readonly declineNote: string | null;
  readonly statusNotifications: readonly {
    id: string;
    status: Exclude<BookingRequestStatus, "pending" | "processing">;
    createdAt: string;
  }[];
}

function fromData(value: unknown): CustomerBookingRequest | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const request = value as Record<string, unknown>;
  if (
    typeof request.id !== "string" ||
    !uuid.test(request.id) ||
    typeof request.bookingRequestReference !== "string" ||
    !/^RC-REQ-[A-F0-9]{16}$/.test(request.bookingRequestReference) ||
    !isBookingRequestStatus(request.status) ||
    typeof request.cottageName !== "string" ||
    !Array.isArray(request.bookingPeriod) ||
    !validateQuotedItems(request.bookingPeriod as BookingQuoteItem[]) ||
    !Number.isSafeInteger(request.partySize) ||
    !Number.isSafeInteger(request.bookingPriceIqd) ||
    (request.bookingPriceIqd as number) <= 0 ||
    !Number.isSafeInteger(request.serviceFeeIqd) ||
    (request.serviceFeeIqd as number) < 0 ||
    !Number.isSafeInteger(request.customerTotalIqd) ||
    !Number.isSafeInteger(
      (request.bookingPriceIqd as number) + (request.serviceFeeIqd as number),
    ) ||
    (request.customerTotalIqd as number) !==
      (request.bookingPriceIqd as number) + (request.serviceFeeIqd as number) ||
    typeof request.responseDeadline !== "string" ||
    Number.isNaN(Date.parse(request.responseDeadline)) ||
    !Array.isArray(request.statusNotifications) ||
    request.statusNotifications.some((receipt) => {
      const row = receipt as Record<string, unknown>;
      return (
        !row ||
        typeof row.id !== "string" ||
        !uuid.test(row.id) ||
        !isBookingRequestStatus(row.status) ||
        row.status === "pending" ||
        row.status === "processing" ||
        typeof row.createdAt !== "string" ||
        Number.isNaN(Date.parse(row.createdAt))
      );
    }) ||
    (request.declineReason !== null &&
      (typeof request.declineReason !== "string" ||
        !bookingRequestDeclineReasons.includes(
          request.declineReason as BookingRequestDeclineReason,
        ))) ||
    (request.declineNote !== null &&
      (typeof request.declineNote !== "string" ||
        request.declineNote.length === 0 ||
        request.declineNote.length > 500 ||
        request.declineNote !== request.declineNote.trim() ||
        !isContactSafeBookingRequestText(request.declineNote)))
  )
    return;
  const bookingPeriod = (request.bookingPeriod as BookingQuoteItem[]).map(
    (item): BookingQuoteItem =>
      item.kind === "shift"
        ? {
            serviceDay: item.serviceDay,
            displayName: item.displayName,
            startsAt: item.startsAt,
            endsAt: item.endsAt,
            crossesMidnight: item.crossesMidnight,
            priceIqd: item.priceIqd,
            kind: "shift",
            position: item.position,
          }
        : {
            serviceDay: item.serviceDay,
            displayName: item.displayName,
            startsAt: item.startsAt,
            endsAt: item.endsAt,
            crossesMidnight: item.crossesMidnight,
            priceIqd: item.priceIqd,
            kind: "full-day",
          },
  );
  const statusNotifications = (
    request.statusNotifications as CustomerBookingRequest["statusNotifications"]
  ).map((receipt) => ({
    id: receipt.id,
    status: receipt.status,
    createdAt: receipt.createdAt,
  }));
  return {
    id: request.id,
    bookingRequestReference: request.bookingRequestReference,
    status: request.status,
    cottageName: request.cottageName,
    bookingPeriod,
    partySize: request.partySize as number,
    bookingPriceIqd: request.bookingPriceIqd as number,
    serviceFeeIqd: request.serviceFeeIqd as number,
    customerTotalIqd: request.customerTotalIqd as number,
    responseDeadline: request.responseDeadline,
    declineReason: request.declineReason as BookingRequestDeclineReason | null,
    declineNote: request.declineNote as string | null,
    statusNotifications,
  };
}

export async function getCustomerBookingRequest(
  client: SupabaseClient,
  reference: string,
): Promise<CustomerBookingRequest | null> {
  if (!/^RC-REQ-[A-F0-9]{16}$/.test(reference)) return null;
  const { data, error } = await client.rpc("get_customer_booking_request", {
    target_reference: reference,
  });
  if (error) throw new Error("Booking Request status is unavailable");
  if (data === null) return null;
  const request = fromData(data);
  if (!request) throw new Error("Booking Request status data is invalid");
  return request;
}
