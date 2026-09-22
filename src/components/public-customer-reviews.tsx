import Link from "next/link";

import type { PublicCustomerReviewListResult } from "@/customer-review/customer-review";
import { customerReviewMessages } from "@/i18n/customer-review-messages";
import { formatIraqDateTime } from "@/i18n/format";
import type { Locale } from "@/i18n/routing";

import styles from "./customer-reviews.module.css";

export function PublicCustomerReviews({
  locale,
  publicSlug,
  result,
}: {
  locale: Locale;
  publicSlug: string;
  result: PublicCustomerReviewListResult;
}) {
  const copy = customerReviewMessages[locale];
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href={`/${locale}/cottages/${publicSlug}`}>
          {copy.backToCottage}
        </Link>
        <h1>{copy.publicTitle}</h1>
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
              <p lang={review.originalLanguage} dir="auto">
                {review.originalBody ?? copy.ratingOnly}
              </p>
              <time dateTime={review.submittedAt}>
                {formatIraqDateTime(review.submittedAt, locale)}
              </time>
              <small>{copy.translationUnavailable}</small>
              <small>{copy.repliesUnavailable}</small>
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
