import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";
import { hasApprovedOwnerCapability } from "@/access/account-access";
import { requireRequestAccount } from "@/access/request-account-context";
import { AccountAccessRecovery } from "@/components/account-access-recovery";
import { BackofficeNavigation } from "@/components/backoffice-navigation";
import { CustomerReviewOwnerReply } from "@/components/customer-review-owner-reply";
import { ActionFeedback, ActionLink } from "@/components/interaction-controls";
import { customerReviewMessages } from "@/i18n/customer-review-messages";
import {
  isCustomerReviewPageInput,
  type OwnerCustomerReviewListResult,
} from "@/customer-review/customer-review";
import { createRequestCustomerReview } from "@/customer-review/request-customer-review";
import { accessMessages } from "@/i18n/access-messages";
import { isLocale } from "@/i18n/routing";

export default async function OwnerReviewsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  if (!isLocale(locale)) notFound();
  const input = {
    beforeAt: query.beforeAt ?? null,
    beforeId: query.beforeId ?? null,
    limit: 20,
  };
  if (
    Object.entries(query).some(
      ([key, value]) =>
        !["beforeAt", "beforeId"].includes(key) || typeof value !== "string",
    ) ||
    !isCustomerReviewPageInput(input)
  )
    notFound();
  const returnTo = `/${locale}/owner/reviews`;
  const account = await requireRequestAccount(locale, returnTo);
  if (account.status === "unavailable")
    return (
      <AccountAccessRecovery
        locale={locale}
        status="unavailable"
        returnTo={returnTo}
      />
    );
  if (!hasApprovedOwnerCapability(account.context))
    return (
      <AccountAccessRecovery
        locale={locale}
        status="denied"
        returnTo={returnTo}
      />
    );
  let result: OwnerCustomerReviewListResult = { status: "unavailable" };
  try {
    const reviews = await createRequestCustomerReview();
    if (reviews) result = await reviews.listOwner(input);
  } catch (error) {
    unstable_rethrow(error);
    console.error("customer-review-owner-list-unavailable");
  }
  if (result.status === "access-required")
    return (
      <AccountAccessRecovery
        locale={locale}
        status="denied"
        returnTo={returnTo}
      />
    );
  const copy = customerReviewMessages[locale];
  const continued = input.beforeAt !== null;
  const next = result.status === "success" ? result.nextCursor : null;
  const nextQuery = next
    ? new URLSearchParams({
        beforeAt: next.submittedAt,
        beforeId: next.reviewId,
      }).toString()
    : null;
  return (
    <main className="results-page page page-record">
      <BackofficeNavigation locale={locale} area="owner" current="reviews" />
      <header className="page-heading">
        <h1 className="page-title">{accessMessages[locale].ownerReviewsTab}</h1>
      </header>
      {result.status !== "success" ? (
        <div className="empty-state">
          <ActionFeedback kind="error">{copy.unavailable}</ActionFeedback>
          <ActionLink kind="secondary" href={returnTo}>
            {accessMessages[locale].retry}
          </ActionLink>
        </div>
      ) : result.items.length === 0 ? (
        <div className="empty-state">
          <p>{continued ? copy.ownerExhausted : copy.ownerEmpty}</p>
        </div>
      ) : (
        <ul className="list-rows">
          {result.items.map((item) => (
            <li key={item.reviewId}>
              <Link
                className="list-row-title"
                href={`/${locale}/owner/booking-requests/${item.bookingRequestReference}`}
              >
                {item.cottageName}
              </Link>
              <p className="list-row-meta">
                <span className="status-badge">
                  {item.review.reply ? copy.ownerReplied : copy.ownerNoReply}
                </span>
              </p>
              <CustomerReviewOwnerReply
                locale={locale}
                bookingRequestReference={item.bookingRequestReference}
                initialResult={item.review}
                cottageName={item.cottageName}
                idPrefix={`owner-review-${item.reviewId}`}
              />
            </li>
          ))}
        </ul>
      )}
      {result.status === "success" && (continued || nextQuery) ? (
        <nav
          className="results-paging"
          aria-label={accessMessages[locale].ownerReviewsTab}
        >
          {continued ? (
            <ActionLink kind="secondary" href={returnTo}>
              {copy.ownerNewest}
            </ActionLink>
          ) : null}
          {nextQuery ? (
            <ActionLink kind="secondary" href={`${returnTo}?${nextQuery}`}>
              {copy.next}
            </ActionLink>
          ) : null}
        </nav>
      ) : null}
    </main>
  );
}
