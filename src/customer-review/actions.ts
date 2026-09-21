"use server";

import { revalidatePath } from "next/cache";

import {
  parseHideCustomerReviewActionInput,
  parseSubmitCustomerReviewActionInput,
  type HideCustomerReviewActionResult,
  type SubmitCustomerReviewActionResult,
} from "./customer-review";
import { createRequestCustomerReview } from "./request-customer-review";

export async function submitCustomerReview(
  value: unknown,
): Promise<SubmitCustomerReviewActionResult> {
  const input = parseSubmitCustomerReviewActionInput(value);
  if (!input) {
    return { status: "invalid" };
  }

  let result;
  try {
    const request = await createRequestCustomerReview();
    if (!request) {
      return { status: "unavailable", recovery: "refresh-own-review" };
    }
    const userId = await request.authenticatedUserId();
    if (!userId) {
      return { status: "access-required" };
    }
    result = await request.submit({
      bookingRequestReference: input.bookingRequestReference,
      rating: input.rating,
      originalLanguage: input.originalLanguage,
      originalBody: input.originalBody,
    });
  } catch {
    console.error("customer-review-submit-unavailable");
    return { status: "unavailable", recovery: "refresh-own-review" };
  }
  if (result.status === "unavailable") {
    return { status: "unavailable", recovery: "refresh-own-review" };
  }
  if (result.status === "submitted") {
    revalidatePath(
      `/${input.locale}/booking-requests/${input.bookingRequestReference}`,
    );
    revalidatePath(`/${input.locale}/cottages/${input.publicSlug}/reviews`);
    revalidatePath(`/${input.locale}/administrator/reviews`);
  }
  return result;
}

export async function hideCustomerReview(
  value: unknown,
): Promise<HideCustomerReviewActionResult> {
  const input = parseHideCustomerReviewActionInput(value);
  if (!input) {
    return { status: "invalid" };
  }

  let result;
  try {
    const request = await createRequestCustomerReview();
    if (!request) {
      return {
        status: "unavailable",
        recovery: "reload-administrator-reviews",
      };
    }
    const userId = await request.authenticatedUserId();
    if (!userId) {
      return { status: "access-required" };
    }
    result = await request.hide({
      reviewId: input.reviewId,
      reason: input.reason,
    });
  } catch {
    console.error("customer-review-hide-unavailable");
    return {
      status: "unavailable",
      recovery: "reload-administrator-reviews",
    };
  }
  if (result.status === "unavailable") {
    return {
      status: "unavailable",
      recovery: "reload-administrator-reviews",
    };
  }
  if (result.status === "hidden") {
    revalidatePath(
      `/${input.locale}/booking-requests/${input.bookingRequestReference}`,
    );
    revalidatePath(`/${input.locale}/cottages/${input.publicSlug}/reviews`);
    revalidatePath(`/${input.locale}/administrator/reviews`);
  }
  return result;
}
