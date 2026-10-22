import { notFound, unstable_rethrow } from "next/navigation";

import { hasCustomerCapability } from "@/access/account-access";
import { resolveRequestAccount } from "@/access/request-account-context";
import { PublicCustomerReviews } from "@/components/public-customer-reviews";
import {
  isCustomerReviewPublicSlug,
  isCustomerReviewTimestamp,
  isCustomerReviewUuid,
  type PublicCustomerReviewListResult,
} from "@/customer-review/customer-review";
import { createRequestCustomerReview } from "@/customer-review/request-customer-review";
import type { Debug833Category } from "@/customer-review/supabase-customer-review";
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

  const requestId =
    process.env.APP_ENVIRONMENT === "test" &&
    slug === "cottage-20000000000040008000000000007701"
      ? crypto.randomUUID()
      : undefined;
  const report = requestId
    ? (
        stage: "setup" | "list" | "result",
        category:
          | Debug833Category
          | "reader-missing"
          | "setup-exception"
          | "list-exception"
          | "invalid"
          | "unavailable",
        code?: string,
      ) => {
        console.error("[DEBUG-833]", {
          requestId,
          locale,
          fixture: "desktop-owner-reply",
          stage,
          category,
          ...(code === undefined
            ? {}
            : {
                code:
                  /^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/.exec(code)?.[0] === code
                    ? code
                    : "unclassified",
              }),
        });
      }
    : undefined;
  let phase: "setup" | "list" = "setup";
  let result: PublicCustomerReviewListResult = { status: "unavailable" };
  try {
    const reviews = await createRequestCustomerReview();
    if (reviews) {
      phase = "list";
      const input = {
        publicSlug: slug,
        beforeAt: completeCursor ? (query.beforeAt as string) : null,
        beforeId: completeCursor ? (query.beforeId as string) : null,
        limit: 20,
      };
      result = report
        ? await reviews.listPublic(input, (category, code) =>
            report("list", category, code),
          )
        : await reviews.listPublic(input);
    } else {
      report?.("setup", "reader-missing");
    }
  } catch (error) {
    unstable_rethrow(error);
    report?.(phase, phase === "setup" ? "setup-exception" : "list-exception");
    console.error("customer-review-public-list-unavailable");
  }
  report?.("result", result.status);
  if (result.status === "not-found") notFound();
  if (result.status === "invalid") result = { status: "unavailable" };
  // Chooses which controls to draw; the database decides who may translate or report.
  const account = await resolveRequestAccount();
  const translationAccess =
    account.status === "signed_out"
      ? "sign-in"
      : account.status === "authenticated" &&
          hasCustomerCapability(account.context)
        ? "allowed"
        : "none";
  return (
    <PublicCustomerReviews
      locale={locale}
      publicSlug={slug}
      result={result}
      translationAccess={translationAccess}
    />
  );
}
