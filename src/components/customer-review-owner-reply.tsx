"use client";

import { useState } from "react";

import { submitCustomerReviewReply } from "@/customer-review/actions";
import {
  isCustomerReviewBodyWithinLimit,
  isCustomerReviewLanguage,
  type CustomerReviewLanguage,
  type OwnerCustomerReviewResult,
} from "@/customer-review/customer-review";
import { customerReviewMessages } from "@/i18n/customer-review-messages";
import { formatIraqDateTime } from "@/i18n/format";
import type { Locale } from "@/i18n/routing";

import styles from "./customer-reviews.module.css";
import {
  ActionButton,
  ActionFeedback,
  FormControl,
} from "./interaction-controls";
import { useExclusiveAction } from "./use-exclusive-action";

type FormNotice = { kind: "error" | "success"; text: string } | undefined;

export function CustomerReviewOwnerReply({
  locale,
  bookingRequestReference,
  initialResult,
}: {
  locale: Locale;
  bookingRequestReference: string;
  initialResult: OwnerCustomerReviewResult;
}) {
  const copy = customerReviewMessages[locale];
  const [body, setBody] = useState("");
  const [language, setLanguage] = useState<CustomerReviewLanguage>(locale);
  const [notice, setNotice] = useState<FormNotice>();
  const { pending, run } = useExclusiveAction();

  if (initialResult.status === "no-review") return null;

  async function submit() {
    if (body.trim().length === 0) {
      setNotice({ kind: "error", text: copy.replyRequired });
      return;
    }
    if (!isCustomerReviewBodyWithinLimit(body)) {
      setNotice({ kind: "error", text: copy.replyInvalid });
      return;
    }
    setNotice(undefined);
    const result = await run(() =>
      submitCustomerReviewReply({
        bookingRequestReference,
        originalLanguage: language,
        originalBody: body,
      }),
    );
    if (!result) return;
    const text =
      result.status === "replied"
        ? copy.replyPublished
        : result.status === "duplicate"
          ? copy.replyDuplicate
          : result.status === "prohibited-content"
            ? copy.prohibited
            : result.status === "access-required"
              ? copy.ownerAccessRequired
              : result.status === "ineligible"
                ? copy.replyIneligible
                : result.status === "invalid"
                  ? copy.replyInvalid
                  : copy.unavailable;
    setNotice({
      kind: result.status === "replied" ? "success" : "error",
      text,
    });
  }

  const reviewHidden = initialResult.status === "review-hidden";
  const reply =
    initialResult.status === "reviewed" || reviewHidden
      ? initialResult.reply
      : null;

  return (
    <section
      className={styles.section}
      aria-labelledby="customer-review-owner-heading"
    >
      <h2 id="customer-review-owner-heading">{copy.ownerTitle}</h2>
      {initialResult.status === "access-required" ? (
        <p>{copy.ownerAccessRequired}</p>
      ) : null}
      {initialResult.status === "invalid" ||
      initialResult.status === "unavailable" ? (
        <ActionFeedback kind="error">{copy.unavailable}</ActionFeedback>
      ) : null}
      {reviewHidden ? <p>{copy.ownerReviewHidden}</p> : null}
      {initialResult.status === "reviewed" ? (
        <>
          <p>
            {copy.rating}: {initialResult.rating} / 5 {copy.ratingValue}
          </p>
          <p lang={initialResult.originalLanguage} dir="auto">
            {initialResult.originalBody ?? copy.ratingOnly}
          </p>
          <p>
            {copy.submittedAt}:{" "}
            <time dateTime={initialResult.submittedAt}>
              {formatIraqDateTime(initialResult.submittedAt, locale)}
            </time>
          </p>
        </>
      ) : null}
      {reply ? (
        <div className={styles.reply}>
          <h3>{copy.replyTitle}</h3>
          <p role="status">
            {reply.moderationState === "hidden"
              ? copy.hidden
              : reviewHidden
                ? copy.replyNotPublic
                : copy.replyPublished}
          </p>
          <p lang={reply.originalLanguage} dir="auto">
            {reply.originalBody}
          </p>
          <p>
            {copy.submittedAt}:{" "}
            <time dateTime={reply.submittedAt}>
              {formatIraqDateTime(reply.submittedAt, locale)}
            </time>
          </p>
        </div>
      ) : null}
      {initialResult.status === "reviewed" && !reply ? (
        // The fields stay unnamed: a name would put the reply text in the URL
        // on a native (pre-hydration) submission.
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label htmlFor="customer-review-reply-body">{copy.replyBody}</label>
          <FormControl
            kind="textarea"
            id="customer-review-reply-body"
            aria-describedby="customer-review-reply-body-help"
            disabled={pending}
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
          <small id="customer-review-reply-body-help">{copy.replyHelp}</small>
          <label htmlFor="customer-review-reply-language">
            {copy.language}
          </label>
          <FormControl
            kind="select"
            id="customer-review-reply-language"
            disabled={pending}
            value={language}
            onChange={(event) => {
              if (isCustomerReviewLanguage(event.target.value))
                setLanguage(event.target.value);
            }}
          >
            <option value="en">English</option>
            <option value="ar">العربية</option>
            <option value="ckb">کوردی</option>
          </FormControl>
          <ActionButton
            kind="primary"
            width="content"
            type="submit"
            pending={pending}
          >
            {pending ? copy.submitting : copy.replySubmit}
          </ActionButton>
          {notice ? (
            <ActionFeedback kind={notice.kind}>{notice.text}</ActionFeedback>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}
