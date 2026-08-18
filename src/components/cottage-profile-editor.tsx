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
import { cottageProfileMessages } from "@/i18n/cottage-profile-messages";
import type { Locale } from "@/i18n/routing";

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
          <button type="submit">{copy.preview}</button>
        </form>
      ) : null}
      {preview.status === "ready" ? (
        <a href={preview.url} target="_blank" rel="noreferrer">
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
          <button type="submit">{copy.deletePhoto}</button>
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
      <div className="application-section-heading">
        <span>01</span>
        <div>
          <h1>{copy.editorTitle}</h1>
          <p>{copy.completion}</p>
        </div>
      </div>
      <p className={`cottage-profile-status ${profile.status}`}>
        {profile.status === "draft" ? copy.draft : copy.submitted}
      </p>
      {!editable && profile.status === "draft" ? (
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
          <h2
            className="cottage-profile-section-title"
            id="cottage-profile-public-details-heading"
          >
            {copy.publicDetails}
          </h2>
          <label>
            {copy.cottageName}
            <input name="name" defaultValue={profile.name} />
          </label>
          <label>
            {copy.governorate}
            <input name="governorate" defaultValue={profile.governorate} />
          </label>
          <label>
            {copy.approximateLocation}
            <input
              name="approximateLocation"
              defaultValue={profile.approximateLocation}
            />
          </label>
          <div className="cottage-profile-number-grid">
            <label>
              {copy.capacity}
              <input
                name="capacity"
                type="number"
                min="1"
                max="100"
                defaultValue={profile.capacity ?? ""}
              />
            </label>
            <label>
              {copy.bedrooms}
              <input
                name="bedrooms"
                type="number"
                min="1"
                max="50"
                defaultValue={profile.bedrooms ?? ""}
              />
            </label>
            <label>
              {copy.bathrooms}
              <input
                name="bathrooms"
                type="number"
                min="1"
                max="50"
                defaultValue={profile.bathrooms ?? ""}
              />
            </label>
          </div>
          <fieldset className="amenity-grid">
            <legend>{copy.amenities}</legend>
            {cottageProfileAmenities.map((amenity) => (
              <label key={amenity}>
                <input
                  type="checkbox"
                  name="amenities"
                  value={amenity}
                  defaultChecked={profile.amenities.includes(amenity)}
                />
                {copy[amenity]}
              </label>
            ))}
          </fieldset>
        </fieldset>

        <fieldset
          aria-labelledby="cottage-profile-private-location-heading"
          disabled={!editable}
        >
          <h2
            className="cottage-profile-section-title"
            id="cottage-profile-private-location-heading"
          >
            {copy.privateLocation}
          </h2>
          <p className="private-location-warning">{copy.privateWarning}</p>
          <label>
            {copy.exactAddress}
            <input name="exactAddress" defaultValue={profile.exactAddress} />
          </label>
          <div className="cottage-profile-coordinate-grid">
            <label>
              {copy.latitude}
              <input
                name="exactLatitude"
                type="number"
                min="-90"
                max="90"
                step="0.000001"
                defaultValue={profile.exactLatitude ?? ""}
              />
            </label>
            <label>
              {copy.longitude}
              <input
                name="exactLongitude"
                type="number"
                min="-180"
                max="180"
                step="0.000001"
                defaultValue={profile.exactLongitude ?? ""}
              />
            </label>
          </div>
          <label>
            {copy.privateDirections}
            <textarea
              name="privateDirections"
              defaultValue={profile.privateDirections}
            />
          </label>
        </fieldset>

        <fieldset
          aria-labelledby="cottage-profile-source-content-heading"
          disabled={!editable || !sourceEditable}
        >
          <h2
            className="cottage-profile-section-title"
            id="cottage-profile-source-content-heading"
          >
            {copy.sourceContent}
          </h2>
          <label>
            {copy.sourceLanguage}
            <select
              name="sourceLanguage"
              defaultValue={profile.sourceLanguage ?? ""}
            >
              <option value="">—</option>
              <option value="ar">{copy.arabic}</option>
              <option value="ckb">{copy.sorani}</option>
              <option value="en">{copy.english}</option>
            </select>
          </label>
          <label>
            {copy.description}
            <textarea name="description" defaultValue={profile.description} />
          </label>
          <label>
            {copy.houseRules}
            <textarea name="houseRules" defaultValue={profile.houseRules} />
          </label>
        </fieldset>
        {editable ? <button type="submit">{copy.save}</button> : null}
        <Feedback state={saveState} locale={locale} />
      </form>

      <section className="cottage-profile-photos">
        <h2>{copy.photos}</h2>
        <p>{copy.photoGuidance}</p>
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
              <input
                type="file"
                name="photo"
                accept="image/jpeg,image/png,image/webp"
              />
            </label>
            <button type="submit">{copy.uploadPhoto}</button>
          </form>
        ) : null}
        <Feedback state={uploadState} locale={locale} />
      </section>

      {ownerCanSubmit ? (
        <form action={submitProfile} className="cottage-profile-submit-form">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="profileId" value={profile.id} />
          <input type="hidden" name="expectedVersion" value={profile.version} />
          <button type="submit">{copy.submit}</button>
          <Feedback state={submitState} locale={locale} />
        </form>
      ) : null}

      {profile.submittedSourceRevision ? (
        <section className="cottage-profile-source-revision">
          <h2>{copy.sourceRevision}</h2>
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
