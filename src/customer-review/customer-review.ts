export type CustomerReviewLanguage = "ar" | "ckb" | "en";
export type CustomerReviewLocale = CustomerReviewLanguage;

const bookingRequestReferencePattern = /^RC-REQ-[A-F0-9]{16}$/;
const publicSlugPattern = /^cottage-[0-9a-f]{32}$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

export function isCustomerReviewLanguage(
  value: unknown,
): value is CustomerReviewLanguage {
  return value === "ar" || value === "ckb" || value === "en";
}

export function isCustomerReviewUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

export function isCustomerReviewTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) &&
    Number.isFinite(Date.parse(value))
  );
}

export function isBookingRequestReference(value: unknown): value is string {
  return typeof value === "string" && bookingRequestReferencePattern.test(value);
}

export function isCustomerReviewPublicSlug(value: unknown): value is string {
  return typeof value === "string" && publicSlugPattern.test(value);
}

export type SubmitCustomerReviewInput = Readonly<{
  bookingRequestReference: string;
  rating: number;
  originalLanguage: CustomerReviewLanguage;
  originalBody: string | null;
}>;

export function isSubmitCustomerReviewInput(
  value: unknown,
): value is SubmitCustomerReviewInput {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "bookingRequestReference",
      "rating",
      "originalLanguage",
      "originalBody",
    ]) &&
    isBookingRequestReference(value.bookingRequestReference) &&
    Number.isInteger(value.rating) &&
    (value.rating as number) >= 1 &&
    (value.rating as number) <= 5 &&
    isCustomerReviewLanguage(value.originalLanguage) &&
    (value.originalBody === null ||
      (typeof value.originalBody === "string" &&
        value.originalBody.length <= 2000))
  );
}

export type SubmitCustomerReviewResult =
  | Readonly<{
      status: "submitted";
      reviewId: string;
      submittedAt: string;
      affectedPublicSlug: string;
    }>
  | Readonly<{
      status: "duplicate";
      reviewId: string;
      submittedAt: string;
    }>
  | Readonly<{
      status:
        | "access-required"
        | "invalid"
        | "ineligible"
        | "prohibited-content"
        | "unavailable";
    }>;

export type SubmitCustomerReviewActionResult =
  | Readonly<{
      status: "submitted" | "duplicate";
      reviewId: string;
      submittedAt: string;
    }>
  | Readonly<{
      status:
        | "access-required"
        | "invalid"
        | "ineligible"
        | "prohibited-content";
    }>
  |
  Readonly<{
    status: "unavailable";
    recovery: "refresh-own-review";
  }>;

export type SubmitCustomerReviewActionInput = SubmitCustomerReviewInput &
  Readonly<{
    locale: CustomerReviewLocale;
  }>;

export function parseSubmitCustomerReviewActionInput(
  value: unknown,
): SubmitCustomerReviewActionInput | undefined {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "locale",
      "bookingRequestReference",
      "rating",
      "originalLanguage",
      "originalBody",
    ]) ||
    !isCustomerReviewLanguage(value.locale) ||
    !isBookingRequestReference(value.bookingRequestReference) ||
    !Number.isInteger(value.rating) ||
    (value.rating as number) < 1 ||
    (value.rating as number) > 5 ||
    !isCustomerReviewLanguage(value.originalLanguage) ||
    (value.originalBody !== null &&
      (typeof value.originalBody !== "string" ||
        value.originalBody.length > 2000))
  ) {
    return undefined;
  }
  return value as SubmitCustomerReviewActionInput;
}

export type CustomerReviewCursor = Readonly<{
  submittedAt: string;
  reviewId: string;
}>;

export type CustomerReviewPageInput = Readonly<{
  beforeAt: string | null;
  beforeId: string | null;
  limit: number;
}>;

export function isCustomerReviewPageInput(
  value: unknown,
): value is CustomerReviewPageInput {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["beforeAt", "beforeId", "limit"]) ||
    !Number.isInteger(value.limit) ||
    (value.limit as number) < 1 ||
    (value.limit as number) > 50
  ) {
    return false;
  }
  return (
    (value.beforeAt === null && value.beforeId === null) ||
    (isCustomerReviewTimestamp(value.beforeAt) &&
      isCustomerReviewUuid(value.beforeId))
  );
}

