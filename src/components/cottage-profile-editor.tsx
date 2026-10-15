"use client";

import { useActionState } from "react";

import {
  deleteCottageProfilePhotoAction,
  previewCottageProfilePhotoAction,
  saveAdministratorCottageProfileAction,
  saveOwnerCottageProfileAction,
  submitCottageProfileAction,
  uploadCottageProfilePhotoAction,
  type CottagePhotoPreviewState,
  type CottageProfileActionState,
} from "@/cottage-profile/actions";
import {
  cottageProfileAmenities,
  type CottageProfile,
  type CottageProfilePhoto,
} from "@/cottage-profile/cottage-profile";
import {
  cottageProfileMessages,
  cottageProfileStatusLabel,
  cottageProfileStatusTone,
} from "@/i18n/cottage-profile-messages";
import type { Locale } from "@/i18n/routing";
import {
  ActionButton,
  ActionFocusTarget,
  ChoiceControl,
  FormControl,
  OptionGroup,
} from "./interaction-controls";

import { CottageLocationFields } from "./cottage-location-fields";

const idle: CottageProfileActionState = { status: "idle" };
const idlePreview: CottagePhotoPreviewState = { status: "idle" };

function Feedback({
  state,
  locale,
}: {
  state: CottageProfileActionState;
  locale: Locale;
}) {
  const copy = cottageProfileMessages[locale];
  if (state.status === "idle") return null;
  const text =
    state.status === "saved"
      ? copy.saved
      : state.status === "uploaded"
        ? copy.uploaded
        : state.status === "deleted"
          ? copy.deleted
          : state.status === "submitted"
            ? copy.submittedSuccess
            : state.status === "incomplete"
              ? copy.incomplete
              : state.status === "conflict"
                ? copy.conflict
                : copy.failed;
  return (
    <p
      role={
        state.status === "saved" ||
        state.status === "uploaded" ||
        state.status === "deleted" ||
        state.status === "submitted"
          ? "status"
          : "alert"
      }
    >
      {text}
    </p>
  );
}

function PhotoRow({
  locale,
  profileId,
  photo,
  editable,
}: {
  locale: Locale;
  profileId: string;
  photo: CottageProfilePhoto;
  editable: boolean;
}) {
  const copy = cottageProfileMessages[locale];
  const [preview, previewAction] = useActionState(
    previewCottageProfilePhotoAction,
    idlePreview,
  );
  const [deletion, deleteAction] = useActionState(
    deleteCottageProfilePhotoAction,
    idle,
  );
  const stateLabel =
    photo.state === "ready"
      ? copy.ready
      : photo.state === "pending"
        ? copy.pending
        : copy.deletionPending;
  return (
    <li className="cottage-photo-row">
      <div>
        <strong>{photo.originalFilename}</strong>
        <span>{stateLabel}</span>
      </div>
      {photo.state === "ready" ? (
        <form action={previewAction}>
          <input type="hidden" name="photoId" value={photo.id} />
          <button type="submit" className="cottage-photo-text-action">
            {copy.preview}
          </button>
        </form>
      ) : null}
      {preview.status === "ready" ? (
        <a
          className="cottage-photo-text-action"
          href={preview.url}
          target="_blank"
          rel="noreferrer"
        >
          {copy.preview}
        </a>
      ) : null}
      {preview.status === "denied" || preview.status === "unavailable" ? (
        <p role="alert">
          {preview.status === "denied"
            ? copy.previewDenied
            : copy.previewUnavailable}
        </p>
      ) : null}
      {editable ? (
        <form action={deleteAction}>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="profileId" value={profileId} />
          <input type="hidden" name="photoId" value={photo.id} />
          <button type="submit" className="cottage-photo-text-action">
            {copy.deletePhoto}
          </button>
        </form>
      ) : null}
      <Feedback state={deletion} locale={locale} />
    </li>
  );
}

