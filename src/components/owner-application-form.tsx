"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import {
  saveOwnerApplicationAction,
  submitOwnerApplicationAction,
  uploadOwnerDocumentAction,
  type OwnerApplicationFormValues,
  type UploadOwnerDocumentState,
} from "@/owner-application/actions";
import {
  type OwnerApplicationSnapshot,
  type OwnerApplicantKind,
  type OwnerLicensingBasis,
  type OwnerVerificationDocument,
  type VerificationDocumentKind,
  isVerificationDocumentKindRequired,
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
      : status === "saved_cleanup_required"
        ? copy.savedCleanupRequired
        : status === "saved_deletion_audit_required"
          ? copy.savedDeletionAuditRequired
          : status === "uploaded"
            ? copy.uploaded
            : status === "uploaded_cleanup_required"
              ? copy.uploadedCleanupRequired
              : status === "uploaded_deletion_audit_required"
                ? copy.uploadedDeletionAuditRequired
                : status === "failed_cleanup_required"
                  ? copy.failedCleanupRequired
                  : status === "registration_reconciliation_required"
                    ? copy.registrationReconciliationRequired
                    : status === "submitted"
                      ? copy.submitted
                      : status === "invalid_document"
                        ? copy.invalidDocument
                        : status === "application_required"
                          ? copy.saveBeforeDocuments
                          : status === "denied"
                            ? copy.denied
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

function valuesFor(
  application: OwnerApplicationSnapshot | null,
): OwnerApplicationFormValues {
  return {
    applicantKind: application?.applicantKind ?? "individual",
    legalName: application?.legalName ?? "",
    companyName: application?.companyName ?? "",
    licensingBasis: application?.licensingBasis ?? "licence",
    exemptionBasis: application?.exemptionBasis ?? "",
    cottageName: application?.cottage.name ?? "",
    governorate: application?.cottage.governorate ?? "",
    approximateLocation: application?.cottage.approximateLocation ?? "",
    exactAddress: application?.cottage.exactAddress ?? "",
    capacity: application?.cottage.capacity?.toString() ?? "",
    bedrooms: application?.cottage.bedrooms?.toString() ?? "",
    bathrooms: application?.cottage.bathrooms?.toString() ?? "",
    amenities: application?.cottage.amenities ?? [],
    description: application?.cottage.description ?? "",
    houseRules: application?.cottage.houseRules ?? "",
  };
}

function invalidFieldId(field: keyof OwnerApplicationFormValues) {
  return `owner-application-${field}-error`;
}

function InvalidFieldMessage({
  field,
  invalid,
  message,
}: {
  field: keyof OwnerApplicationFormValues;
  invalid: boolean;
  message: string;
}) {
  return invalid ? (
    <small id={invalidFieldId(field)} className="field-error">
      {message}
    </small>
  ) : null;
}

function VerificationDocumentRow({
  locale,
  kind,
  savedDocument,
  disabled,
}: {
  locale: Locale;
  kind: VerificationDocumentKind;
  savedDocument?: OwnerVerificationDocument;
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
        {savedDocument ? (
          <strong>{savedDocument.originalFilename}</strong>
        ) : null}
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
          <SubmitButton>
            {savedDocument ? copy.replace : copy.upload}
          </SubmitButton>
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
  const values =
    saveState.status === "invalid" ? saveState.values : valuesFor(application);
  const [applicantKind, setApplicantKind] = useState<OwnerApplicantKind>(
    values.applicantKind === "company" ? "company" : "individual",
  );
  const [licensingBasis, setLicensingBasis] = useState<OwnerLicensingBasis>(
    values.licensingBasis === "exemption" ? "exemption" : "licence",
  );
  const visibleDocumentKinds = verificationDocumentKinds.filter((kind) =>
    isVerificationDocumentKindRequired(kind, applicantKind, licensingBasis),
  );
  const invalidAttributes = (field: keyof OwnerApplicationFormValues) => ({
    "aria-invalid": invalidFields.has(field),
    "aria-describedby": invalidFields.has(field)
      ? invalidFieldId(field)
      : undefined,
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
                    aria-label={copy.applicantKind}
                    {...invalidAttributes("applicantKind")}
                    value={applicantKind}
                    onChange={(event) =>
                      setApplicantKind(event.target.value as OwnerApplicantKind)
                    }
                  >
                    <option value="individual">{copy.individual}</option>
                    <option value="company">{copy.company}</option>
                  </select>
                  <InvalidFieldMessage
                    field="applicantKind"
                    invalid={invalidFields.has("applicantKind")}
                    message={copy.invalidField}
                  />
                </label>
                <label>
                  {copy.legalName}
                  <input
                    name="legalName"
                    aria-label={copy.legalName}
                    maxLength={120}
                    {...invalidAttributes("legalName")}
                    defaultValue={values.legalName}
                  />
                  <InvalidFieldMessage
                    field="legalName"
                    invalid={invalidFields.has("legalName")}
                    message={copy.invalidField}
                  />
                </label>
                <label>
                  {copy.companyName}
                  <input
                    name="companyName"
                    aria-label={copy.companyName}
                    maxLength={120}
                    {...invalidAttributes("companyName")}
                    defaultValue={values.companyName}
                  />
                  <InvalidFieldMessage
                    field="companyName"
                    invalid={invalidFields.has("companyName")}
                    message={copy.invalidField}
                  />
                </label>
                <label>
                  {copy.licensingBasis}
                  <select
                    name="licensingBasis"
                    aria-label={copy.licensingBasis}
                    {...invalidAttributes("licensingBasis")}
                    value={licensingBasis}
                    onChange={(event) =>
                      setLicensingBasis(
                        event.target.value as OwnerLicensingBasis,
                      )
                    }
                  >
                    <option value="licence">{copy.licence}</option>
                    <option value="exemption">{copy.exemption}</option>
                  </select>
                  <InvalidFieldMessage
                    field="licensingBasis"
                    invalid={invalidFields.has("licensingBasis")}
                    message={copy.invalidField}
                  />
                </label>
                <label>
                  {copy.exemptionBasis}
                  <textarea
                    name="exemptionBasis"
                    aria-label={copy.exemptionBasis}
                    rows={3}
                    maxLength={1000}
                    {...invalidAttributes("exemptionBasis")}
                    defaultValue={values.exemptionBasis}
                  />
                  <InvalidFieldMessage
                    field="exemptionBasis"
                    invalid={invalidFields.has("exemptionBasis")}
                    message={copy.invalidField}
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
                    aria-label={copy.cottageName}
                    maxLength={120}
                    {...invalidAttributes("cottageName")}
                    defaultValue={values.cottageName}
                  />
                  <InvalidFieldMessage
                    field="cottageName"
                    invalid={invalidFields.has("cottageName")}
                    message={copy.invalidField}
                  />
                </label>
                <label>
                  {copy.governorate}
                  <input
                    name="governorate"
                    aria-label={copy.governorate}
                    maxLength={120}
                    {...invalidAttributes("governorate")}
                    defaultValue={values.governorate}
                  />
                  <InvalidFieldMessage
                    field="governorate"
                    invalid={invalidFields.has("governorate")}
                    message={copy.invalidField}
                  />
                </label>
                <label>
                  {copy.approximateLocation}
                  <input
                    name="approximateLocation"
                    aria-label={copy.approximateLocation}
                    maxLength={240}
                    {...invalidAttributes("approximateLocation")}
                    defaultValue={values.approximateLocation}
                  />
                  <InvalidFieldMessage
                    field="approximateLocation"
                    invalid={invalidFields.has("approximateLocation")}
                    message={copy.invalidField}
                  />
                </label>
                <label>
                  {copy.exactAddress}
                  <input
                    name="exactAddress"
                    aria-label={copy.exactAddress}
                    maxLength={240}
                    {...invalidAttributes("exactAddress")}
                    defaultValue={values.exactAddress}
                  />
                  <InvalidFieldMessage
                    field="exactAddress"
                    invalid={invalidFields.has("exactAddress")}
                    message={copy.invalidField}
                  />
                  <small>{copy.exactAddressHelp}</small>
                </label>
              </div>
              <div className="application-fields number-fields">
                <label>
                  {copy.capacity}
                  <input
                    type="number"
                    aria-label={copy.capacity}
                    min="1"
                    max="100"
                    name="capacity"
                    {...invalidAttributes("capacity")}
                    defaultValue={values.capacity}
                  />
                  <InvalidFieldMessage
                    field="capacity"
                    invalid={invalidFields.has("capacity")}
                    message={copy.invalidField}
                  />
                </label>
                <label>
                  {copy.bedrooms}
                  <input
                    type="number"
                    aria-label={copy.bedrooms}
                    min="1"
                    max="50"
                    name="bedrooms"
                    {...invalidAttributes("bedrooms")}
                    defaultValue={values.bedrooms}
                  />
                  <InvalidFieldMessage
                    field="bedrooms"
                    invalid={invalidFields.has("bedrooms")}
                    message={copy.invalidField}
                  />
                </label>
                <label>
                  {copy.bathrooms}
                  <input
                    type="number"
                    aria-label={copy.bathrooms}
                    min="1"
                    max="50"
                    name="bathrooms"
                    {...invalidAttributes("bathrooms")}
                    defaultValue={values.bathrooms}
                  />
                  <InvalidFieldMessage
                    field="bathrooms"
                    invalid={invalidFields.has("bathrooms")}
                    message={copy.invalidField}
                  />
                </label>
              </div>
              <fieldset
                className="amenities-fieldset"
                {...invalidAttributes("amenities")}
              >
                <legend>{copy.amenities}</legend>
                <div className="amenity-options">
                  {copy.amenityOptions.map((amenity) => (
                    <label key={amenity.value}>
                      <input
                        type="checkbox"
                        name="amenities"
                        value={amenity.value}
                        defaultChecked={values.amenities.includes(
                          amenity.value,
                        )}
                      />
                      {amenity.label}
                    </label>
                  ))}
                </div>
                <InvalidFieldMessage
                  field="amenities"
                  invalid={invalidFields.has("amenities")}
                  message={copy.invalidField}
                />
              </fieldset>
              <div className="application-fields">
                <label>
                  {copy.description}
                  <textarea
                    name="description"
                    aria-label={copy.description}
                    rows={5}
                    maxLength={2000}
                    {...invalidAttributes("description")}
                    defaultValue={values.description}
                  />
                  <InvalidFieldMessage
                    field="description"
                    invalid={invalidFields.has("description")}
                    message={copy.invalidField}
                  />
                </label>
                <label>
                  {copy.houseRules}
                  <textarea
                    name="houseRules"
                    aria-label={copy.houseRules}
                    rows={4}
                    maxLength={1500}
                    {...invalidAttributes("houseRules")}
                    defaultValue={values.houseRules}
                  />
                  <InvalidFieldMessage
                    field="houseRules"
                    invalid={invalidFields.has("houseRules")}
                    message={copy.invalidField}
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
                savedDocument={application?.documents.find(
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
