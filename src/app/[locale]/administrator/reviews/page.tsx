import { notFound, redirect, unstable_rethrow } from "next/navigation";

import { resolveRequestAccount } from "@/access/request-account-context";
import { administratorAccessHref } from "@/access/return-destination";
import { CustomerReviewModeration } from "@/components/customer-review-moderation";
import {
  isCustomerReviewTimestamp,
  isCustomerReviewUuid,
  type AdministratorCustomerReviewListInput,
  type AdministratorCustomerReviewListResult,
} from "@/customer-review/customer-review";
import { createRequestCustomerReview } from "@/customer-review/request-customer-review";
import { isLocale } from "@/i18n/routing";

const queryKeys = ["state", "from", "through", "beforeAt", "beforeId"] as const;

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
  const hasCursor = "beforeAt" in query || "beforeId" in query;
  if (
    Object.entries(query).some(
      ([key, value]) =>
        !(queryKeys as readonly string[]).includes(key) ||
        typeof value !== "string",
    ) ||
    (hasCursor &&
      !(
        isCustomerReviewTimestamp(query.beforeAt) &&
        isCustomerReviewUuid(query.beforeId)
      ))
  )
    notFound();
  const text = (key: (typeof queryKeys)[number]) => {
    const value = query[key];
    return typeof value === "string" ? value : "";
  };
  const filters = {
    state: text("state"),
    from: text("from"),
    through: text("through"),
  };

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
            beforeAt: hasCursor ? text("beforeAt") : null,
            beforeId: hasCursor ? text("beforeId") : null,
            limit: 20,
            // The reader refuses a state it does not know with `invalid`.
            state: (filters.state ||
              null) as AdministratorCustomerReviewListInput["state"],
            from: filters.from || null,
            through: filters.through || null,
          });
        }
      } catch (error) {
        unstable_rethrow(error);
        console.error("customer-review-administrator-list-unavailable");
      }
    }
  }
  return (
    <CustomerReviewModeration
      locale={locale}
      filters={filters}
      result={result}
    />
  );
}
