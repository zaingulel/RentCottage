"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  saveOwnerApplicationAction,
  submitOwnerApplicationAction,
  uploadOwnerDocumentAction,
  type UploadOwnerDocumentState,
} from "@/owner-application/actions";
import {
  type OwnerApplicationSnapshot,
  type OwnerVerificationDocument,
  type VerificationDocumentKind,
  verificationDocumentKinds,
} from "@/owner-application/owner-application";
import { ownerApplicationMessages } from "@/i18n/owner-application-messages";
import type { Locale } from "@/i18n/routing";

function SubmitButton({ children }: { children: string }) {
  const { pending } = useFormStatus();
  return <button disabled={pending}>{children}</button>;
}

function ActionMessage({
  status,
  copy,
}: {
  status: string;
  copy: ReturnType<typeof copyFor>;
}) {
  if (status === "idle") return null;
  const message =
    status === "saved"
      ? copy.saved
      : status === "uploaded"
        ? copy.uploaded
        : status === "uploaded_cleanup_required"
          ? copy.uploadedCleanupRequired
          : status === "uploaded_deletion_audit_required"
            ? copy.uploadedDeletionAuditRequired
            : status === "failed_cleanup_required"
              ? copy.failedCleanupRequired
              : status === "submitted"
                ? copy.submitted
                : status === "invalid_document"
                  ? copy.invalidDocument
                  : status === "invalid"
                    ? copy.invalid
                    : copy.unavailable;
  const successful =
    status === "saved" || status === "uploaded" || status === "submitted";
  return (
    <p
      role={successful ? "status" : "alert"}
      className={successful ? "application-success" : "application-error"}
    >
      {message}
    </p>
  );
}

function copyFor(locale: Locale) {
  return ownerApplicationMessages[locale];
}

function VerificationDocumentRow({
  locale,
  kind,
  document,
  disabled,
}: {
  locale: Locale;
  kind: VerificationDocumentKind;
  document?: OwnerVerificationDocument;
  disabled: boolean;
}) {
  const copy = copyFor(locale);
  const [uploadState, uploadAction] = useActionState(
    uploadOwnerDocumentAction,
    { status: "idle" } as UploadOwnerDocumentState,
  );
  const headingId = `verification-document-${kind}`;

  return (
    <article className="verification-document-card" aria-labelledby={headingId}>
      <div>
        <h3 id={headingId}>{copy.documentKinds[kind].title}</h3>
        <p>{copy.documentKinds[kind].help}</p>
        {document ? <strong>{document.originalFilename}</strong> : null}
      </div>
      {!disabled ? (
        <form action={uploadAction} className="document-upload-form">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="kind" value={kind} />
          <label>
            <span>{copy.documentRules}</span>
            <input
              required
              type="file"
              name="document"
              accept="application/pdf,image/jpeg,image/png"
            />
          </label>
          <SubmitButton>{document ? copy.replace : copy.upload}</SubmitButton>
          <ActionMessage status={uploadState.status} copy={copy} />
        </form>
      ) : null}
    </article>
  );
}

