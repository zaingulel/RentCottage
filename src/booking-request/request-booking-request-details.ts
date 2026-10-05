import "server-only";

import { unstable_rethrow } from "next/navigation";

import type { OwnCustomerReviewResult } from "@/customer-review/customer-review";
import { createRequestCustomerReview } from "@/customer-review/request-customer-review";
import {
  loadRequestNotificationStatus,
  type RequestNotificationPresentation,
} from "@/notification/request-notification-status";
import type { BookingFinancialView } from "./booking-financial-view";
import type {
  CustomerBookingRequestDisplay,
  OwnerBookingRequestNotificationDisplay,
} from "./booking-request-display";
import type { ConfirmedBookingAccess } from "./confirmed-booking-access";
import { loadBookingFinancialView } from "./request-booking-financial-view";
import { loadConfirmedBookingAccess } from "./request-confirmed-booking-access";
import { loadCustomerBookingRequest } from "./request-customer-booking-request";
import { loadOwnerBookingRequest } from "./request-owner-booking-request-notifications";

type BookingRequestDetailsRole = ConfirmedBookingAccess["actorRole"];
type ConfirmedBooking = NonNullable<
  Awaited<ReturnType<typeof loadConfirmedBookingAccess>>
>;

export type CustomerBookingRequestDetails =
  | { readonly outcome: "unavailable" }
  | { readonly outcome: "denied" }
  | {
      readonly outcome: "cancelled";
      readonly financial: BookingFinancialView;
      readonly delivery: RequestNotificationPresentation;
    }
  | {
      readonly outcome: "confirmed";
      readonly confirmed: ConfirmedBooking;
      readonly financial: BookingFinancialView | null;
      readonly review: OwnCustomerReviewResult;
      readonly delivery: RequestNotificationPresentation;
    }
  | {
      readonly outcome: "pending";
      readonly request: CustomerBookingRequestDisplay;
      readonly delivery: RequestNotificationPresentation;
    };

export type OwnerBookingRequestDetails =
  | { readonly outcome: "unavailable" }
  | { readonly outcome: "denied" }
  | {
      readonly outcome: "cancelled";
      readonly financial: BookingFinancialView;
      readonly delivery: RequestNotificationPresentation;
    }
  | {
      readonly outcome: "confirmed";
      readonly confirmed: ConfirmedBooking;
      readonly financial: BookingFinancialView | null;
      readonly delivery: RequestNotificationPresentation;
    }
  | {
      readonly outcome: "pending";
      readonly request: OwnerBookingRequestNotificationDisplay;
      readonly delivery: RequestNotificationPresentation;
    };

const confirmedBookingLoadFailure = {
  customer: {
    message: "Customer confirmed Booking load failed",
    code: "customer_confirmed_booking_failed",
  },
  cottage_owner: {
    message: "Owner confirmed Booking load failed",
    code: "owner_confirmed_booking_failed",
  },
} as const;

export function loadBookingRequestDetails(
  reference: string,
  role: "customer",
): Promise<CustomerBookingRequestDetails>;
export function loadBookingRequestDetails(
  reference: string,
  role: "cottage_owner",
): Promise<OwnerBookingRequestDetails>;
export async function loadBookingRequestDetails(
  reference: string,
  role: BookingRequestDetailsRole,
): Promise<CustomerBookingRequestDetails | OwnerBookingRequestDetails> {
  // Outside every try: a delivery read can never become an unavailable outcome or a log line.
  const delivery = await loadRequestNotificationStatus(reference, role);
  let confirmed;
  let financial: BookingFinancialView | null = null;
  let ownerRequest;
  let loadFailed = false;
  try {
    confirmed = await loadConfirmedBookingAccess(reference);
    financial = await loadBookingFinancialView(reference, role);
    if (role === "cottage_owner" && confirmed === null)
      ownerRequest = await loadOwnerBookingRequest(reference);
  } catch (error) {
    unstable_rethrow(error);
    const { message, code } = confirmedBookingLoadFailure[role];
    console.error(message, { code });
    loadFailed = true;
    confirmed = undefined;
  }
  if (confirmed && confirmed.access.actorRole !== role)
    return { outcome: "denied" };
  if (financial?.cancellation)
    return { outcome: "cancelled", financial, delivery };
  if (loadFailed) return { outcome: "unavailable" };
  if (role === "cottage_owner") {
    if (confirmed)
      return { outcome: "confirmed", confirmed, financial, delivery };
    if (confirmed === undefined) return { outcome: "unavailable" };
    return ownerRequest
      ? { outcome: "pending", request: ownerRequest, delivery }
      : { outcome: "denied" };
  }
  if (confirmed) {
    let review: OwnCustomerReviewResult = { status: "unavailable" };
    try {
      const customerReview = await createRequestCustomerReview();
      if (customerReview) review = await customerReview.getOwn(reference);
    } catch (error) {
      unstable_rethrow(error);
      console.error("Customer review load failed", {
        code: "customer_review_load_unavailable",
      });
    }
    return { outcome: "confirmed", confirmed, financial, review, delivery };
  }
  let request;
  try {
    request = await loadCustomerBookingRequest(reference);
  } catch (error) {
    unstable_rethrow(error);
    console.error("Customer Booking Request status failed", {
      code: "customer_booking_request_status_failed",
    });
  }
  if (request === null) return { outcome: "denied" };
  if (!request) return { outcome: "unavailable" };
  return { outcome: "pending", request, delivery };
}
