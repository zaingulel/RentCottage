"use server";

import { revalidatePath } from "next/cache";

import { locales } from "@/i18n/routing";

import {
  parseHideCustomerReviewActionInput,
  parseSubmitCustomerReviewActionInput,
  type HideCustomerReviewActionResult,
  type SubmitCustomerReviewActionResult,
} from "./customer-review";
import { createRequestCustomerReview } from "./request-customer-review";

function revalidateCustomerReviewPaths(
  bookingRequestReference: string,
  publicSlug: string,
) {
  for (const locale of locales) {
    revalidatePath(`/${locale}/booking-requests/${bookingRequestReference}`);
    revalidatePath(`/${locale}/cottages/${publicSlug}/reviews`);
    revalidatePath(`/${locale}/administrator/reviews`);
  }
}

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
    revalidateCustomerReviewPaths(
      input.bookingRequestReference,
      input.publicSlug,
    );
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
    revalidateCustomerReviewPaths(
      input.bookingRequestReference,
      input.publicSlug,
    );
  }
  return result;
}
