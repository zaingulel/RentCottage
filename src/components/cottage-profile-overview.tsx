"use client";

import Image from "next/image";
import { useActionState } from "react";

import {
  createCottageProfileDraftAction,
  type CottageProfileActionState,
} from "@/cottage-profile/actions";
import type { OwnerCottageFromPricesResult } from "@/cottage-discovery/supabase-cottage-discovery";
import type { CottageProfile } from "@/cottage-profile/cottage-profile";
import { formatCount, formatInteger, formatIqd } from "@/i18n/format";
import {
  cottageProfileCounts,
  cottageProfileMessages,
  cottageProfileDraftNextStepLabel,
  cottageProfileStatusLabel,
  cottageProfileStatusBadgeClass,
  ownerCottagesSummarySentence,
} from "@/i18n/cottage-profile-messages";
import type { Locale } from "@/i18n/routing";
import { ActionFocusTarget, ActionLink } from "./interaction-controls";

const idle: CottageProfileActionState = { status: "idle" };

export function CottageProfileOverview({
  locale,
  actor,
  profiles,
  canCreate = false,
  continuationHref,
  fromPrices,
  waitingRequestCount,
}: {
  locale: Locale;
  actor: "owner" | "administrator";
  profiles: CottageProfile[];
  canCreate?: boolean;
  continuationHref?: string;
  fromPrices?: OwnerCottageFromPricesResult;
  waitingRequestCount?: number;
}) {
  const copy = cottageProfileMessages[locale];
  const [createState, createAction] = useActionState(
    createCottageProfileDraftAction,
    idle,
  );
  const title = actor === "owner" ? copy.overviewTitle : copy.adminTitle;
  const counts = cottageProfileCounts(profiles);
  const tiles = [
    { count: counts.published, label: copy.published },
    { count: counts.drafts, label: copy.draftTile },
    ...(waitingRequestCount === undefined
      ? []
      : [{ count: waitingRequestCount, label: copy.waitingTile }]),
  ];
  const route = actor === "owner" ? "owner" : "administrator";

  return (
    <section className="cottage-profile-overview">
      <header className="page-heading">
        <div className="cottage-profile-overview-heading-copy">
          <h1
            id="cottage-profile-overview-title"
            tabIndex={-1}
            className="page-title action-focus-target"
          >
            {title}
          </h1>
          <ActionFocusTarget
            targetId="cottage-profile-overview-title"
            navigation
          />
          {actor === "administrator" ? <p>{copy.adminIntro}</p> : null}
          {actor === "owner" && profiles.length > 0 ? (
            <p>{ownerCottagesSummarySentence(locale, counts)}</p>
          ) : null}
        </div>
        {actor === "owner" && canCreate ? (
          <form action={createAction} className="cottage-profile-create-form">
            <input type="hidden" name="locale" value={locale} />
            <button type="submit">
              <span aria-hidden="true">+</span> {copy.create}
            </button>
            {createState.status === "unavailable" ? (
              <p role="alert">{copy.failed}</p>
            ) : null}
            {createState.status === "denied" ? (
              <p role="alert">{copy.createDenied}</p>
            ) : null}
            {createState.status === "capacity_limit" ? (
              <p role="alert">{copy.capacityLimit}</p>
            ) : null}
            {createState.status === "rate_limit" ? (
              <p role="alert">{copy.rateLimit}</p>
            ) : null}
          </form>
        ) : null}
      </header>
      {actor === "owner" && profiles.length > 0 ? (
        <ul className="summary-tiles">
          {tiles.map(({ count, label }) => (
            <li className="summary-tile" key={label}>
              <strong>{formatInteger(count, locale)}</strong>{" "}
              <span>{label}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {profiles.length === 0 ? (
        actor === "owner" ? (
          <div className="empty-state">
            <p>{copy.emptyOwner}</p>
          </div>
        ) : (
          <p>{copy.empty}</p>
        )
      ) : null}
      <div className="cottage-profile-card-grid">
        {profiles.map((profile) => {
          const name = profile.name || copy.editorTitle;
          const isOwnerDraft =
            actor === "owner" &&
            profile.status === "draft" &&
            profile.currentPublicationId === null;
          const progress =
            profile.draftProgress?.status === "loaded"
              ? profile.draftProgress
              : null;
          const draftNextStep = !progress
            ? copy.draftProgressCheck
            : !progress.submissionAllowed
              ? copy.draftProgressReadOnly
              : progress.nextRequirement === null
                ? copy.draftReadyToSubmit
                : cottageProfileDraftNextStepLabel(
                    locale,
                    progress.nextRequirement,
                  );
          const actionLabel =
            isOwnerDraft && progress?.submissionAllowed
              ? progress.nextRequirement === null
                ? copy.reviewAndSubmit
                : copy.continueSetup
              : actor === "owner" &&
                  canCreate &&
                  profile.status === "draft" &&
                  profile.currentPublicationId !== null
                ? copy.edit
                : copy.open;
          const cover = profile.photos.find((photo) => photo.state === "ready");
          const price =
            fromPrices?.status === "loaded"
              ? fromPrices.fromPrices[profile.id]
              : undefined;
          const priceText =
            price !== undefined
              ? copy.fromPrice.replace("{price}", formatIqd(price, locale))
              : fromPrices?.status === "unavailable" &&
                  profile.currentPublicationId !== null
                ? copy.fromPriceUnavailable
                : undefined;
          return (
            <article className="card cottage-profile-card" key={profile.id}>
              <div
                className={
                  cover
                    ? "cottage-profile-card-cover"
                    : "cottage-profile-card-cover cottage-profile-card-cover-empty"
                }
              >
                <div className="cottage-profile-card-badges">
                  <span className={cottageProfileStatusBadgeClass(profile)}>
                    {cottageProfileStatusLabel(locale, profile)}
                  </span>
                  {profile.applicationId ? (
                    <span className="status-badge">
                      {copy.applicationProfile}
                    </span>
                  ) : null}
                </div>
                {cover ? (
                  <Image
                    src={`/api/cottage-profile-photos/${cover.id}`}
                    alt={copy.coverPhotoAlt.replace("{name}", () => name)}
                    fill
                    sizes="(min-width: 40rem) 22rem, 100vw"
                  />
                ) : (
                  <p className="cottage-profile-card-no-photo">
                    {copy.noPhotos}
                  </p>
                )}
              </div>
              <h2 className="card-title">{name}</h2>
              <p className="card-detail">
                {isOwnerDraft
                  ? progress
                    ? copy.draftProgressCount
                        .replace(
                          "{completed}",
                          formatInteger(progress.completed, locale),
                        )
                        .replace("{total}", formatInteger(13, locale))
                    : copy.draftProgressUnavailable
                  : [profile.governorate, profile.approximateLocation]
                      .filter(Boolean)
                      .join(" · ") || copy.completion}
              </p>
              <div className="cottage-profile-card-supporting">
                <div className="cottage-profile-card-facts">
                  {profile.capacity !== null ? (
                    <span>
                      {formatCount(profile.capacity, locale, copy.guestCount)}
                    </span>
                  ) : null}
                  {profile.bedrooms !== null ? (
                    <span>
                      {formatCount(profile.bedrooms, locale, copy.bedroomCount)}
                    </span>
                  ) : null}
                  {!isOwnerDraft ? (
                    <span>
                      {formatInteger(
                        profile.photos.filter(
                          (photo) => photo.state === "ready",
                        ).length,
                        locale,
                      )}
                      /{formatInteger(12, locale)} {copy.photos}
                    </span>
                  ) : null}
                </div>
                {isOwnerDraft ? (
                  <div className="cottage-profile-draft-progress">
                    {progress ? (
                      <div
                        className="cottage-profile-draft-progress-track"
                        aria-hidden="true"
                      >
                        <span
                          style={{
                            inlineSize: `${(progress.completed / 13) * 100}%`,
                          }}
                        />
                      </div>
                    ) : null}
                    <p className="cottage-profile-draft-next-step">
                      {draftNextStep}
                    </p>
                  </div>
                ) : null}
              </div>
              <div className="cottage-profile-card-actions">
                <ActionLink
                  kind="text"
                  href={`/${locale}/${route}/cottages/${profile.id}`}
                >
                  {actionLabel}
                  <span
                    className="cottage-profile-card-arrow"
                    aria-hidden="true"
                  >
                    →
                  </span>
                </ActionLink>
                {priceText ? (
                  <p className="cottage-profile-card-price">{priceText}</p>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
      {actor === "administrator" && continuationHref ? (
        <div className="administrator-review-next">
          <ActionLink kind="secondary" href={continuationHref}>
            {copy.nextCottages}
          </ActionLink>
        </div>
      ) : null}
    </section>
  );
}
