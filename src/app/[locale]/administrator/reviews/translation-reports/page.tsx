import { notFound, redirect, unstable_rethrow } from "next/navigation";

import { resolveRequestAccount } from "@/access/request-account-context";
import { administratorAccessHref } from "@/access/return-destination";
import { CustomerReviewTranslationReports } from "@/components/customer-review-translation-reports";
import {
  isCustomerReviewTimestamp,
  isCustomerReviewUuid,
  type CustomerReviewTranslationReportListResult,
} from "@/customer-review/customer-review";
import { createRequestCustomerReview } from "@/customer-review/request-customer-review";
import { isLocale } from "@/i18n/routing";

const queryKeys = ["beforeAt", "beforeId"] as const;

export default async function AdministratorTranslationReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  if (!isLocale(locale)) notFound();
  const { beforeAt, beforeId } = query;
  const cursor =
    isCustomerReviewTimestamp(beforeAt) && isCustomerReviewUuid(beforeId)
      ? { beforeAt, beforeId }
      : null;
  if (
    Object.entries(query).some(
      ([key, value]) =>
        !(queryKeys as readonly string[]).includes(key) ||
        typeof value !== "string",
    ) ||
    (!cursor && ("beforeAt" in query || "beforeId" in query))
  )
    notFound();

  const account = await resolveRequestAccount();
  if (account.status === "signed_out")
    redirect(
      administratorAccessHref(locale, `/${locale}/administrator/reviews`),
    );

  let result: CustomerReviewTranslationReportListResult = {
    status: "unavailable",
  };
  if (account.status === "authenticated") {
    if (account.context?.role !== "platform_administrator") {
      result = { status: "access-required" };
    } else {
      try {
        const reviews = await createRequestCustomerReview();
        if (reviews) {
          result = await reviews.listTranslationReports({
            beforeAt: cursor?.beforeAt ?? null,
            beforeId: cursor?.beforeId ?? null,
            limit: 20,
          });
        }
      } catch (error) {
        unstable_rethrow(error);
        console.error("customer-review-translation-reports-unavailable");
      }
    }
  }
  return (
    <CustomerReviewTranslationReports
      locale={locale}
      result={result}
      continued={cursor !== null}
    />
  );
}
