"use client";

import { useActionState } from "react";

import {
  ActionButton,
  ActionFeedback,
  FormControl,
} from "@/components/interaction-controls";
import { ownerApplicationMessages } from "@/i18n/owner-application-messages";
import { ownerApplicationStatusMessages } from "@/i18n/owner-application-status-messages";
import type { Locale } from "@/i18n/routing";
import {
  respondToOwnerApplicationAction,
  submitOwnerApplicationRenewalAction,
  type OwnerApplicationResponseState,
} from "@/owner-application/actions";
import type {
  OwnerApplicationSnapshot,
  VerificationDocumentKind,
} from "@/owner-application/owner-application";
import type { OwnerApplicationResponseField } from "@/owner-application/owner-application-review";
import type { OwnerApplicationOwnerReview } from "@/owner-application/supabase-owner-application-review";
import { VerificationDocumentRow } from "./owner-application-form";

const idle: OwnerApplicationResponseState = { status: "idle" };

function valueFor(
  application: OwnerApplicationSnapshot,
  field: OwnerApplicationResponseField,
): string | string[] {
  const values: Record<OwnerApplicationResponseField, string | string[]> = {
    legal_name: application.legalName,
    company_name: application.companyName,
    licensing_basis: application.licensingBasis,
    exemption_basis: application.exemptionBasis,
    cottage_name: application.cottage.name,
    governorate: application.cottage.governorate,
    approximate_location: application.cottage.approximateLocation,
    exact_address: application.cottage.exactAddress,
    capacity: application.cottage.capacity?.toString() ?? "",
    bedrooms: application.cottage.bedrooms?.toString() ?? "",
    bathrooms: application.cottage.bathrooms?.toString() ?? "",
    amenities: application.cottage.amenities,
    description: application.cottage.description,
    house_rules: application.cottage.houseRules,
  };
  return values[field];
}

function RequestedField({
  application,
  field,
  locale,
}: {
  application: OwnerApplicationSnapshot;
  field: OwnerApplicationResponseField;
  locale: Locale;
}) {
  const copy = ownerApplicationMessages[locale];
  const label = copy.missing[field] ?? field;
  const value = valueFor(application, field);
  if (field === "amenities") {
    return (
      <>
        <input type="hidden" name="requestedField" value={field} />
        <fieldset>
          <legend>{label}</legend>
          <span className="amenity-options">
            {copy.amenityOptions.map((amenity) => (
              <label key={amenity.value}>
                <input
                  type="checkbox"
                  name={field}
                  value={amenity.value}
                  defaultChecked={(value as string[]).includes(amenity.value)}
                />
                {amenity.label}
              </label>
            ))}
          </span>
        </fieldset>
      </>
    );
  }
  return (
    <>
      <input type="hidden" name="requestedField" value={field} />
      <label>
        {label}
        {field === "licensing_basis" ? (
          <FormControl
            kind="select"
            name={field}
            aria-label={label}
            defaultValue={value as string}
          >
            <option value="licence">{copy.licence}</option>
            <option value="exemption">{copy.exemption}</option>
          </FormControl>
        ) : field === "description" ||
          field === "house_rules" ||
          field === "exemption_basis" ? (
          <FormControl
            kind="textarea"
            name={field}
            aria-label={label}
            defaultValue={value as string}
            required
          />
        ) : (
          <FormControl
            kind="input"
            name={field}
            aria-label={label}
            defaultValue={value as string}
            type={
              field === "capacity" ||
              field === "bedrooms" ||
              field === "bathrooms"
                ? "number"
                : "text"
            }
            required
          />
        )}
      </label>
    </>
  );
}

