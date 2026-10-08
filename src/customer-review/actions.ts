"use server";

import { revalidatePath } from "next/cache";

import { locales } from "@/i18n/routing";

import {
  isHideCustomerReviewInput,
  isSubmitCustomerReviewInput,
  isSubmitCustomerReviewReplyInput,
  type HideCustomerReviewActionResult,
  type SubmitCustomerReviewActionResult,
  type SubmitCustomerReviewReplyActionResult,
} from "./customer-review";
import { createRequestCustomerReview } from "./request-customer-review";

function revalidateCustomerReviewPaths(
  bookingRequestReference: string,
  publicSlug: string,
) {
  for (const locale of locales) {
    revalidatePath(`/${locale}/booking-requests/${bookingRequestReference}`);
    revalidatePath(
      `/${locale}/owner/booking-requests/${bookingRequestReference}`,
    );
    revalidatePath(`/${locale}/cottages/${publicSlug}/reviews`);
    revalidatePath(`/${locale}/administrator/reviews`);
  }
}

export async function submitCustomerReview(
  value: unknown,
): Promise<SubmitCustomerReviewActionResult> {
  if (!isSubmitCustomerReviewInput(value)) {
    return { status: "invalid" };
  }
  const input = value;

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
      result.affectedPublicSlug,
    );
    return {
      status: result.status,
      reviewId: result.reviewId,
      submittedAt: result.submittedAt,
    };
  }
  if (result.status === "duplicate") {
    return {
      status: result.status,
      reviewId: result.reviewId,
      submittedAt: result.submittedAt,
    };
  }
  return { status: result.status };
}

export async function submitCustomerReviewReply(
  value: unknown,
): Promise<SubmitCustomerReviewReplyActionResult> {
  if (!isSubmitCustomerReviewReplyInput(value)) {
    return { status: "invalid" };
  }
  const input = value;

  let result;
  try {
    const request = await createRequestCustomerReview();
    if (!request) {
      return { status: "unavailable", recovery: "refresh-owner-review" };
    }
    const userId = await request.authenticatedUserId();
    if (!userId) {
      return { status: "access-required" };
    }
    result = await request.submitReply({
      bookingRequestReference: input.bookingRequestReference,
      originalLanguage: input.originalLanguage,
      originalBody: input.originalBody,
    });
  } catch {
    console.error("customer-review-reply-submit-unavailable");
    return { status: "unavailable", recovery: "refresh-owner-review" };
  }
  if (result.status === "unavailable") {
    return { status: "unavailable", recovery: "refresh-owner-review" };
  }
  if (result.status === "replied") {
    revalidateCustomerReviewPaths(
      input.bookingRequestReference,
      result.affectedPublicSlug,
    );
    return {
      status: result.status,
      reviewId: result.reviewId,
      submittedAt: result.submittedAt,
    };
  }
  if (result.status === "duplicate") {
    return {
      status: result.status,
      reviewId: result.reviewId,
      submittedAt: result.submittedAt,
    };
  }
  return { status: result.status };
}

async function hideThroughReviewSeam(
  value: unknown,
  operation: "hide" | "hideReply",
  unavailableLogTag: string,
): Promise<HideCustomerReviewActionResult> {
  if (!isHideCustomerReviewInput(value)) {
    return { status: "invalid" };
  }
  const input = value;

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
    result = await request[operation]({
      reviewId: input.reviewId,
      reason: input.reason,
    });
  } catch {
    console.error(unavailableLogTag);
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
      result.affectedBookingRequestReference,
      result.affectedPublicSlug,
    );
    return {
      status: result.status,
      reviewId: result.reviewId,
      administratorUserId: result.administratorUserId,
      reason: result.reason,
      hiddenAt: result.hiddenAt,
    };
  }
  if (result.status === "already-hidden") {
    return {
      status: result.status,
      reviewId: result.reviewId,
      administratorUserId: result.administratorUserId,
      reason: result.reason,
      hiddenAt: result.hiddenAt,
    };
  }
  return { status: result.status };
}

export async function hideCustomerReview(
  value: unknown,
): Promise<HideCustomerReviewActionResult> {
  return hideThroughReviewSeam(
    value,
    "hide",
    "customer-review-hide-unavailable",
  );
}

export async function hideCustomerReviewReply(
  value: unknown,
): Promise<HideCustomerReviewActionResult> {
  return hideThroughReviewSeam(
    value,
    "hideReply",
    "customer-review-reply-hide-unavailable",
  );
}
