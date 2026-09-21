import { notFound, unstable_rethrow } from "next/navigation";

import { requireRequestAccount } from "@/access/request-account-context";
import { CustomerReviewModeration } from "@/components/customer-review-moderation";
import {
  isCustomerReviewTimestamp,
  isCustomerReviewUuid,
  type AdministratorCustomerReviewListResult,
} from "@/customer-review/customer-review";
import { createRequestCustomerReview } from "@/customer-review/request-customer-review";
import { isLocale } from "@/i18n/routing";

export default async function AdministratorCustomerReviewsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  if (!isLocale(locale)) notFound();
  const keys = Object.keys(query);
  const emptyCursor = keys.length === 0;
  const completeCursor =
    keys.length === 2 &&
    keys.includes("beforeAt") &&
    keys.includes("beforeId") &&
    isCustomerReviewTimestamp(query.beforeAt) &&
    isCustomerReviewUuid(query.beforeId);
  if (!emptyCursor && !completeCursor) notFound();

  let result: AdministratorCustomerReviewListResult = { status: "unavailable" };
  try {
    const account = await requireRequestAccount(
      locale,
      `/${locale}/administrator/access`,
    );
    if (account.status !== "unavailable") {
      if (account.context?.role !== "platform_administrator") {
        result = { status: "access-required" };
      } else {
        const reviews = await createRequestCustomerReview();
        if (reviews) {
          result = await reviews.listAdministrator({
            beforeAt: completeCursor ? (query.beforeAt as string) : null,
            beforeId: completeCursor ? (query.beforeId as string) : null,
            limit: 1,
          });
        }
      }
    }
  } catch (error) {
    unstable_rethrow(error);
    console.error("customer-review-administrator-list-unavailable");
  }
  if (result.status === "invalid") result = { status: "unavailable" };
  return <CustomerReviewModeration locale={locale} result={result} />;
}