function EvidenceRows({
  locale,
  application,
  kinds,
}: {
  locale: Locale;
  application: OwnerApplicationSnapshot;
  kinds: VerificationDocumentKind[];
}) {
  return (
    <div className="verification-document-list">
      {kinds.map((kind) => (
        <VerificationDocumentRow
          key={kind}
          locale={locale}
          kind={kind}
          savedDocument={application.documents.find(
            (document) => document.kind === kind,
          )}
          disabled={false}
        />
      ))}
    </div>
  );
}

function ResponseFeedback({
  state,
  locale,
}: {
  state: OwnerApplicationResponseState;
  locale: Locale;
}) {
  const copy = ownerApplicationStatusMessages[locale];
  return state.status === "submitted" ? (
    <ActionFeedback kind="success">{copy.submitted}</ActionFeedback>
  ) : state.status === "invalid" || state.status === "unavailable" ? (
    <ActionFeedback kind="error">{copy.unavailable}</ActionFeedback>
  ) : null;
}

export function OwnerApplicationReviewStatus({
  locale,
  application,
  review,
}: {
  locale: Locale;
  application: OwnerApplicationSnapshot;
  review: OwnerApplicationOwnerReview;
}) {
  const copy = ownerApplicationStatusMessages[locale];
  const [responseState, responseAction] = useActionState(
    respondToOwnerApplicationAction,
    idle,
  );
  const [renewalState, renewalAction] = useActionState(
    submitOwnerApplicationRenewalAction,
    idle,
  );
  return (
    <section className="application-section owner-review-status">
      <span
        className={`application-status application-status-${application.status}`}
      >
        {copy.statuses[application.status]}
      </span>
      {review.notices.length > 0 ? (
        <div>
          <h2>{copy.notices}</h2>
          <ol>
            {review.notices.map((notice, index) => (
              <li key={`${notice.createdAt}-${index}`}>
                <time dateTime={notice.createdAt}>
                  {new Intl.DateTimeFormat(locale, {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: "Asia/Baghdad",
                  }).format(new Date(notice.createdAt))}
                </time>
                {notice.reason ? ` · ${notice.reason}` : ""}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {review.activeRequest ? (
        <div className="owner-response-card">
          <h2>{copy.requestedInformation}</h2>
          <p>
            <strong>{copy.reason}:</strong> {review.activeRequest.reason}
          </p>
          <EvidenceRows
            locale={locale}
            application={application}
            kinds={review.activeRequest.requestedDocumentKinds}
          />
          <form action={responseAction}>
            <input type="hidden" name="locale" value={locale} />
            <input
              type="hidden"
              name="expectedVersion"
              value={application.version}
            />
            {review.activeRequest.requestedFields.map((field) => (
              <RequestedField
                key={field}
                application={application}
                field={field}
                locale={locale}
              />
            ))}
            {review.activeRequest.requestedDocumentKinds.map((kind) => (
              <input
                key={kind}
                type="hidden"
                name="confirmedDocumentKinds"
                value={kind}
              />
            ))}
            <ActionButton kind="primary" width="content" type="submit">
              {copy.respond}
            </ActionButton>
            <ResponseFeedback state={responseState} locale={locale} />
          </form>
        </div>
      ) : null}
      {application.status === "expired" &&
      review.renewalDocumentKinds.length > 0 ? (
        <div className="owner-response-card">
          <h2>{copy.renewalInformation}</h2>
          <EvidenceRows
            locale={locale}
            application={application}
            kinds={review.renewalDocumentKinds}
          />
          <form action={renewalAction}>
            <input type="hidden" name="locale" value={locale} />
            <input
              type="hidden"
              name="expectedVersion"
              value={application.version}
            />
            {review.renewalDocumentKinds.map((kind) => (
              <input
                key={kind}
                type="hidden"
                name="confirmedDocumentKinds"
                value={kind}
              />
            ))}
            <ActionButton kind="primary" width="content" type="submit">
              {copy.submitRenewal}
            </ActionButton>
            <ResponseFeedback state={renewalState} locale={locale} />
          </form>
        </div>
      ) : null}
    </section>
  );
}
