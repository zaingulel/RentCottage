import { notFound, unstable_rethrow } from "next/navigation";

import { PublicCustomerReviews } from "@/components/public-customer-reviews";
import {
  isCustomerReviewPublicSlug,
  isCustomerReviewTimestamp,
  isCustomerReviewUuid,
  type PublicCustomerReviewListResult,
} from "@/customer-review/customer-review";
import { createRequestCustomerReview } from "@/customer-review/request-customer-review";
import { isLocale } from "@/i18n/routing";

export default async function PublicCustomerReviewsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, slug } = await params;
  const query = await searchParams;
  if (!isLocale(locale) || !isCustomerReviewPublicSlug(slug)) notFound();
  const keys = Object.keys(query);
  const emptyCursor = keys.length === 0;
  const completeCursor =
    keys.length === 2 &&
    keys.includes("beforeAt") &&
    keys.includes("beforeId") &&
    isCustomerReviewTimestamp(query.beforeAt) &&
    isCustomerReviewUuid(query.beforeId);
  if (!emptyCursor && !completeCursor) notFound();

  let result: PublicCustomerReviewListResult = { status: "unavailable" };
  try {
    const reviews = await createRequestCustomerReview();
    if (reviews) {
      result = await reviews.listPublic({
        publicSlug: slug,
        beforeAt: completeCursor ? (query.beforeAt as string) : null,
        beforeId: completeCursor ? (query.beforeId as string) : null,
        limit: 1,
      });
    }
  } catch (error) {
    unstable_rethrow(error);
    console.error("customer-review-public-list-unavailable");
  }
  if (result.status === "not-found") notFound();
  if (result.status === "invalid") result = { status: "unavailable" };
  return (
    <PublicCustomerReviews locale={locale} publicSlug={slug} result={result} />
  );
}
