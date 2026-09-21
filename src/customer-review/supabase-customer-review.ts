import type { SupabaseClient } from "@supabase/supabase-js";

import {
  isBookingRequestReference,
  isCustomerReviewPageInput,
  isCustomerReviewTimestamp,
  isCustomerReviewUuid,
  isHideCustomerReviewInput,
  isPublicCustomerReviewListInput,
  isSubmitCustomerReviewInput,
} from "./customer-review";
import type {
  AdministratorCustomerReview,
  AdministratorCustomerReviewListResult,
  CustomerReviewCursor,
  CustomerReviewHide,
  CustomerReviewLanguage,
  CustomerReviewPageInput,
  HideCustomerReviewInput,
  HideCustomerReviewResult,
  OwnCustomerReviewResult,
  PublicCustomerReview,
  PublicCustomerReviewListInput,
  PublicCustomerReviewListResult,
  SubmitCustomerReviewInput,
  SubmitCustomerReviewResult,
} from "./customer-review";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isTimestamp(value: unknown): value is string {
  return isCustomerReviewTimestamp(value);
}

function isLanguage(value: unknown): value is CustomerReviewLanguage {
  return value === "ar" || value === "ckb" || value === "en";
}

function parseCursor(value: unknown): CustomerReviewCursor | null | undefined {
  if (value === null) {
    return null;
  }
  if (
    isRecord(value) &&
    hasExactKeys(value, ["submittedAt", "reviewId"]) &&
    isTimestamp(value.submittedAt) &&
    typeof value.reviewId === "string" &&
    isCustomerReviewUuid(value.reviewId)
  ) {
    return {
      submittedAt: value.submittedAt,
      reviewId: value.reviewId,
    };
  }
  return undefined;
}

function parsePublicReview(value: unknown): PublicCustomerReview | undefined {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "reviewId",
      "rating",
      "originalLanguage",
      "originalBody",
      "submittedAt",
    ]) ||
    typeof value.reviewId !== "string" ||
    !isCustomerReviewUuid(value.reviewId) ||
    !Number.isInteger(value.rating) ||
    (value.rating as number) < 1 ||
    (value.rating as number) > 5 ||
    !isLanguage(value.originalLanguage) ||
    (value.originalBody !== null &&
      (typeof value.originalBody !== "string" ||
        value.originalBody.length > 2000)) ||
    !isTimestamp(value.submittedAt)
  ) {
    return undefined;
  }
  return {
    reviewId: value.reviewId,
    rating: value.rating as number,
    originalLanguage: value.originalLanguage,
    originalBody: value.originalBody,
    submittedAt: value.submittedAt,
  };
}

function parsePublicListResult(
  value: unknown,
): PublicCustomerReviewListResult {
  if (!isRecord(value) || typeof value.status !== "string") {
    return { status: "unavailable" };
  }
  if (value.status === "not-found" && hasExactKeys(value, ["status"])) {
    return { status: "not-found" };
  }
  if (
    value.status !== "success" ||
    !hasExactKeys(value, ["status", "items", "nextCursor"]) ||
    !Array.isArray(value.items)
  ) {
    return { status: "unavailable" };
  }

  const items = value.items.map(parsePublicReview);
  const nextCursor = parseCursor(value.nextCursor);
  if (items.some((item) => item === undefined) || nextCursor === undefined) {
    return { status: "unavailable" };
  }
  return {
    status: "success",
    items: items as PublicCustomerReview[],
    nextCursor,
  };
}

function parseSubmitResult(value: unknown): SubmitCustomerReviewResult {
  if (!isRecord(value) || typeof value.status !== "string") {
    return { status: "unavailable" };
  }

  if (
    (value.status === "submitted" || value.status === "duplicate") &&
    hasExactKeys(value, ["status", "reviewId", "submittedAt"]) &&
    typeof value.reviewId === "string" &&
    isCustomerReviewUuid(value.reviewId) &&
    isTimestamp(value.submittedAt)
  ) {
    return {
      status: value.status,
      reviewId: value.reviewId,
      submittedAt: value.submittedAt,
    };
  }

  if (
    ["invalid", "ineligible", "prohibited-content"].includes(value.status) &&
    hasExactKeys(value, ["status"])
  ) {
    return { status: value.status } as SubmitCustomerReviewResult;
  }

  return { status: "unavailable" };
}

