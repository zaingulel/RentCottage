"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";

import { administratorAccessHref } from "@/access/return-destination";
import {
  hideCustomerReview,
  hideCustomerReviewReply,
} from "@/customer-review/actions";
import type {
  AdministratorCustomerReview,
  AdministratorCustomerReviewListResult,
  CustomerReviewHide,
} from "@/customer-review/customer-review";
import { administratorQueuesMessages } from "@/i18n/administrator-queues-messages";
import { administratorRecordsMessages } from "@/i18n/administrator-records-messages";
import { customerReviewMessages } from "@/i18n/customer-review-messages";
import { formatIraqDateTime } from "@/i18n/format";
import type { Locale } from "@/i18n/routing";

import recordStyles from "./administrator-records.module.css";
import styles from "./customer-reviews.module.css";
import {
  ActionButton,
  ActionFeedback,
  ActionLink,
  FormControl,
} from "./interaction-controls";

const hideTargets = {
  review: {
    action: hideCustomerReview,
    reasonId: "hide-reason-",
    helpId: "hide-help-",
    reasonLabel: "hideReason",
    submitLabel: "hide",
    reasonRequired: "hideReasonRequired",
    success: "hiddenSuccess",
  },
  reply: {
    action: hideCustomerReviewReply,
    reasonId: "hide-reply-reason-",
    helpId: "hide-reply-help-",
    reasonLabel: "hideReplyReason",
    submitLabel: "hideReply",
    reasonRequired: "hideReplyReasonRequired",
    success: "replyHiddenSuccess",
  },
} as const;

function HideWithReason({
  locale,
  target,
  reviewId,
  initialHide,
}: {
  locale: Locale;
  target: "review" | "reply";
  reviewId: string;
  initialHide: CustomerReviewHide | null;
}) {
  const copy = customerReviewMessages[locale];
  const keys = hideTargets[target];
  const reasonId = `${keys.reasonId}${reviewId}`;
  const helpId = `${keys.helpId}${reviewId}`;
  const [hide, setHide] = useState<CustomerReviewHide | null>(initialHide);
  const [notice, setNotice] = useState<{
    kind: "error" | "success";
    text: string;
  }>();
  const [pending, startTransition] = useTransition();
  const noticeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (notice?.kind === "error") noticeRef.current?.focus();
  }, [notice]);

  function submit(formData: FormData) {
    const value = formData.get("reason");
    const reason = typeof value === "string" ? value.trim() : "";
    if (!reason) {
      setNotice({ kind: "error", text: copy[keys.reasonRequired] });
      return;
    }
    setNotice(undefined);
    startTransition(async () => {
      let result;
      try {
        result = await keys.action({ reviewId, reason });
      } catch {
        setNotice({ kind: "error", text: copy.unavailable });
        return;
      }
      if (result.status === "hidden" || result.status === "already-hidden") {
        setHide({
          administratorUserId: result.administratorUserId,
          reason: result.reason,
          hiddenAt: result.hiddenAt,
        });
        setNotice({ kind: "success", text: copy[keys.success] });
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
    <>
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
          <label htmlFor={reasonId}>{copy[keys.reasonLabel]}</label>
          <FormControl
            kind="textarea"
            id={reasonId}
            name="reason"
            maxLength={2000}
            aria-describedby={helpId}
            disabled={pending}
          />
          <small id={helpId}>{copy.hideHelp}</small>
          <ActionButton
            kind="secondary"
            size="regular"
            type="submit"
            pending={pending}
          >
            {pending ? copy.hiding : copy[keys.submitLabel]}
          </ActionButton>
        </form>
      )}
      {notice ? (
        <div
          ref={noticeRef}
          tabIndex={notice.kind === "error" ? -1 : undefined}
        >
          <ActionFeedback kind={notice.kind}>{notice.text}</ActionFeedback>
        </div>
      ) : null}
    </>
  );
}