export type PublicCustomerReviewListInput = CustomerReviewPageInput &
  Readonly<{ publicSlug: string }>;

export function isPublicCustomerReviewListInput(
  value: unknown,
): value is PublicCustomerReviewListInput {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["publicSlug", "beforeAt", "beforeId", "limit"]) &&
    isCustomerReviewPublicSlug(value.publicSlug) &&
    isCustomerReviewPageInput({
      beforeAt: value.beforeAt,
      beforeId: value.beforeId,
      limit: value.limit,
    })
  );
}

export type PublicCustomerReview = Readonly<{
  reviewId: string;
  rating: number;
  originalLanguage: CustomerReviewLanguage;
  originalBody: string | null;
  submittedAt: string;
}>;

export type PublicCustomerReviewListResult =
  | Readonly<{
      status: "success";
      items: readonly PublicCustomerReview[];
      nextCursor: CustomerReviewCursor | null;
    }>
  | Readonly<{ status: "not-found" | "invalid" | "unavailable" }>;

export type OwnCustomerReviewResult =
  | Readonly<{
      status: "submitted";
      reviewId: string;
      rating: number;
      originalLanguage: CustomerReviewLanguage;
      originalBody: string | null;
      submittedAt: string;
      moderationState: "hidden" | "unhidden";
    }>
  | Readonly<{ status: "eligible"; reviewExpiresAt: string }>
  | Readonly<{
      status: "access-required" | "invalid" | "ineligible" | "unavailable";
    }>;

export type CustomerReviewHide = Readonly<{
  administratorUserId: string;
  reason: string;
  hiddenAt: string;
}>;

export type AdministratorCustomerReview = Readonly<{
  reviewId: string;
  bookingRequestReference: string;
  profileId: string;
  authorUserId: string;
  rating: number;
  originalLanguage: CustomerReviewLanguage;
  originalBody: string | null;
  submittedAt: string;
  moderationState: "hidden" | "unhidden";
  hide: CustomerReviewHide | null;
}>;

export type AdministratorCustomerReviewListResult =
  | Readonly<{
      status: "success";
      items: readonly AdministratorCustomerReview[];
      nextCursor: CustomerReviewCursor | null;
    }>
  | Readonly<{ status: "access-required" | "invalid" | "unavailable" }>;

export type HideCustomerReviewInput = Readonly<{
  reviewId: string;
  reason: string;
}>;

export function isHideCustomerReviewInput(
  value: unknown,
): value is HideCustomerReviewInput {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["reviewId", "reason"]) &&
    isCustomerReviewUuid(value.reviewId) &&
    typeof value.reason === "string" &&
    value.reason.trim().length >= 1 &&
    value.reason.trim().length <= 2000
  );
}

export type HideCustomerReviewActionInput = HideCustomerReviewInput &
  Readonly<{
    locale: CustomerReviewLocale;
  }>;

export function parseHideCustomerReviewActionInput(
  value: unknown,
): HideCustomerReviewActionInput | undefined {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["locale", "reviewId", "reason"]) ||
    !isCustomerReviewLanguage(value.locale) ||
    !isCustomerReviewUuid(value.reviewId) ||
    typeof value.reason !== "string" ||
    value.reason.trim().length < 1 ||
    value.reason.trim().length > 2000
  ) {
    return undefined;
  }
  return value as HideCustomerReviewActionInput;
}

export type HideCustomerReviewResult =
  | (CustomerReviewHide &
      Readonly<{
        status: "hidden";
        reviewId: string;
        affectedPublicSlug: string;
        affectedBookingRequestReference: string;
      }>)
  | (CustomerReviewHide &
      Readonly<{
        status: "already-hidden";
        reviewId: string;
      }>)
  | Readonly<{ status: "access-required" | "invalid" | "unavailable" }>;

export type HideCustomerReviewActionResult =
  | (CustomerReviewHide &
      Readonly<{
        status: "hidden" | "already-hidden";
        reviewId: string;
      }>)
  | Readonly<{ status: "access-required" | "invalid" }>
  |
  Readonly<{
    status: "unavailable";
    recovery: "reload-administrator-reviews";
  }>;
