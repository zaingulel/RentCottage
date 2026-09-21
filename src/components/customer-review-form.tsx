"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { submitCustomerReview } from "@/customer-review/actions";
import type { OwnCustomerReviewResult } from "@/customer-review/customer-review";
import { customerReviewMessages } from "@/i18n/customer-review-messages";
import { formatIraqDateTime } from "@/i18n/format";
import type { Locale } from "@/i18n/routing";

import styles from "./customer-reviews.module.css";

type FormNotice = { kind: "error" | "success"; text: string } | undefined;

export function CustomerReviewForm({
  locale,
  bookingRequestReference,
  initialResult,
}: {
  locale: Locale;
  bookingRequestReference: string;
  initialResult: OwnCustomerReviewResult;
}) {
  const copy = customerReviewMessages[locale];
  const [notice, setNotice] = useState<FormNotice>();
  const [pending, startTransition] = useTransition();
  const noticeRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (notice?.kind === "error") noticeRef.current?.focus();
  }, [notice]);

  if (initialResult.status === "submitted")
    return (
      <section className={styles.section} aria-labelledby="customer-review-heading">
        <h2 id="customer-review-heading">{copy.submitted}</h2>
        <p role="status">{copy.published}</p>
        <p>
          {initialResult.moderationState === "hidden"
            ? copy.hidden
            : copy.visible}
        </p>
        <p aria-label={copy.rating}>
          {initialResult.rating} / 5 {copy.ratingValue}
        </p>
        <p lang={initialResult.originalLanguage} dir="auto">
          {initialResult.originalBody ?? copy.ratingOnly}
        </p>
        <p>
          {copy.submittedAt}: {formatIraqDateTime(initialResult.submittedAt, locale)}
        </p>
        <small>{copy.translationUnavailable}</small>
        <small>{copy.repliesUnavailable}</small>
      </section>
    );

  if (initialResult.status !== "eligible")
    return (
      <section className={styles.section} aria-labelledby="customer-review-heading">
        <h2 id="customer-review-heading">{copy.title}</h2>
        <p role={initialResult.status === "unavailable" ? "alert" : undefined}>
          {initialResult.status === "unavailable"
            ? copy.unavailable
            : initialResult.status === "access-required"
              ? copy.accessRequired
              : copy.ineligible}
        </p>
      </section>
    );

  function submit(formData: FormData) {
    const ratingValue = formData.get("rating");
    const rating = typeof ratingValue === "string" ? Number(ratingValue) : 0;
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      setNotice({ kind: "error", text: copy.ratingRequired });
      return;
    }
    const bodyValue = formData.get("originalBody");
    const language = formData.get("originalLanguage");
    if (
      typeof bodyValue !== "string" ||
      bodyValue.length > 2000 ||
      (language !== "en" && language !== "ar" && language !== "ckb")
    ) {
      setNotice({ kind: "error", text: copy.invalid });
      return;
    }
    setNotice(undefined);
    startTransition(async () => {
      const result = await submitCustomerReview({
        locale,
        bookingRequestReference,
        rating,
        originalLanguage: language,
        originalBody: bodyValue.trim().length === 0 ? null : bodyValue,
      });
      const text =
        result.status === "submitted"
          ? copy.published
          : result.status === "duplicate"
            ? copy.duplicate
            : result.status === "prohibited-content"
              ? copy.prohibited
              : result.status === "access-required"
                ? copy.accessRequired
                : result.status === "ineligible"
                  ? copy.ineligible
                  : result.status === "invalid"
                    ? copy.invalid
                    : copy.unavailable;
      setNotice({
        kind: result.status === "submitted" ? "success" : "error",
        text,
      });
    });
  }

  return (
    <section className={styles.section} aria-labelledby="customer-review-heading">
      <h2 id="customer-review-heading">{copy.title}</h2>
      <p>
        {copy.eligibleUntil}{" "}
        <time dateTime={initialResult.reviewExpiresAt}>
          {formatIraqDateTime(initialResult.reviewExpiresAt, locale)}
        </time>
      </p>
      <form action={submit} className={styles.form}>
        <fieldset disabled={pending}>
          <legend>{copy.rating}</legend>
          <div className={styles.rating}>
            {[1, 2, 3, 4, 5].map((rating) => (
              <label key={rating}>
                <input type="radio" name="rating" value={rating} />
                <span>{rating} {copy.ratingValue}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <label htmlFor="customer-review-body">{copy.body}</label>
        <textarea
          id="customer-review-body"
          name="originalBody"
          maxLength={2000}
          aria-describedby="customer-review-body-help"
          disabled={pending}
        />
        <small id="customer-review-body-help">{copy.bodyHelp}</small>
        <label htmlFor="customer-review-language">{copy.language}</label>
        <select
          id="customer-review-language"
          name="originalLanguage"
          defaultValue={locale}
          disabled={pending}
        >
          <option value="en">English</option>
          <option value="ar">العربية</option>
          <option value="ckb">کوردی</option>
        </select>
        <button type="submit" disabled={pending}>
          {pending ? copy.submitting : copy.submit}
        </button>
        {notice ? (
          <p
            ref={noticeRef}
            role={notice.kind === "error" ? "alert" : "status"}
            tabIndex={notice.kind === "error" ? -1 : undefined}
          >
            {notice.text}
          </p>
        ) : null}
      </form>
    </section>
  );
}
