import Link from "next/link";

import { accountAccessHref } from "@/access/return-destination";
import type {
  CustomerReviewLanguage,
  CustomerReviewTranslation as StoredReviewTranslation,
  PublicCustomerReviewListResult,
} from "@/customer-review/customer-review";
import type { ReviewTranslationSubject } from "@/customer-review/review-translation";
import { customerReviewMessages } from "@/i18n/customer-review-messages";
import { formatIraqDateTime } from "@/i18n/format";
import type { Locale } from "@/i18n/routing";

import { CustomerReviewTranslation } from "./customer-review-translation";
import { ActionLink } from "./interaction-controls";
import styles from "./customer-reviews.module.css";

export function PublicCustomerReviews({
  locale,
  publicSlug,
  result,
  translationAccess,
}: {
  locale: Locale;
  publicSlug: string;
  result: PublicCustomerReviewListResult;
  translationAccess: "allowed" | "sign-in" | "none";
}) {
  const copy = customerReviewMessages[locale];
  const showSignIn =
    translationAccess === "sign-in" &&
    result.status === "success" &&
    result.items.some(
      (review) =>
        (review.originalBody !== null && review.originalLanguage !== locale) ||
        (review.ownerReply !== null &&
          review.ownerReply.originalLanguage !== locale),
    );

  function text({
    reviewId,
    subject,
    originalLanguage,
    originalBody,
    translations,
  }: {
    reviewId: string;
    subject: ReviewTranslationSubject;
    originalLanguage: CustomerReviewLanguage;
    originalBody: string;
    translations: readonly StoredReviewTranslation[];
  }) {
    if (originalLanguage === locale)
      return (
        <p lang={originalLanguage} dir="auto">
          {originalBody}
        </p>
      );
    return (
      <CustomerReviewTranslation
        locale={locale}
        publicSlug={publicSlug}
        reviewId={reviewId}
        subject={subject}
        originalLanguage={originalLanguage}
        originalBody={originalBody}
        translation={translations.find(
          (translation) => translation.targetLanguage === locale,
        )}
        canAct={translationAccess === "allowed"}
      />
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href={`/${locale}/cottages/${publicSlug}`}>
          {copy.backToCottage}
        </Link>
        <h1>{copy.publicTitle}</h1>
        {showSignIn ? (
          <ActionLink
            kind="secondary"
            width="content"
            href={accountAccessHref(
              locale,
              `/${locale}/cottages/${publicSlug}`,
            )}
          >
            {copy.translationSignIn}
          </ActionLink>
        ) : null}
      </header>
      {result.status !== "success" ? (
        <p role="alert">{copy.unavailable}</p>
      ) : result.items.length === 0 ? (
        <p>{copy.empty}</p>
      ) : (
        <div className={styles.list}>
          {result.items.map((review) => (
            <article className={styles.card} key={review.reviewId}>
              <header className={styles.cardHeader}>
                <strong>{copy.customer}</strong>
                <span>
                  {copy.rating}: {review.rating} / 5 {copy.ratingValue}
                </span>
              </header>
              {review.originalBody === null ? (
                <p lang={review.originalLanguage} dir="auto">
                  {copy.ratingOnly}
                </p>
              ) : (
                text({
                  reviewId: review.reviewId,
                  subject: "review",
                  originalLanguage: review.originalLanguage,
                  originalBody: review.originalBody,
                  translations: review.translations,
                })
              )}
              <time dateTime={review.submittedAt}>
                {formatIraqDateTime(review.submittedAt, locale)}
              </time>
              {review.ownerReply ? (
                <div
                  className={styles.reply}
                  role="group"
                  aria-labelledby={`customer-review-reply-${review.reviewId}`}
                >
                  <strong id={`customer-review-reply-${review.reviewId}`}>
                    {copy.ownerReply}
                  </strong>
                  {text({
                    reviewId: review.reviewId,
                    subject: "reply",
                    originalLanguage: review.ownerReply.originalLanguage,
                    originalBody: review.ownerReply.originalBody,
                    translations: review.ownerReply.translations,
                  })}
                  <time dateTime={review.ownerReply.submittedAt}>
                    {formatIraqDateTime(review.ownerReply.submittedAt, locale)}
                  </time>
                </div>
              ) : null}
            </article>
          ))}
          {result.nextCursor ? (
            <Link
              className={styles.next}
              href={`/${locale}/cottages/${publicSlug}/reviews?${new URLSearchParams(
                {
                  beforeAt: result.nextCursor.submittedAt,
                  beforeId: result.nextCursor.reviewId,
                },
              )}`}
            >
              {copy.next}
            </Link>
          ) : null}
        </div>
      )}
    </main>
  );
}