function ModerationCard({
  locale,
  review,
}: {
  locale: Locale;
  review: AdministratorCustomerReview;
}) {
  const copy = customerReviewMessages[locale];
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
      <p>
        {copy.rating}: {review.rating} / 5 {copy.ratingValue}
      </p>
      <p lang={review.originalLanguage} dir="auto">
        {review.originalBody ?? copy.ratingOnly}
      </p>
      <time dateTime={review.submittedAt}>
        {copy.submittedAt}: {formatIraqDateTime(review.submittedAt, locale)}
      </time>
      <HideWithReason
        locale={locale}
        target="review"
        reviewId={review.reviewId}
        initialHide={review.hide}
      />
      {review.reply ? (
        <section className={styles.reply} aria-label={copy.ownerReply}>
          <span>
            {copy.replyAuthor}: <bdi>{review.reply.authorUserId}</bdi>
          </span>
          <p lang={review.reply.originalLanguage} dir="auto">
            {review.reply.originalBody}
          </p>
          <time dateTime={review.reply.submittedAt}>
            {copy.submittedAt}:{" "}
            {formatIraqDateTime(review.reply.submittedAt, locale)}
          </time>
          <HideWithReason
            locale={locale}
            target="reply"
            reviewId={review.reviewId}
            initialHide={review.reply.hide}
          />
        </section>
      ) : null}
    </article>
  );
}

type ReviewFilters = { state: string; from: string; through: string };

function nextSearch(
  filters: ReviewFilters,
  cursor: { submittedAt: string; reviewId: string },
) {
  const search = new URLSearchParams();
  if (filters.state) search.set("state", filters.state);
  if (filters.from) search.set("from", filters.from);
  if (filters.through) search.set("through", filters.through);
  search.set("beforeAt", cursor.submittedAt);
  search.set("beforeId", cursor.reviewId);
  return search;
}

function ReviewFilterForm({
  locale,
  filters,
  stateCounts,
}: {
  locale: Locale;
  filters: ReviewFilters;
  stateCounts?: Readonly<{ unhidden: number; hidden: number }>;
}) {
  const copy = customerReviewMessages[locale];
  const records = administratorRecordsMessages[locale];
  const number = new Intl.NumberFormat(locale);
  const base = `/${locale}/administrator/reviews`;
  const count = (state: "unhidden" | "hidden") =>
    stateCounts ? ` (${number.format(stateCounts[state])})` : "";
  return (
    <form action={base} method="get" className={recordStyles.filters}>
      <label>
        <span>{records.status}</span>
        <FormControl kind="select" name="state" defaultValue={filters.state}>
          <option value="">{records.allStatuses}</option>
          <option value="unhidden">
            {copy.visible}
            {count("unhidden")}
          </option>
          <option value="hidden">
            {copy.hiddenState}
            {count("hidden")}
          </option>
        </FormControl>
      </label>
      <label>
        <span>{records.from}</span>
        <FormControl
          kind="input"
          type="date"
          name="from"
          defaultValue={filters.from}
        />
      </label>
      <label>
        <span>{records.through}</span>
        <FormControl
          kind="input"
          type="date"
          name="through"
          defaultValue={filters.through}
        />
      </label>
      <div className={recordStyles.actions}>
        <ActionButton kind="primary" width="content" type="submit">
          {administratorQueuesMessages[locale].apply}
        </ActionButton>
        <ActionLink kind="secondary" width="content" href={base}>
          {records.reset}
        </ActionLink>
      </div>
    </form>
  );
}

export function CustomerReviewModeration({
  locale,
  filters,
  result,
}: {
  locale: Locale;
  filters: ReviewFilters;
  result: AdministratorCustomerReviewListResult;
}) {
  const copy = customerReviewMessages[locale];
  if (result.status === "invalid")
    return (
      <main className={styles.page}>
        <h1>{copy.administratorTitle}</h1>
        <ReviewFilterForm locale={locale} filters={filters} />
        <ActionFeedback kind="error">
          {administratorQueuesMessages[locale].invalid}
        </ActionFeedback>
      </main>
    );
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
          <Link
            href={administratorAccessHref(
              locale,
              `/${locale}/administrator/reviews`,
            )}
          >
            {copy.administratorAccessAction}
          </Link>
        ) : null}
      </main>
    );
  return (
    <main className={styles.page}>
      <h1>{copy.administratorTitle}</h1>
      <ReviewFilterForm
        locale={locale}
        filters={filters}
        stateCounts={result.stateCounts}
      />
      <p className={recordStyles.total}>
        {copy.matchingTotal}:{" "}
        <strong>{new Intl.NumberFormat(locale).format(result.total)}</strong>
      </p>
      {result.items.length === 0 ? (
        <p>
          {filters.state || filters.from || filters.through
            ? copy.emptyFiltered
            : copy.empty}
        </p>
      ) : null}
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
          href={`/${locale}/administrator/reviews?${nextSearch(
            filters,
            result.nextCursor,
          )}`}
        >
          {copy.next}
        </Link>
      ) : null}
    </main>
  );
}
