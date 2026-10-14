"use client";

import Image from "next/image";
import Link from "next/link";
import { useActionState } from "react";

import {
  createCottageProfileDraftAction,
  type CottageProfileActionState,
} from "@/cottage-profile/actions";
import type { OwnerCottageFromPricesResult } from "@/cottage-discovery/supabase-cottage-discovery";
import type { CottageProfile } from "@/cottage-profile/cottage-profile";
import { formatInteger, formatIqd } from "@/i18n/format";
import {
  cottageProfileCounts,
  cottageProfileMessages,
  cottageProfileStatusLabel,
  cottageProfileStatusTone,
  ownerCottagesSummarySentence,
} from "@/i18n/cottage-profile-messages";
import type { Locale } from "@/i18n/routing";
import { ActionFocusTarget, ActionLink } from "./interaction-controls";

const idle: CottageProfileActionState = { status: "idle" };

function statusBadgeClass(profile: CottageProfile) {
  const tone = cottageProfileStatusTone(profile);
  return tone ? `status-badge status-badge-${tone}` : "status-badge";
}

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
                  <span className={statusBadgeClass(profile)}>
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
                {[profile.governorate, profile.approximateLocation]
                  .filter(Boolean)
                  .join(" · ") || copy.completion}
              </p>
              <p className="card-small-print">
                {
                  profile.photos.filter((photo) => photo.state === "ready")
                    .length
                }
                /12 {copy.photos}
              </p>
              <div className="cottage-profile-card-actions">
                <ActionLink
                  kind="primary"
                  href={`/${locale}/${route}/cottages/${profile.id}`}
                >
                  {copy.open}
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
        <Link href={continuationHref}>{copy.nextCottages}</Link>
      ) : null}
      {actor === "owner" && canCreate ? (
        <form action={createAction} className="cottage-profile-create-form">
          <input type="hidden" name="locale" value={locale} />
          <button type="submit">
            {profiles.length === 0 ? copy.createFirst : copy.create}
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
    </section>
  );
}