export function CottageProfileEditor({
  locale,
  profile,
  actor,
  editable,
  sourceEditable = true,
  photoEditable = editable,
}: {
  locale: Locale;
  profile: CottageProfile;
  actor: "owner" | "administrator";
  editable: boolean;
  sourceEditable?: boolean;
  photoEditable?: boolean;
}) {
  const copy = cottageProfileMessages[locale];
  const saveAction =
    actor === "owner"
      ? saveOwnerCottageProfileAction
      : saveAdministratorCottageProfileAction;
  const [saveState, submitSave] = useActionState(saveAction, idle);
  const [uploadState, submitUpload] = useActionState(
    uploadCottageProfilePhotoAction,
    idle,
  );
  const [submitState, submitProfile] = useActionState(
    submitCottageProfileAction,
    idle,
  );
  const ownerCanSubmit =
    actor === "owner" && editable && profile.status === "draft";

  return (
    <section className="cottage-profile-editor">
      <header className="page-heading cottage-profile-editor-heading">
        <div>
          <h1
            id="cottage-profile-editor-title"
            tabIndex={-1}
            className="page-title action-focus-target"
          >
            {copy.editorTitle}
          </h1>
          <ActionFocusTarget
            targetId="cottage-profile-editor-title"
            navigation
          />
          <p>{copy.completion}</p>
        </div>
        <span
          className={`status-badge${cottageProfileStatusTone(profile) ? ` status-badge-${cottageProfileStatusTone(profile)}` : ""}`}
        >
          {cottageProfileStatusLabel(locale, profile)}
        </span>
      </header>
      {profile.status === "abandoned" ? (
        <p className="private-location-warning" role="status">
          {copy.abandonedReadOnly}
        </p>
      ) : !editable && profile.status === "draft" ? (
        <p className="private-location-warning" role="status">
          {copy.readOnly}
        </p>
      ) : null}

      <form action={submitSave} className="cottage-profile-form">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="profileId" value={profile.id} />
        <input type="hidden" name="expectedVersion" value={profile.version} />
        <fieldset
          aria-labelledby="cottage-profile-public-details-heading"
          disabled={!editable}
        >
          <div className="cottage-profile-section-heading">
            <h2
              className="section-title"
              id="cottage-profile-public-details-heading"
            >
              {copy.publicDetails}
            </h2>
          </div>
          <div className="cottage-profile-field-card card">
            <label>
              {copy.cottageName}
              <FormControl
                kind="input"
                name="name"
                defaultValue={profile.name}
              />
            </label>
            <div className="cottage-profile-location-grid">
              <label>
                {copy.governorate}
                <FormControl
                  kind="input"
                  name="governorate"
                  defaultValue={profile.governorate}
                />
              </label>
              <div className="cottage-profile-location-field">
                <label>
                  {copy.approximateLocation}
                  <FormControl
                    kind="input"
                    name="approximateLocation"
                    aria-describedby="cottage-profile-approximate-location-help"
                    defaultValue={profile.approximateLocation}
                  />
                </label>
                <p id="cottage-profile-approximate-location-help">
                  {copy.approximateLocationHelp}
                </p>
              </div>
            </div>
            <div className="cottage-profile-number-grid">
              <label>
                {copy.capacity}
                <FormControl
                  kind="input"
                  name="capacity"
                  type="number"
                  min="1"
                  max="100"
                  defaultValue={profile.capacity ?? ""}
                />
              </label>
              <label>
                {copy.bedrooms}
                <FormControl
                  kind="input"
                  name="bedrooms"
                  type="number"
                  min="1"
                  max="50"
                  defaultValue={profile.bedrooms ?? ""}
                />
              </label>
              <label>
                {copy.bathrooms}
                <FormControl
                  kind="input"
                  name="bathrooms"
                  type="number"
                  min="1"
                  max="50"
                  defaultValue={profile.bathrooms ?? ""}
                />
              </label>
            </div>
            <OptionGroup legend={copy.amenities} layout="wrap">
              {cottageProfileAmenities.map((amenity) => (
                <ChoiceControl
                  key={amenity}
                  kind="checkbox"
                  name="amenities"
                  value={amenity}
                  defaultChecked={profile.amenities.includes(amenity)}
                >
                  {copy[amenity]}
                </ChoiceControl>
              ))}
            </OptionGroup>
          </div>
        </fieldset>

        <fieldset
          aria-labelledby="cottage-profile-private-location-heading"
          disabled={!editable}
        >
          <div className="cottage-profile-section-heading">
            <h2
              className="section-title"
              id="cottage-profile-private-location-heading"
            >
              {copy.privateLocation}
            </h2>
            <p className="private-location-warning">{copy.privateWarning}</p>
          </div>
          <div className="cottage-profile-field-card card">
            <label>
              {copy.exactAddress}
              <FormControl
                kind="input"
                name="exactAddress"
                defaultValue={profile.exactAddress}
              />
            </label>
            <CottageLocationFields
              locale={locale}
              savedLatitude={profile.exactLatitude}
              savedLongitude={profile.exactLongitude}
            />
            <label>
              {copy.privateDirections}
              <FormControl
                kind="textarea"
                name="privateDirections"
                defaultValue={profile.privateDirections}
              />
            </label>
          </div>
        </fieldset>

        <fieldset
          aria-labelledby="cottage-profile-source-content-heading"
          disabled={!editable || !sourceEditable}
        >
          <div className="cottage-profile-section-heading">
            <h2
              className="section-title"
              id="cottage-profile-source-content-heading"
            >
              {copy.sourceContent}
            </h2>
          </div>
          <div className="cottage-profile-field-card card">
            <label>
              {copy.sourceLanguage}
              <FormControl
                kind="select"
                name="sourceLanguage"
                defaultValue={profile.sourceLanguage ?? ""}
              >
                <option value="">—</option>
                <option value="ar">{copy.arabic}</option>
                <option value="ckb">{copy.sorani}</option>
                <option value="en">{copy.english}</option>
              </FormControl>
            </label>
            <label>
              {copy.description}
              <FormControl
                kind="textarea"
                name="description"
                defaultValue={profile.description}
              />
            </label>
            <label>
              {copy.houseRules}
              <FormControl
                kind="textarea"
                name="houseRules"
                defaultValue={profile.houseRules}
              />
            </label>
          </div>
        </fieldset>
        {editable ? (
          <ActionButton kind="primary" type="submit">
            {copy.save}
          </ActionButton>
        ) : null}
        <Feedback state={saveState} locale={locale} />
      </form>

      <section className="cottage-profile-photos">
        <div className="cottage-profile-section-heading">
          <h2 className="section-title">{copy.photos}</h2>
          <p>{copy.photoGuidance}</p>
        </div>
        <div className="cottage-profile-field-card card">
          <ul>
            {profile.photos.map((photo) => (
              <PhotoRow
                key={photo.id}
                locale={locale}
                profileId={profile.id}
                photo={photo}
                editable={photoEditable}
              />
            ))}
          </ul>
          {photoEditable ? (
            <form action={submitUpload} className="cottage-photo-upload-form">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="profileId" value={profile.id} />
              <label>
                {copy.photoFile}
                <FormControl
                  kind="input"
                  type="file"
                  name="photo"
                  accept="image/jpeg,image/png,image/webp"
                />
              </label>
              <ActionButton kind="secondary" size="regular" type="submit">
                {copy.uploadPhoto}
              </ActionButton>
            </form>
          ) : null}
          <Feedback state={uploadState} locale={locale} />
        </div>
      </section>

      {ownerCanSubmit ? (
        <form action={submitProfile} className="cottage-profile-submit-form">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="profileId" value={profile.id} />
          <input type="hidden" name="expectedVersion" value={profile.version} />
          <ActionButton kind="primary" type="submit">
            {copy.submit}
          </ActionButton>
          <Feedback state={submitState} locale={locale} />
        </form>
      ) : null}

      {profile.submittedSourceRevision ? (
        <section className="cottage-profile-source-revision">
          <h2 className="section-title">{copy.sourceRevision}</h2>
          <p>{copy.sourceNotice}</p>
          <dl>
            <div>
              <dt>{copy.revision}</dt>
              <dd>{profile.submittedSourceRevision.revision}</dd>
            </div>
            <div>
              <dt>{copy.description}</dt>
              <dd>{profile.submittedSourceRevision.description}</dd>
            </div>
            <div>
              <dt>{copy.houseRules}</dt>
              <dd>{profile.submittedSourceRevision.houseRules}</dd>
            </div>
          </dl>
        </section>
      ) : null}
    </section>
  );
}