export function OwnerApplicationForm({
  locale,
  application,
}: {
  locale: Locale;
  application: OwnerApplicationSnapshot | null;
}) {
  const copy = copyFor(locale);
  const submitted = application?.status === "submitted";
  const [saveState, saveAction] = useActionState(saveOwnerApplicationAction, {
    status: "idle",
  });
  const [submitState, submitAction] = useActionState(
    submitOwnerApplicationAction,
    { status: "idle" },
  );
  const invalidFields = new Set(
    saveState.status === "invalid" ? saveState.fields : [],
  );
  const visibleDocumentKinds = verificationDocumentKinds.filter((kind) => {
    const applicantKind = application?.applicantKind ?? "individual";
    if (kind === "identity") return applicantKind === "individual";
    if (
      kind === "company_registration" ||
      kind === "authorised_representative"
    ) {
      return applicantKind === "company";
    }
    if (kind === "licensing_or_exemption") {
      return (application?.licensingBasis ?? "licence") === "licence";
    }
    return true;
  });

  return (
    <div className="owner-application-layout">
      <aside className="application-progress-card">
        <span
          className={`application-status application-status-${submitted ? "submitted" : "draft"}`}
        >
          {submitted ? copy.submittedStatus : copy.draftStatus}
        </span>
        <h1>{copy.title}</h1>
        <p>{submitted ? copy.submittedNote : copy.intro}</p>
        <p className="application-privacy-note">{copy.privacyNote}</p>
      </aside>

      <div className="application-workspace">
        <form action={saveAction} className="owner-application-form">
          <input type="hidden" name="locale" value={locale} />
          <fieldset disabled={submitted}>
            <section className="application-section">
              <div className="application-section-heading">
                <span>01</span>
                <h2>{copy.ownerSection}</h2>
              </div>
              <div className="application-fields two-columns">
                <label>
                  {copy.applicantKind}
                  <select
                    name="applicantKind"
                    aria-invalid={invalidFields.has("applicantKind")}
                    defaultValue={application?.applicantKind ?? "individual"}
                  >
                    <option value="individual">{copy.individual}</option>
                    <option value="company">{copy.company}</option>
                  </select>
                </label>
                <label>
                  {copy.legalName}
                  <input
                    name="legalName"
                    maxLength={120}
                    aria-invalid={invalidFields.has("legalName")}
                    defaultValue={application?.legalName}
                  />
                </label>
                <label>
                  {copy.companyName}
                  <input
                    name="companyName"
                    maxLength={120}
                    aria-invalid={invalidFields.has("companyName")}
                    defaultValue={application?.companyName}
                  />
                </label>
                <label>
                  {copy.licensingBasis}
                  <select
                    name="licensingBasis"
                    aria-invalid={invalidFields.has("licensingBasis")}
                    defaultValue={application?.licensingBasis ?? "licence"}
                  >
                    <option value="licence">{copy.licence}</option>
                    <option value="exemption">{copy.exemption}</option>
                  </select>
                </label>
                <label>
                  {copy.exemptionBasis}
                  <textarea
                    name="exemptionBasis"
                    rows={3}
                    maxLength={1000}
                    aria-invalid={invalidFields.has("exemptionBasis")}
                    defaultValue={application?.exemptionBasis}
                  />
                  <small>{copy.exemptionBasisHelp}</small>
                </label>
              </div>
            </section>

            <section className="application-section">
              <div className="application-section-heading">
                <span>02</span>
                <h2>{copy.cottageSection}</h2>
              </div>
              <div className="application-fields two-columns">
                <label>
                  {copy.cottageName}
                  <input
                    name="cottageName"
                    maxLength={120}
                    aria-invalid={invalidFields.has("cottageName")}
                    defaultValue={application?.cottage.name}
                  />
                </label>
                <label>
                  {copy.governorate}
                  <input
                    name="governorate"
                    maxLength={120}
                    aria-invalid={invalidFields.has("governorate")}
                    defaultValue={application?.cottage.governorate}
                  />
                </label>
                <label>
                  {copy.approximateLocation}
                  <input
                    name="approximateLocation"
                    maxLength={240}
                    aria-invalid={invalidFields.has("approximateLocation")}
                    defaultValue={application?.cottage.approximateLocation}
                  />
                </label>
                <label>
                  {copy.exactAddress}
                  <input
                    name="exactAddress"
                    maxLength={240}
                    aria-invalid={invalidFields.has("exactAddress")}
                    defaultValue={application?.cottage.exactAddress}
                  />
                  <small>{copy.exactAddressHelp}</small>
                </label>
              </div>
              <div className="application-fields number-fields">
                <label>
                  {copy.capacity}
                  <input
                    type="number"
                    min="1"
                    max="100"
                    name="capacity"
                    aria-invalid={invalidFields.has("capacity")}
                    defaultValue={application?.cottage.capacity ?? ""}
                  />
                </label>
                <label>
                  {copy.bedrooms}
                  <input
                    type="number"
                    min="1"
                    max="50"
                    name="bedrooms"
                    aria-invalid={invalidFields.has("bedrooms")}
                    defaultValue={application?.cottage.bedrooms ?? ""}
                  />
                </label>
                <label>
                  {copy.bathrooms}
                  <input
                    type="number"
                    min="1"
                    max="50"
                    name="bathrooms"
                    aria-invalid={invalidFields.has("bathrooms")}
                    defaultValue={application?.cottage.bathrooms ?? ""}
                  />
                </label>
              </div>
              <fieldset className="amenities-fieldset">
                <legend>{copy.amenities}</legend>
                <div className="amenity-options">
                  {copy.amenityOptions.map((amenity) => (
                    <label key={amenity.value}>
                      <input
                        type="checkbox"
                        name="amenities"
                        value={amenity.value}
                        defaultChecked={application?.cottage.amenities.includes(
                          amenity.value,
                        )}
                      />
                      {amenity.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="application-fields">
                <label>
                  {copy.description}
                  <textarea
                    name="description"
                    rows={5}
                    maxLength={2000}
                    aria-invalid={invalidFields.has("description")}
                    defaultValue={application?.cottage.description}
                  />
                </label>
                <label>
                  {copy.houseRules}
                  <textarea
                    name="houseRules"
                    rows={4}
                    maxLength={1500}
                    aria-invalid={invalidFields.has("houseRules")}
                    defaultValue={application?.cottage.houseRules}
                  />
                </label>
              </div>
            </section>
          </fieldset>

          {!submitted ? (
            <div className="application-primary-action">
              <SubmitButton>{copy.saveDraft}</SubmitButton>
              <ActionMessage status={saveState.status} copy={copy} />
            </div>
          ) : null}
        </form>

        <section className="application-section verification-section">
          <div className="application-section-heading">
            <span>03</span>
            <div>
              <h2>{copy.documentsSection}</h2>
              <p>{copy.documentsIntro}</p>
            </div>
          </div>
          {!application ? (
            <p className="application-notice">{copy.saveBeforeDocuments}</p>
          ) : null}
          <div className="verification-document-list">
            {visibleDocumentKinds.map((kind) => (
              <VerificationDocumentRow
                key={kind}
                locale={locale}
                kind={kind}
                document={application?.documents.find(
                  (item) => item.kind === kind,
                )}
                disabled={!application || submitted}
              />
            ))}
          </div>
        </section>

        {application && !submitted ? (
          <section className="application-submit-card">
            <form action={submitAction}>
              <input type="hidden" name="locale" value={locale} />
              <SubmitButton>{copy.submit}</SubmitButton>
            </form>
            {submitState.status === "incomplete" ? (
              <div className="application-missing" role="alert">
                <strong>{copy.incompleteTitle}</strong>
                <ul>
                  {submitState.missingItems.map((item) => (
                    <li key={item}>{copy.missing[item] ?? item}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <ActionMessage status={submitState.status} copy={copy} />
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}
