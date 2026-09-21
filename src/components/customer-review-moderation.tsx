"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";

import { hideCustomerReview } from "@/customer-review/actions";
import type {
  AdministratorCustomerReview,
  AdministratorCustomerReviewListResult,
  CustomerReviewHide,
} from "@/customer-review/customer-review";
import { customerReviewMessages } from "@/i18n/customer-review-messages";
import { formatIraqDateTime } from "@/i18n/format";
import type { Locale } from "@/i18n/routing";

import styles from "./customer-reviews.module.css";

function ModerationCard({
  locale,
  review,
}: {
  locale: Locale;
  review: AdministratorCustomerReview;
}) {
  const copy = customerReviewMessages[locale];
  const [hide, setHide] = useState<CustomerReviewHide | null>(review.hide);
  const [notice, setNotice] = useState<{
    kind: "error" | "success";
    text: string;
  }>();
  const [pending, startTransition] = useTransition();
  const noticeRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (notice?.kind === "error") noticeRef.current?.focus();
  }, [notice]);

  function submit(formData: FormData) {
    const value = formData.get("reason");
    const reason = typeof value === "string" ? value.trim() : "";
    if (!reason) {
      setNotice({ kind: "error", text: copy.hideReasonRequired });
      return;
    }
    setNotice(undefined);
    startTransition(async () => {
      const result = await hideCustomerReview({
        locale,
        reviewId: review.reviewId,
        reason,
      });
      if (result.status === "hidden" || result.status === "already-hidden") {
        setHide({
          administratorUserId: result.administratorUserId,
          reason: result.reason,
          hiddenAt: result.hiddenAt,
        });
        setNotice({ kind: "success", text: copy.hiddenSuccess });
        return;
      }
      setNotice({
        kind: "error",
        text:
          result.status === "access-required"
            ? copy.administratorAccessRequired
            : result.status === "invalid"
              ? copy.invalid
              : copy.unavailable,
      });
    });
  }

  return (
    <article className={styles.card}>
      <div className={styles.identifiers}>
        <span>
          {copy.bookingReference}: <bdi>{review.bookingRequestReference}</bdi>
        </span>
        <span>
          {copy.author}: <bdi>{review.authorUserId}</bdi>
        </span>
      </div>
      <p aria-label={copy.rating}>
        {review.rating} / 5 {copy.ratingValue}
      </p>
      <p lang={review.originalLanguage} dir="auto">
        {review.originalBody ?? copy.ratingOnly}
      </p>
      <time dateTime={review.submittedAt}>
        {copy.submittedAt}: {formatIraqDateTime(review.submittedAt, locale)}
      </time>
      {hide ? (
        <dl className={styles.audit}>
          <div>
            <dt>{copy.reason}</dt>
            <dd>{hide.reason}</dd>
          </div>
          <div>
            <dt>{copy.hiddenAt}</dt>
            <dd>{formatIraqDateTime(hide.hiddenAt, locale)}</dd>
          </div>
          <div>
            <dt>{copy.hiddenBy}</dt>
            <dd>
              <bdi>{hide.administratorUserId}</bdi>
            </dd>
          </div>
        </dl>
      ) : (
        <form action={submit} className={styles.form}>
          <label htmlFor={`hide-reason-${review.reviewId}`}>
            {copy.hideReason}
          </label>
          <textarea
            id={`hide-reason-${review.reviewId}`}
            name="reason"
            maxLength={2000}
            aria-describedby={`hide-help-${review.reviewId}`}
            disabled={pending}
          />
          <small id={`hide-help-${review.reviewId}`}>{copy.hideHelp}</small>
          <button type="submit" disabled={pending}>
            {pending ? copy.hiding : copy.hide}
          </button>
        </form>
      )}
      {notice ? (
        <p
          ref={noticeRef}
          role={notice.kind === "error" ? "alert" : "status"}
          tabIndex={notice.kind === "error" ? -1 : undefined}
        >
          {notice.text}
        </p>
      ) : null}
    </article>
  );
}

export function CustomerReviewModeration({
  locale,
  result,
}: {
  locale: Locale;
  result: AdministratorCustomerReviewListResult;
}) {
  const copy = customerReviewMessages[locale];
  if (result.status !== "success")
    return (
      <main className={styles.page}>
        <h1>{copy.administratorTitle}</h1>
        <p role={result.status === "unavailable" ? "alert" : undefined}>
          {result.status === "access-required"
            ? copy.administratorAccessRequired
            : copy.unavailable}
        </p>
        {result.status === "access-required" ? (
          <Link href={`/${locale}/administrator/access`}>
            {copy.administratorAccessAction}
          </Link>
        ) : null}
      </main>
    );
  return (
    <main className={styles.page}>
      <h1>{copy.administratorTitle}</h1>
      {result.items.length === 0 ? <p>{copy.empty}</p> : null}
      <div className={styles.list}>
        {result.items.map((review) => (
          <ModerationCard
            key={review.reviewId}
            locale={locale}
            review={review}
          />
        ))}
      </div>
      {result.nextCursor ? (
        <Link
          className={styles.next}
          href={`/${locale}/administrator/reviews?${new URLSearchParams({
            beforeAt: result.nextCursor.submittedAt,
            beforeId: result.nextCursor.reviewId,
          })}`}
        >
          {copy.next}
        </Link>
      ) : null}
    </main>
  );
}
