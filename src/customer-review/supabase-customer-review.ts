import type { SupabaseClient } from "@supabase/supabase-js";

import {
  hasExactKeys,
  isBookingRequestReference,
  isCustomerReviewBodyWithinLimit,
  isCustomerReviewLanguage,
  isCustomerReviewPageInput,
  isCustomerReviewPublicSlug,
  isCustomerReviewTimestamp,
  isCustomerReviewUuid,
  isHideCustomerReviewInput,
  isPublicCustomerReviewListInput,
  isRecord,
  isSubmitCustomerReviewInput,
  isSubmitCustomerReviewReplyInput,
} from "./customer-review";
import type {
  AdministratorCustomerReview,
  AdministratorCustomerReviewListResult,
  AdministratorCustomerReviewReply,
  CustomerReviewCursor,
  CustomerReviewHide,
  CustomerReviewPageInput,
  HideCustomerReviewInput,
  HideCustomerReviewResult,
  OwnCustomerReviewResult,
  OwnerCustomerReviewReply,
  OwnerCustomerReviewResult,
  PublicCustomerReview,
  PublicCustomerReviewListInput,
  PublicCustomerReviewListResult,
  PublicCustomerReviewReply,
  SubmitCustomerReviewInput,
  SubmitCustomerReviewReplyInput,
  SubmitCustomerReviewReplyResult,
  SubmitCustomerReviewResult,
} from "./customer-review";

function parseCursor(value: unknown): CustomerReviewCursor | null | undefined {
  if (value === null) {
    return null;
  }
  if (
    isRecord(value) &&
    hasExactKeys(value, ["submittedAt", "reviewId"]) &&
    isCustomerReviewTimestamp(value.submittedAt) &&
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

function parseReplyFacts(
  value: Record<string, unknown>,
): PublicCustomerReviewReply | undefined {
  if (
    !isCustomerReviewLanguage(value.originalLanguage) ||
    typeof value.originalBody !== "string" ||
    value.originalBody.length < 1 ||
    !isCustomerReviewBodyWithinLimit(value.originalBody) ||
    !isCustomerReviewTimestamp(value.submittedAt)
  ) {
    return undefined;
  }
  return {
    originalLanguage: value.originalLanguage,
    originalBody: value.originalBody,
    submittedAt: value.submittedAt,
  };
}

function parsePublicReply(
  value: unknown,
): PublicCustomerReviewReply | null | undefined {
  if (value === null) {
    return null;
  }
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["originalLanguage", "originalBody", "submittedAt"])
  ) {
    return undefined;
  }
  return parseReplyFacts(value);
}

function parseOwnerReply(
  value: unknown,
): OwnerCustomerReviewReply | null | undefined {
  if (value === null) {
    return null;
  }
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "originalLanguage",
      "originalBody",
      "submittedAt",
      "moderationState",
    ]) ||
    (value.moderationState !== "hidden" && value.moderationState !== "unhidden")
  ) {
    return undefined;
  }
  const facts = parseReplyFacts(value);
  return facts && { ...facts, moderationState: value.moderationState };
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
      "ownerReply",
    ]) ||
    typeof value.reviewId !== "string" ||
    !isCustomerReviewUuid(value.reviewId) ||
    !Number.isInteger(value.rating) ||
    (value.rating as number) < 1 ||
    (value.rating as number) > 5 ||
    !isCustomerReviewLanguage(value.originalLanguage) ||
    (value.originalBody !== null &&
      (typeof value.originalBody !== "string" ||
        !isCustomerReviewBodyWithinLimit(value.originalBody))) ||
    !isCustomerReviewTimestamp(value.submittedAt)
  ) {
    return undefined;
  }
  const ownerReply = parsePublicReply(value.ownerReply);
  if (ownerReply === undefined) {
    return undefined;
  }
  return {
    reviewId: value.reviewId,
    rating: value.rating as number,
    originalLanguage: value.originalLanguage,
    originalBody: value.originalBody,
    submittedAt: value.submittedAt,
    ownerReply,
  };
}

