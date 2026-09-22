import { notFound, redirect, unstable_rethrow } from "next/navigation";

import { resolveRequestAccount } from "@/access/request-account-context";
import { administratorAccessHref } from "@/access/return-destination";
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

  const account = await resolveRequestAccount();
  if (account.status === "signed_out")
    redirect(
      administratorAccessHref(locale, `/${locale}/administrator/reviews`),
    );

  let result: AdministratorCustomerReviewListResult = { status: "unavailable" };
  if (account.status === "authenticated") {
    if (account.context?.role !== "platform_administrator") {
      result = { status: "access-required" };
    } else {
      try {
        const reviews = await createRequestCustomerReview();
        if (reviews) {
          result = await reviews.listAdministrator({
            beforeAt: completeCursor ? (query.beforeAt as string) : null,
            beforeId: completeCursor ? (query.beforeId as string) : null,
            limit: 20,
          });
        }
      } catch (error) {
        unstable_rethrow(error);
        console.error("customer-review-administrator-list-unavailable");
      }
    }
  }
  if (result.status === "invalid") result = { status: "unavailable" };
  return <CustomerReviewModeration locale={locale} result={result} />;
}
