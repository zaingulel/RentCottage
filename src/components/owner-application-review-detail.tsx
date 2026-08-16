"use client";

import { useActionState } from "react";

import {
  ActionButton,
  ActionFeedback,
  FormControl,
} from "@/components/interaction-controls";
import { ownerApplicationMessages } from "@/i18n/owner-application-messages";
import { ownerApplicationReviewDetailMessages } from "@/i18n/owner-application-review-detail-messages";
import { ownerApplicationStatusMessages } from "@/i18n/owner-application-status-messages";
import type { Locale } from "@/i18n/routing";
import {
  ownerApplicationResponseFields,
  type OwnerApplicationStatus,
} from "@/owner-application/owner-application-review";
import {
  reviewOwnerApplicationAction,
  type ReviewOwnerApplicationActionState,
} from "@/owner-application/review-actions";
import type { OwnerApplicationReviewDetail } from "@/owner-application/supabase-owner-application-review";
import { verificationDocumentKinds } from "@/owner-application/owner-application";
import { ReviewDocument } from "./owner-application-review-queue";

const idle: ReviewOwnerApplicationActionState = { status: "idle" };

function ReviewActionFields({
  detail,
  locale,
  action,
}: {
  detail: OwnerApplicationReviewDetail;
  locale: Locale;
  action: string;
}) {
  return (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="action" value={action} />
      <input type="hidden" name="applicationId" value={detail.applicationId} />
      <input type="hidden" name="expectedVersion" value={detail.version} />
    </>
  );
}

function StatusLabel({
  locale,
  status,
}: {
  locale: Locale;
  status: OwnerApplicationStatus;
}) {
  return (
    <span className={`application-status application-status-${status}`}>
      {ownerApplicationStatusMessages[locale].statuses[status]}
    </span>
  );
}

