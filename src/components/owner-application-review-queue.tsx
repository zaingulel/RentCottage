"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { ownerApplicationReviewMessages } from "@/i18n/owner-application-review-messages";
import type { Locale } from "@/i18n/routing";
import {
  createOwnerDocumentAccessAction,
  type OwnerDocumentAccessState,
} from "@/owner-application/actions";
import type { SubmittedOwnerApplicationReview } from "@/owner-application/supabase-owner-application";
import { ownerApplicationMessages } from "@/i18n/owner-application-messages";

function AccessButton({ children }: { children: string }) {
  const { pending } = useFormStatus();
  return <button disabled={pending}>{children}</button>;
}

function ReviewDocument({
  locale,
  document,
}: {
  locale: Locale;
  document: SubmittedOwnerApplicationReview["documents"][number];
}) {
  const copy = ownerApplicationReviewMessages[locale];
  const documentCopy = ownerApplicationMessages[locale].documentKinds;
  const [state, action] = useActionState(createOwnerDocumentAccessAction, {
    status: "idle",
  } as OwnerDocumentAccessState);

  return (
    <li className="administrator-review-document">
      <div>
        <strong>{documentCopy[document.kind].title}</strong>
        <span>{document.originalFilename}</span>
      </div>
      <form action={action}>
        <input type="hidden" name="documentId" value={document.id} />
        <AccessButton>{copy.createLink}</AccessButton>
      </form>
      {state.status === "ready" ? (
        <p role="status">
          {copy.linkReady}{" "}
          <a href={state.url} target="_blank" rel="noreferrer">
            {copy.openDocument}
          </a>
        </p>
      ) : state.status === "denied" || state.status === "unavailable" ? (
        <p role="alert">
          {state.status === "denied" ? copy.denied : copy.unavailable}
        </p>
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
              <span>{copy.submitted}</span>
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
