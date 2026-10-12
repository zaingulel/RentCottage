"use client";

import { useId, useState } from "react";

import {
  reportCustomerReviewTranslation,
  translateCustomerReview,
} from "@/customer-review/actions";
import type {
  CustomerReviewLanguage,
  CustomerReviewTranslation as StoredReviewTranslation,
} from "@/customer-review/customer-review";
import type { ReviewTranslationSubject } from "@/customer-review/review-translation";
import { customerReviewMessages } from "@/i18n/customer-review-messages";
import { directionFor, type Locale } from "@/i18n/routing";

import {
  ActionButton,
  ActionFeedback,
  ActionFocusTarget,
} from "./interaction-controls";
import styles from "./customer-reviews.module.css";
import { useExclusiveAction } from "./use-exclusive-action";

type Feedback = { kind: "success" | "error"; text: string } | undefined;

export function CustomerReviewTranslation({
  locale,
  publicSlug,
  reviewId,
  subject,
  originalLanguage,
  originalBody,
  translation,
  canAct,
}: {
  locale: Locale;
  publicSlug: string;
  reviewId: string;
  subject: ReviewTranslationSubject;
  originalLanguage: CustomerReviewLanguage;
  originalBody: string;
  translation: StoredReviewTranslation | undefined;
  canAct: boolean;
}) {
  const copy = customerReviewMessages[locale];
  const [shown, setShown] =
    useState<
      Pick<StoredReviewTranslation, "translationId" | "translatedBody">
    >();
  const [showOriginal, setShowOriginal] = useState(false);
  const [reported, setReported] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>();
  const { pending, run } = useExclusiveAction();
  const toggleId = useId();

  const current = shown ?? translation;
  const showingTranslation = current !== undefined && !showOriginal;

  async function translate() {
    const result = await run(() =>
      translateCustomerReview({ locale, publicSlug, reviewId, subject }).catch(
        () => ({ status: "unavailable" as const }),
      ),
    );
    if (!result) return;
    if (result.status === "translated") {
      setShown(result);
      setFeedback(undefined);
    } else {
      setFeedback({
        kind: "error",
        text:
          result.status === "access-required"
            ? copy.translationAccessRequired
            : copy.translationUnavailable,
      });
    }
  }

  async function report(translationId: string) {
    const result = await run(() =>
      reportCustomerReviewTranslation({ translationId }).catch(() => ({
        status: "unavailable" as const,
      })),
    );
    if (!result) return;
    if (result.status === "reported") {
      setReported(true);
      setFeedback({ kind: "success", text: copy.translationReported });
    } else {
      setFeedback({
        kind: "error",
        text:
          result.status === "access-required"
            ? copy.translationAccessRequired
            : copy.translationReportFailed,
      });
    }
  }

  // One button in one place switches meaning, so keyboard focus stays on it.
  const primary = current
    ? {
        label: showOriginal ? copy.viewTranslation : copy.viewOriginal,
        onClick: () => setShowOriginal((value) => !value),
      }
    : canAct
      ? { label: copy.translate, onClick: translate }
      : undefined;
  const canReport = canAct && showingTranslation && !reported;

  return (
    <>
      {showingTranslation ? (
        <p className="translation-label">
          {copy.automaticTranslation} · {copy.fictionalTranslation}
        </p>
      ) : null}
      <p
        lang={showingTranslation ? locale : originalLanguage}
        dir={showingTranslation ? directionFor(locale) : "auto"}
      >
        {showingTranslation ? current.translatedBody : originalBody}
      </p>
      {primary ? (
        <div className={styles.translationActions}>
          <ActionButton
            id={toggleId}
            kind="secondary"
            size="compact"
            type="button"
            pending={pending}
            onClick={primary.onClick}
          >
            {primary.label}
          </ActionButton>
          {canReport ? (
            <ActionButton
              kind="secondary"
              size="compact"
              type="button"
              pending={pending}
              focusSuccessorId={toggleId}
              onClick={() => report(current.translationId)}
            >
              {copy.reportTranslation}
            </ActionButton>
          ) : null}
          {!pending ? <ActionFocusTarget targetId={toggleId} /> : null}
        </div>
      ) : null}
      {feedback ? (
        <ActionFeedback kind={feedback.kind}>{feedback.text}</ActionFeedback>
      ) : null}
    </>
  );
}