function parseOwnReviewResult(value: unknown): OwnCustomerReviewResult {
  if (!isRecord(value) || typeof value.status !== "string") {
    return { status: "unavailable" };
  }
  if (
    value.status === "submitted" &&
    hasExactKeys(value, [
      "status",
      "reviewId",
      "rating",
      "originalLanguage",
      "originalBody",
      "submittedAt",
      "moderationState",
    ]) &&
    typeof value.reviewId === "string" &&
    isCustomerReviewUuid(value.reviewId) &&
    Number.isInteger(value.rating) &&
    (value.rating as number) >= 1 &&
    (value.rating as number) <= 5 &&
    isLanguage(value.originalLanguage) &&
    (value.originalBody === null || typeof value.originalBody === "string") &&
    isTimestamp(value.submittedAt) &&
    (value.moderationState === "hidden" ||
      value.moderationState === "unhidden")
  ) {
    return {
      status: "submitted",
      reviewId: value.reviewId,
      rating: value.rating as number,
      originalLanguage: value.originalLanguage,
      originalBody: value.originalBody,
      submittedAt: value.submittedAt,
      moderationState: value.moderationState,
    };
  }
  if (
    value.status === "eligible" &&
    hasExactKeys(value, ["status", "reviewExpiresAt"]) &&
    isTimestamp(value.reviewExpiresAt)
  ) {
    return { status: "eligible", reviewExpiresAt: value.reviewExpiresAt };
  }
  if (
    (value.status === "ineligible" || value.status === "unavailable") &&
    hasExactKeys(value, ["status"])
  ) {
    return { status: value.status };
  }
  return { status: "unavailable" };
}

function parseHide(value: unknown): CustomerReviewHide | null | undefined {
  if (value === null) {
    return null;
  }
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["administratorUserId", "reason", "hiddenAt"]) ||
    typeof value.administratorUserId !== "string" ||
    !isCustomerReviewUuid(value.administratorUserId) ||
    typeof value.reason !== "string" ||
    value.reason.length < 1 ||
    value.reason.length > 2000 ||
    !isTimestamp(value.hiddenAt)
  ) {
    return undefined;
  }
  return {
    administratorUserId: value.administratorUserId,
    reason: value.reason,
    hiddenAt: value.hiddenAt,
  };
}

function parseAdministratorReview(
  value: unknown,
): AdministratorCustomerReview | undefined {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "reviewId",
      "bookingRequestReference",
      "profileId",
      "authorUserId",
      "rating",
      "originalLanguage",
      "originalBody",
      "submittedAt",
      "moderationState",
      "hide",
    ]) ||
    typeof value.reviewId !== "string" ||
    !isCustomerReviewUuid(value.reviewId) ||
    !isBookingRequestReference(value.bookingRequestReference) ||
    typeof value.profileId !== "string" ||
    !isCustomerReviewUuid(value.profileId) ||
    typeof value.authorUserId !== "string" ||
    !isCustomerReviewUuid(value.authorUserId) ||
    !Number.isInteger(value.rating) ||
    (value.rating as number) < 1 ||
    (value.rating as number) > 5 ||
    !isLanguage(value.originalLanguage) ||
    (value.originalBody !== null &&
      (typeof value.originalBody !== "string" ||
        value.originalBody.length > 2000)) ||
    !isTimestamp(value.submittedAt) ||
    (value.moderationState !== "hidden" &&
      value.moderationState !== "unhidden")
  ) {
    return undefined;
  }
  const hide = parseHide(value.hide);
  if (
    hide === undefined ||
    (value.moderationState === "hidden") !== (hide !== null)
  ) {
    return undefined;
  }
  return {
    reviewId: value.reviewId,
    bookingRequestReference: value.bookingRequestReference,
    profileId: value.profileId,
    authorUserId: value.authorUserId,
    rating: value.rating as number,
    originalLanguage: value.originalLanguage,
    originalBody: value.originalBody,
    submittedAt: value.submittedAt,
    moderationState: value.moderationState,
    hide,
  };
}

function parseAdministratorListResult(
  value: unknown,
): AdministratorCustomerReviewListResult {
  if (
    !isRecord(value) ||
    value.status !== "success" ||
    !hasExactKeys(value, ["status", "items", "nextCursor"]) ||
    !Array.isArray(value.items)
  ) {
    return { status: "unavailable" };
  }
  const items = value.items.map(parseAdministratorReview);
  const nextCursor = parseCursor(value.nextCursor);
  if (items.some((item) => item === undefined) || nextCursor === undefined) {
    return { status: "unavailable" };
  }
  return {
    status: "success",
    items: items as AdministratorCustomerReview[],
    nextCursor,
  };
}

