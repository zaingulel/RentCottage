"use client";

import { useActionState, useState } from "react";

import {
  previewCottageProfilePhotoAction,
  setAdministratorCottageDescriptionVisibilityAction,
  setAdministratorCottagePhotoVisibilityAction,
  type CottageContentVisibilityActionState,
  type CottagePhotoPreviewState,
} from "@/cottage-profile/actions";
import type { CottageContentVisibility as Visibility } from "@/cottage-profile/cottage-profile";
import { cottageProfileMessages } from "@/i18n/cottage-profile-messages";
import type { Locale } from "@/i18n/routing";
import { ActionButton, ActionFeedback } from "./interaction-controls";
import { AdministratorReason } from "./cottage-profile-editor";

const idle: CottageContentVisibilityActionState = { status: "idle" };
const idlePreview: CottagePhotoPreviewState = { status: "idle" };

function PrivatePreview({
  locale,
  photoId,
}: {
  locale: Locale;
  photoId: string;
}) {
  const [state, submit, pending] = useActionState(
    previewCottageProfilePhotoAction,
    idlePreview,
  );
  const copy = cottageProfileMessages[locale];
  return (
    <>
      <form action={submit}>
        <input type="hidden" name="photoId" value={photoId} />
        <button
          type="submit"
          className="cottage-photo-text-action"
          disabled={pending}
        >
          {copy.preview}
        </button>
      </form>
      {state.status === "ready" ? (
        <a
          className="cottage-photo-text-action"
          href={state.url}
          target="_blank"
          rel="noreferrer"
        >
          {copy.preview}
        </a>
      ) : null}
      {state.status === "denied" || state.status === "unavailable" ? (
        <ActionFeedback kind="error">
          {state.status === "denied"
            ? copy.previewDenied
            : copy.previewUnavailable}
        </ActionFeedback>
      ) : null}
    </>
  );
}

export function CottageContentVisibility({
  locale,
  result,
}: {
  locale: Locale;
  result:
    | { status: "loaded"; visibility: Visibility }
    | { status: "unavailable" | "invalid" };
}) {
  const copy = cottageProfileMessages[locale];
  const [target, setTarget] = useState<string | null>(null);
  const [state, submit, pending] = useActionState(
    async (previous: CottageContentVisibilityActionState, form: FormData) => {
      const next = await (form.has("photoId")
        ? setAdministratorCottagePhotoVisibilityAction(previous, form)
        : setAdministratorCottageDescriptionVisibilityAction(previous, form));
      return { ...next, visibility: next.visibility ?? previous.visibility };
    },
    idle,
  );
  const feedbackId = "cottage-content-visibility-feedback";
  if (result.status !== "loaded")
    return (
      <section
        className="cottage-profile-editor"
        aria-labelledby="cottage-content-visibility-title"
      >
        <h2 id="cottage-content-visibility-title" className="section-title">
          {copy.visibilityTitle}
        </h2>
        <ActionFeedback kind="error">
          {copy.visibilityUnavailable}
        </ActionFeedback>
      </section>
    );
  const visibility =
    state.visibility?.publicationId === result.visibility.publicationId
      ? state.visibility
      : result.visibility;
  const rows = [
    {
      id: "description",
      title: copy.visibilityDescription,
      hidden: visibility.descriptionHidden,
      photoId: undefined,
    },
    ...visibility.photos.map((photo) => ({
      id: photo.photoId,
      title: photo.originalFilename,
      hidden: photo.hidden,
      photoId: photo.photoId,
    })),
  ];
  const feedback =
    state.status === "saved"
      ? copy.visibilitySaved
      : state.status === "denied"
        ? copy.visibilityDenied
        : state.status === "conflict"
          ? copy.visibilityConflict
          : state.status === "last_photo"
            ? copy.visibilityLastPhoto
            : state.status === "invalid"
              ? state.fields?.includes("reason")
                ? copy.reasonInvalid
                : copy.visibilityInvalid
              : copy.visibilityUnavailable;
  return (
    <section
      className="cottage-profile-editor"
      aria-labelledby="cottage-content-visibility-title"
    >
      <h2 id="cottage-content-visibility-title" className="section-title">
        {copy.visibilityTitle}
      </h2>
      <div className="cottage-profile-form">
        {rows.map((row) => (
          <fieldset
            key={row.id}
            aria-labelledby={`visibility-${row.id}-title`}
            disabled={pending}
          >
            <div className="cottage-profile-section-heading">
              <h3 id={`visibility-${row.id}-title`} className="section-title">
                <strong>{row.title}</strong>
              </h3>
              {row.id === "description" ? (
                <p>{copy.visibilityGuidance}</p>
              ) : null}
            </div>
            <div className="cottage-profile-field-card card">
              <p>
                {row.hidden ? copy.visibilityHidden : copy.visibilityVisible}
              </p>
              {row.photoId ? (
                <PrivatePreview locale={locale} photoId={row.photoId} />
              ) : null}
              <form
                action={submit}
                className="cottage-profile-form"
                onSubmit={() => setTarget(row.id)}
              >
                <input type="hidden" name="locale" value={locale} />
                <input
                  type="hidden"
                  name="profileId"
                  value={visibility.profileId}
                />
                <input
                  type="hidden"
                  name="publicationId"
                  value={visibility.publicationId}
                />
                <input
                  type="hidden"
                  name="hidden"
                  value={String(!row.hidden)}
                />
                {row.photoId ? (
                  <input type="hidden" name="photoId" value={row.photoId} />
                ) : null}
                <AdministratorReason
                  locale={locale}
                  state={target === row.id ? state : idle}
                  describedBy={
                    target === row.id && state.status !== "idle"
                      ? feedbackId
                      : undefined
                  }
                />
                <ActionButton
                  kind="secondary"
                  size="regular"
                  type="submit"
                  pending={pending}
                  focusSuccessorId={feedbackId}
                >
                  {row.hidden ? copy.visibilityRestore : copy.visibilityHide}
                </ActionButton>
              </form>
            </div>
          </fieldset>
        ))}
      </div>
      {state.status !== "idle" ? (
        <ActionFeedback
          kind={state.status === "saved" ? "success" : "error"}
          focusTargetId={feedbackId}
        >
          {feedback}
        </ActionFeedback>
      ) : null}
    </section>
  );
}
