"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";

import {
  ActionButton,
  ActionFeedback,
  ActionLink,
} from "@/components/interaction-controls";
import { ownerApplicationReviewMessages } from "@/i18n/owner-application-review-messages";
import type { Locale } from "@/i18n/routing";
import {
  createOwnerDocumentAccessAction,
  type OwnerDocumentAccessState,
} from "@/owner-application/actions";
import { documentAccessDeadlineVerdict } from "@/owner-application/owner-application";
import type { SubmittedOwnerApplicationReview } from "@/owner-application/supabase-owner-application";
import { ownerApplicationMessages } from "@/i18n/owner-application-messages";
import { useExclusiveAction } from "./use-exclusive-action";

const idleDocumentAccessState: OwnerDocumentAccessState = { status: "idle" };

export function ReviewDocument({
  locale,
  document,
}: {
  locale: Locale;
  document: SubmittedOwnerApplicationReview["documents"][number];
}) {
  const copy = ownerApplicationReviewMessages[locale];
  const documentCopy = ownerApplicationMessages[locale].documentKinds;
  const expiryTimer = useRef<number | undefined>(undefined);
  const [state, setState] = useState<OwnerDocumentAccessState>(
    idleDocumentAccessState,
  );
  const { pending, run } = useExclusiveAction();

  useEffect(
    () => () => {
      if (expiryTimer.current !== undefined) {
        window.clearTimeout(expiryTimer.current);
      }
    },
    [],
  );

  function createDocumentAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    void run(async () => {
      const attemptStartedAt = Date.now();
      if (expiryTimer.current !== undefined) {
        window.clearTimeout(expiryTimer.current);
        expiryTimer.current = undefined;
      }
      try {
        const next = await createOwnerDocumentAccessAction(
          idleDocumentAccessState,
          formData,
        );
        if (next.status !== "ready") {
          setState(next);
          return;
        }
        const verdict = documentAccessDeadlineVerdict(
          attemptStartedAt,
          next.expiresInSeconds,
          Date.now(),
        );
        if (verdict.status === "expired") {
          setState(verdict);
          return;
        }
        setState(next);
        expiryTimer.current = window.setTimeout(() => {
          setState((current) =>
            current.status === "ready" && current.url === next.url
              ? { status: "expired" }
              : current,
          );
        }, verdict.remainingMilliseconds);
      } catch {
        setState({ status: "unavailable" });
      }
    });
  }

  return (
    <li className="administrator-review-document">
      <div>
        <strong>{documentCopy[document.kind].title}</strong>
        <span className="administrator-review-filename">
          {document.originalFilename}
        </span>
      </div>
      <form onSubmit={createDocumentAccess}>
        <input type="hidden" name="documentId" value={document.id} />
        <ActionButton
          kind="secondary"
          size="compact"
          type="submit"
          pending={pending}
        >
          {copy.createLink}
        </ActionButton>
      </form>
      {pending ? (
        <p role="status" className="administrator-review-pending">
          <span aria-hidden="true">…</span> {copy.pending}
        </p>
      ) : state.status === "ready" ? (
        <ActionFeedback kind="success">
          {copy.linkReady}{" "}
          <ActionLink
            kind="text"
            href={state.url}
            target="_blank"
            rel="noreferrer"
          >
            {copy.openDocument}
          </ActionLink>
        </ActionFeedback>
      ) : state.status === "denied" ||
        state.status === "unavailable" ||
        state.status === "expired" ? (
        <ActionFeedback kind="error">
          {state.status === "denied"
            ? copy.denied
            : state.status === "expired"
              ? copy.expired
              : copy.unavailable}
        </ActionFeedback>
      ) : null}
    </li>
  );
}

export function OwnerApplicationReviewQueue({
  locale,
  applications,
}: {
  locale: Locale;
  applications: SubmittedOwnerApplicationReview[];
}) {
  const copy = ownerApplicationReviewMessages[locale];
  if (applications.length === 0) {
    return <p className="application-notice">{copy.empty}</p>;
  }

  return (
    <div className="administrator-review-list">
      {applications.map((application) => (
        <article
          key={application.applicationId}
          className="administrator-review-card"
        >
          <header>
            <div>
              <span>
                {application.status === "under_review"
                  ? copy.underReview
                  : copy.submitted}
              </span>
              <h2>{application.legalName}</h2>
            </div>
            <time dateTime={application.submittedAt}>
              {new Intl.DateTimeFormat(locale, {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: "Asia/Baghdad",
              }).format(new Date(application.submittedAt))}
            </time>
          </header>
          <p>
            {copy.reviewDue}:{" "}
            <time dateTime={application.reviewDueAt}>
              {new Intl.DateTimeFormat(locale, {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: "Asia/Baghdad",
              }).format(new Date(application.reviewDueAt))}
            </time>
          </p>
          <Link
            className="action action-primary action-content"
            href={`/${locale}/administrator/owner-applications/${application.applicationId}`}
          >
            {copy.openApplication}
          </Link>
          <h3>{copy.documents}</h3>
          <ul>
            {application.documents.map((document) => (
              <ReviewDocument
                key={document.id}
                locale={locale}
                document={document}
              />
            ))}
          </ul>
        </article>
      ))}
    </div>
  );
}