function parseHideResult(value: unknown): HideCustomerReviewResult {
  if (!isRecord(value) || typeof value.status !== "string") {
    return { status: "unavailable" };
  }
  if (value.status === "invalid" && hasExactKeys(value, ["status"])) {
    return { status: "invalid" };
  }
  if (
    (value.status === "hidden" || value.status === "already-hidden") &&
    hasExactKeys(value, [
      "status",
      "reviewId",
      "administratorUserId",
      "reason",
      "hiddenAt",
    ]) &&
    typeof value.reviewId === "string" &&
    isCustomerReviewUuid(value.reviewId)
  ) {
    const hide = parseHide({
      administratorUserId: value.administratorUserId,
      reason: value.reason,
      hiddenAt: value.hiddenAt,
    });
    if (hide !== undefined && hide !== null) {
      return { status: value.status, reviewId: value.reviewId, ...hide };
    }
  }
  return { status: "unavailable" };
}

function errorCode(error: unknown) {
  return isRecord(error) && typeof error.code === "string"
    ? error.code
    : undefined;
}

async function callRpc(
  client: SupabaseClient,
  name: string,
  parameters: Record<string, unknown>,
): Promise<Readonly<{ data: unknown; error: unknown }> | undefined> {
  try {
    const { data, error } = await client.rpc(name, parameters);
    return { data, error };
  } catch {
    return undefined;
  }
}

export class SupabaseCustomerReviewRepository {
  constructor(private readonly client: SupabaseClient) {}

  async submit(
    input: SubmitCustomerReviewInput,
  ): Promise<SubmitCustomerReviewResult> {
    if (!isSubmitCustomerReviewInput(input)) {
      return { status: "invalid" };
    }
    const response = await callRpc(this.client, "submit_customer_review", {
      target_reference: input.bookingRequestReference,
      target_rating: input.rating,
      target_original_language: input.originalLanguage,
      target_original_body: input.originalBody,
    });
    if (!response) {
      return { status: "unavailable" };
    }
    const { data, error } = response;

    if (errorCode(error) === "42501") {
      return { status: "access-required" };
    }
    if (error !== null) {
      return { status: "unavailable" };
    }
    return parseSubmitResult(data);
  }

  async listPublic(
    input: PublicCustomerReviewListInput,
  ): Promise<PublicCustomerReviewListResult> {
    if (!isPublicCustomerReviewListInput(input)) {
      return { status: "invalid" };
    }
    const response = await callRpc(
      this.client,
      "list_public_customer_reviews",
      {
        target_slug: input.publicSlug,
        target_before_at: input.beforeAt,
        target_before_id: input.beforeId,
        target_limit: input.limit,
      },
    );
    if (!response) {
      return { status: "unavailable" };
    }
    const { data, error } = response;
    if (errorCode(error) === "22023") {
      return { status: "invalid" };
    }
    if (error !== null) {
      return { status: "unavailable" };
    }
    return parsePublicListResult(data);
  }

  async getOwn(bookingRequestReference: string): Promise<OwnCustomerReviewResult> {
    if (!isBookingRequestReference(bookingRequestReference)) {
      return { status: "invalid" };
    }
    const response = await callRpc(this.client, "get_customer_review", {
      target_reference: bookingRequestReference,
    });
    if (!response) {
      return { status: "unavailable" };
    }
    const { data, error } = response;
    if (errorCode(error) === "42501") {
      return { status: "access-required" };
    }
    if (error !== null) {
      return { status: "unavailable" };
    }
    return parseOwnReviewResult(data);
  }

  async listAdministrator(
    input: CustomerReviewPageInput,
  ): Promise<AdministratorCustomerReviewListResult> {
    if (!isCustomerReviewPageInput(input)) {
      return { status: "invalid" };
    }
    const response = await callRpc(
      this.client,
      "list_administrator_customer_reviews",
      {
        target_before_at: input.beforeAt,
        target_before_id: input.beforeId,
        target_limit: input.limit,
      },
    );
    if (!response) {
      return { status: "unavailable" };
    }
    const { data, error } = response;
    if (errorCode(error) === "42501") {
      return { status: "access-required" };
    }
    if (errorCode(error) === "22023") {
      return { status: "invalid" };
    }
    if (error !== null) {
      return { status: "unavailable" };
    }
    return parseAdministratorListResult(data);
  }

  async hide(input: HideCustomerReviewInput): Promise<HideCustomerReviewResult> {
    if (!isHideCustomerReviewInput(input)) {
      return { status: "invalid" };
    }
    const response = await callRpc(this.client, "hide_customer_review", {
      target_review_id: input.reviewId,
      target_reason: input.reason,
    });
    if (!response) {
      return { status: "unavailable" };
    }
    const { data, error } = response;
    if (errorCode(error) === "42501") {
      return { status: "access-required" };
    }
    if (error !== null) {
      return { status: "unavailable" };
    }
    return parseHideResult(data);
  }
}