export function OwnerApplicationReviewDetailView({
  locale,
  detail,
}: {
  locale: Locale;
  detail: OwnerApplicationReviewDetail;
}) {
  const copy = ownerApplicationReviewDetailMessages[locale];
  const ownerCopy = ownerApplicationMessages[locale];
  const [state, action] = useActionState(reviewOwnerApplicationAction, idle);
  const canDecide =
    detail.status === "submitted" || detail.status === "under_review";

  return (
    <div className="administrator-review-detail">
      <section className="application-section">
        <div className="application-section-heading">
          <span>01</span>
          <h1>{copy.title}</h1>
        </div>
        <StatusLabel locale={locale} status={detail.status} />
        <dl className="review-detail-grid">
          <div>
            <dt>{copy.legalName}</dt>
            <dd>{detail.legalName}</dd>
          </div>
          <div>
            <dt>{copy.applicantKind}</dt>
            <dd>{detail.applicantKind}</dd>
          </div>
          {detail.companyName ? (
            <div>
              <dt>{copy.companyName}</dt>
              <dd>{detail.companyName}</dd>
            </div>
          ) : null}
          <div>
            <dt>{copy.submitted}</dt>
            <dd>
              <time dateTime={detail.submittedAt}>
                {new Intl.DateTimeFormat(locale, {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: "Asia/Baghdad",
                }).format(new Date(detail.submittedAt))}
              </time>
            </dd>
          </div>
          {detail.reviewDueAt ? (
            <div>
              <dt>{copy.reviewDue}</dt>
              <dd>
                <time dateTime={detail.reviewDueAt}>
                  {new Intl.DateTimeFormat(locale, {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: "Asia/Baghdad",
                  }).format(new Date(detail.reviewDueAt))}
                </time>
              </dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section className="application-section">
        <div className="application-section-heading">
          <span>02</span>
          <h2>{copy.cottage}</h2>
        </div>
        <dl className="review-detail-grid">
          <div>
            <dt>{ownerCopy.cottageName}</dt>
            <dd>{detail.cottage.name}</dd>
          </div>
          <div>
            <dt>{ownerCopy.governorate}</dt>
            <dd>{detail.cottage.governorate}</dd>
          </div>
          <div>
            <dt>{ownerCopy.approximateLocation}</dt>
            <dd>{detail.cottage.approximateLocation}</dd>
          </div>
          <div>
            <dt>{copy.exactAddress}</dt>
            <dd>{detail.cottage.exactAddress}</dd>
          </div>
          <div>
            <dt>{ownerCopy.capacity}</dt>
            <dd>{detail.cottage.capacity}</dd>
          </div>
          <div>
            <dt>{ownerCopy.bedrooms}</dt>
            <dd>{detail.cottage.bedrooms}</dd>
          </div>
          <div>
            <dt>{ownerCopy.bathrooms}</dt>
            <dd>{detail.cottage.bathrooms}</dd>
          </div>
          <div>
            <dt>{copy.description}</dt>
            <dd>{detail.cottage.description}</dd>
          </div>
          <div>
            <dt>{copy.houseRules}</dt>
            <dd>{detail.cottage.houseRules}</dd>
          </div>
        </dl>
      </section>

      <section className="application-section">
        <div className="application-section-heading">
          <span>03</span>
          <h2>{copy.evidence}</h2>
        </div>
        <ul className="administrator-review-documents">
          {detail.documents.map((document) => (
            <ReviewDocument
              key={document.id}
              locale={locale}
              document={document}
            />
          ))}
        </ul>
      </section>

      <section className="application-section review-actions-section">
        <div className="application-section-heading">
          <span>04</span>
          <h2>{copy.application}</h2>
        </div>
        {detail.status === "submitted" ? (
          <form action={action}>
            <ReviewActionFields
              detail={detail}
              locale={locale}
              action="start_review"
            />
            <ActionButton kind="primary" width="content" type="submit">
              {copy.startReview}
            </ActionButton>
          </form>
        ) : null}
        {canDecide ? (
          <>
            <form action={action} className="review-action-card">
              <ReviewActionFields
                detail={detail}
                locale={locale}
                action="request_information"
              />
              <h3>{copy.requestInformation}</h3>
              <FormControl
                kind="textarea"
                name="reason"
                aria-label={copy.reason}
                required
                maxLength={1000}
              />
              <fieldset>
                <legend>{copy.requestedFields}</legend>
                {ownerApplicationResponseFields.map((field) => (
                  <label key={field}>
                    <input
                      type="checkbox"
                      name="requestedFields"
                      value={field}
                    />
                    {ownerCopy.missing[field] ?? field}
                  </label>
                ))}
              </fieldset>
              <fieldset>
                <legend>{copy.requestedDocuments}</legend>
                {verificationDocumentKinds.map((kind) => (
                  <label key={kind}>
                    <input
                      type="checkbox"
                      name="requestedDocumentKinds"
                      value={kind}
                    />
                    {ownerCopy.documentKinds[kind].title}
                  </label>
                ))}
              </fieldset>
              <ActionButton kind="secondary" size="regular" type="submit">
                {copy.requestInformation}
              </ActionButton>
            </form>
            <form action={action} className="review-action-card">
              <ReviewActionFields
                detail={detail}
                locale={locale}
                action="approve"
              />
              <h3>{copy.approve}</h3>
              <FormControl
                kind="textarea"
                name="reason"
                aria-label={copy.reason}
                required
                maxLength={1000}
              />
              <FormControl
                kind="input"
                name="jurisdiction"
                aria-label={copy.jurisdiction}
                required
                maxLength={120}
              />
              <FormControl
                kind="select"
                name="licensingBasis"
                aria-label={copy.licensingBasis}
                defaultValue={detail.licensingBasis}
              >
                <option value="licence">{copy.licence}</option>
                <option value="exemption">{copy.exemption}</option>
              </FormControl>
              <FormControl
                kind="textarea"
                name="licenceOrExemptionBasis"
                aria-label={copy.basis}
                required
                maxLength={1000}
              />
              <fieldset>
                <legend>{copy.expiryDate}</legend>
                {detail.documents.map((document) => (
                  <label key={document.kind}>
                    {ownerCopy.documentKinds[document.kind].title}
                    <FormControl
                      kind="input"
                      type="date"
                      name={`expiryDate:${document.kind}`}
                      aria-label={`${copy.expiryDate}: ${ownerCopy.documentKinds[document.kind].title}`}
                      required={document.kind === "licensing_or_exemption"}
                    />
                  </label>
                ))}
              </fieldset>
              <ActionButton kind="primary" width="content" type="submit">
                {copy.approve}
              </ActionButton>
            </form>
            <form action={action} className="review-action-card">
              <ReviewActionFields
                detail={detail}
                locale={locale}
                action="reject"
              />
              <h3>{copy.reject}</h3>
              <FormControl
                kind="textarea"
                name="reason"
                aria-label={copy.reason}
                required
                maxLength={1000}
              />
              <ActionButton kind="secondary" size="regular" type="submit">
                {copy.reject}
              </ActionButton>
            </form>
          </>
        ) : null}
        {detail.status === "approved" || detail.status === "expired" ? (
          <form action={action} className="review-action-card">
            <ReviewActionFields
              detail={detail}
              locale={locale}
              action="suspend"
            />
            <h3>{copy.suspend}</h3>
            <FormControl
              kind="textarea"
              name="reason"
              aria-label={copy.reason}
              required
              maxLength={1000}
            />
            <ActionButton kind="secondary" size="regular" type="submit">
              {copy.suspend}
            </ActionButton>
          </form>
        ) : null}
        {state.status === "completed" ? (
          <ActionFeedback kind="success">{copy.completed}</ActionFeedback>
        ) : state.status === "invalid" ? (
          <ActionFeedback kind="error">{copy.invalid}</ActionFeedback>
        ) : state.status === "unavailable" ? (
          <ActionFeedback kind="error">{copy.unavailable}</ActionFeedback>
        ) : null}
      </section>

      <section className="application-section">
        <div className="application-section-heading">
          <span>05</span>
          <h2>{copy.history}</h2>
        </div>
        {detail.transitions.length ? (
          <ol>
            {detail.transitions.map((transition, index) => (
              <li key={`${transition.occurredAt}-${index}`}>
                <time dateTime={transition.occurredAt}>
                  {new Intl.DateTimeFormat(locale, {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: "Asia/Baghdad",
                  }).format(new Date(transition.occurredAt))}
                </time>{" "}
                ·{" "}
                {
                  ownerApplicationStatusMessages[locale].statuses[
                    transition.fromStatus
                  ]
                }{" "}
                →{" "}
                {
                  ownerApplicationStatusMessages[locale].statuses[
                    transition.toStatus
                  ]
                }
                {transition.reason ? ` · ${transition.reason}` : ""}
              </li>
            ))}
          </ol>
        ) : (
          <p>{copy.noHistory}</p>
        )}
      </section>
    </div>
  );
}