function parsePublicListResult(value: unknown): PublicCustomerReviewListResult {
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

type CommittedSubmitResult<Committed extends "submitted" | "replied"> =
  | Readonly<{
      status: Committed;
      reviewId: string;
      submittedAt: string;
      affectedPublicSlug: string;
    }>
  | Exclude<SubmitCustomerReviewResult, { status: "submitted" }>;

function parseSubmitResult<Committed extends "submitted" | "replied">(
  value: unknown,
  committed: Committed,
): CommittedSubmitResult<Committed> {
  if (!isRecord(value) || typeof value.status !== "string") {
    return { status: "unavailable" };
  }

  if (
    value.status === committed &&
    hasExactKeys(value, [
      "status",
      "reviewId",
      "submittedAt",
      "affectedPublicSlug",
    ]) &&
    typeof value.reviewId === "string" &&
    isCustomerReviewUuid(value.reviewId) &&
    isCustomerReviewTimestamp(value.submittedAt) &&
    isCustomerReviewPublicSlug(value.affectedPublicSlug)
  ) {
    return {
      status: committed,
      reviewId: value.reviewId,
      submittedAt: value.submittedAt,
      affectedPublicSlug: value.affectedPublicSlug,
    };
  }

  if (
    value.status === "duplicate" &&
    hasExactKeys(value, ["status", "reviewId", "submittedAt"]) &&
    typeof value.reviewId === "string" &&
    isCustomerReviewUuid(value.reviewId) &&
    isCustomerReviewTimestamp(value.submittedAt)
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
    return { status: value.status } as CommittedSubmitResult<Committed>;
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
    isCustomerReviewLanguage(value.originalLanguage) &&
    (value.originalBody === null ||
      (typeof value.originalBody === "string" &&
        isCustomerReviewBodyWithinLimit(value.originalBody))) &&
    isCustomerReviewTimestamp(value.submittedAt) &&
    (value.moderationState === "hidden" || value.moderationState === "unhidden")
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
    isCustomerReviewTimestamp(value.reviewExpiresAt)
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

function parseOwnerReviewResult(value: unknown): OwnerCustomerReviewResult {
  if (!isRecord(value) || typeof value.status !== "string") {
    return { status: "unavailable" };
  }
  if (value.status === "no-review" && hasExactKeys(value, ["status"])) {
    return { status: "no-review" };
  }
  if (
    value.status === "review-hidden" &&
    hasExactKeys(value, ["status", "reply"])
  ) {
    const reply = parseOwnerReply(value.reply);
    if (reply !== undefined) {
      return { status: "review-hidden", reply };
    }
  }
  if (
    value.status === "reviewed" &&
    hasExactKeys(value, [
      "status",
      "rating",
      "originalLanguage",
      "originalBody",
      "submittedAt",
      "reply",
    ]) &&
    Number.isInteger(value.rating) &&
    (value.rating as number) >= 1 &&
    (value.rating as number) <= 5 &&
    isCustomerReviewLanguage(value.originalLanguage) &&
    (value.originalBody === null ||
      (typeof value.originalBody === "string" &&
        isCustomerReviewBodyWithinLimit(value.originalBody))) &&
    isCustomerReviewTimestamp(value.submittedAt)
  ) {
    const reply = parseOwnerReply(value.reply);
    if (reply !== undefined) {
      return {
        status: "reviewed",
        rating: value.rating as number,
        originalLanguage: value.originalLanguage,
        originalBody: value.originalBody,
        submittedAt: value.submittedAt,
        reply,
      };
    }
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
    !isCustomerReviewTimestamp(value.hiddenAt)
  ) {
    return undefined;
  }
  return {
    administratorUserId: value.administratorUserId,
    reason: value.reason,
    hiddenAt: value.hiddenAt,
  };
}

function parseAdministratorReply(
  value: unknown,
): AdministratorCustomerReviewReply | null | undefined {
  if (value === null) {
    return null;
  }
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "authorUserId",
      "originalLanguage",
      "originalBody",
      "submittedAt",
      "moderationState",
      "hide",
    ]) ||
    typeof value.authorUserId !== "string" ||
    !isCustomerReviewUuid(value.authorUserId) ||
    (value.moderationState !== "hidden" && value.moderationState !== "unhidden")
  ) {
    return undefined;
  }
  const facts = parseReplyFacts(value);
  const hide = parseHide(value.hide);
  if (
    facts === undefined ||
    hide === undefined ||
    (value.moderationState === "hidden") !== (hide !== null)
  ) {
    return undefined;
  }
  return {
    ...facts,
    moderationState: value.moderationState,
    authorUserId: value.authorUserId,
    hide,
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
      "reply",
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
    !isCustomerReviewLanguage(value.originalLanguage) ||
    (value.originalBody !== null &&
      (typeof value.originalBody !== "string" ||
        !isCustomerReviewBodyWithinLimit(value.originalBody))) ||
    !isCustomerReviewTimestamp(value.submittedAt) ||
    (value.moderationState !== "hidden" && value.moderationState !== "unhidden")
  ) {
    return undefined;
  }
  const hide = parseHide(value.hide);
  const reply = parseAdministratorReply(value.reply);
  if (
    hide === undefined ||
    reply === undefined ||
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
    reply,
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
    value.status === "already-hidden" &&
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
  if (
    value.status === "hidden" &&
    hasExactKeys(value, [
      "status",
      "reviewId",
      "administratorUserId",
      "reason",
      "hiddenAt",
      "affectedPublicSlug",
      "affectedBookingRequestReference",
    ]) &&
    typeof value.reviewId === "string" &&
    isCustomerReviewUuid(value.reviewId) &&
    isCustomerReviewPublicSlug(value.affectedPublicSlug) &&
    isBookingRequestReference(value.affectedBookingRequestReference)
  ) {
    const hide = parseHide({
      administratorUserId: value.administratorUserId,
      reason: value.reason,
      hiddenAt: value.hiddenAt,
    });
    if (hide !== undefined && hide !== null) {
      return {
        status: "hidden",
        reviewId: value.reviewId,
        ...hide,
        affectedPublicSlug: value.affectedPublicSlug,
        affectedBookingRequestReference: value.affectedBookingRequestReference,
      };
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
    return parseSubmitResult(data, "submitted");
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

  async getOwn(
    bookingRequestReference: string,
  ): Promise<OwnCustomerReviewResult> {
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

  async hide(
    input: HideCustomerReviewInput,
  ): Promise<HideCustomerReviewResult> {
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

  async getOwnerReview(
    bookingRequestReference: string,
  ): Promise<OwnerCustomerReviewResult> {
    if (!isBookingRequestReference(bookingRequestReference)) {
      return { status: "invalid" };
    }
    const response = await callRpc(this.client, "get_owner_customer_review", {
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
    return parseOwnerReviewResult(data);
  }

  async submitReply(
    input: SubmitCustomerReviewReplyInput,
  ): Promise<SubmitCustomerReviewReplyResult> {
    if (!isSubmitCustomerReviewReplyInput(input)) {
      return { status: "invalid" };
    }
    const response = await callRpc(
      this.client,
      "submit_customer_review_reply",
      {
        target_reference: input.bookingRequestReference,
        target_original_language: input.originalLanguage,
        target_original_body: input.originalBody,
      },
    );
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
    return parseSubmitResult(data, "replied");
  }

  async hideReply(
    input: HideCustomerReviewInput,
  ): Promise<HideCustomerReviewResult> {
    if (!isHideCustomerReviewInput(input)) {
      return { status: "invalid" };
    }
    const response = await callRpc(this.client, "hide_customer_review_reply", {
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
