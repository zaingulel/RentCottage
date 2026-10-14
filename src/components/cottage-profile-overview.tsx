"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  createCottageProfileDraftAction,
  type CottageProfileActionState,
} from "@/cottage-profile/actions";
import type { CottageProfile } from "@/cottage-profile/cottage-profile";
import {
  cottageProfileMessages,
  cottageProfileStatusLabel,
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
}: {
  locale: Locale;
  actor: "owner" | "administrator";
  profiles: CottageProfile[];
  canCreate?: boolean;
  continuationHref?: string;
}) {
  const copy = cottageProfileMessages[locale];
  const [createState, createAction] = useActionState(
    createCottageProfileDraftAction,
    idle,
  );
  const title = actor === "owner" ? copy.overviewTitle : copy.adminTitle;
  const intro = actor === "owner" ? copy.overviewIntro : copy.adminIntro;
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
        <p>{intro}</p>
      </header>
      {profiles.length === 0 ? <p>{copy.empty}</p> : null}
      <div className="cottage-profile-card-grid">
        {profiles.map((profile) => (
          <article className="card cottage-profile-card" key={profile.id}>
            <div>
              <span className="status-badge">
                {cottageProfileStatusLabel(locale, profile)}
              </span>
              {profile.applicationId ? (
                <span className="status-badge">{copy.applicationProfile}</span>
              ) : null}
            </div>
            <h2 className="card-title">{profile.name || copy.editorTitle}</h2>
            <p className="card-detail">
              {[profile.governorate, profile.approximateLocation]
                .filter(Boolean)
                .join(" · ") || copy.completion}
            </p>
            <p className="card-small-print">
              {profile.photos.filter((photo) => photo.state === "ready").length}
              /12 {copy.photos}
            </p>
            <ActionLink
              kind="primary"
              width="full"
              href={`/${locale}/${route}/cottages/${profile.id}`}
            >
              {copy.open}
            </ActionLink>
          </article>
        ))}
      </div>
      {actor === "administrator" && continuationHref ? (
        <Link href={continuationHref}>{copy.nextCottages}</Link>
      ) : null}
      {actor === "owner" && canCreate ? (
        <form action={createAction} className="cottage-profile-create-form">
          <input type="hidden" name="locale" value={locale} />
          <button type="submit">{copy.create}</button>
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
