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
      <div className="application-section-heading">
        <span>01</span>
        <div>
          <h1>{title}</h1>
          <p>{intro}</p>
        </div>
      </div>
      {profiles.length === 0 ? <p>{copy.empty}</p> : null}
      <div className="cottage-profile-card-grid">
        {profiles.map((profile) => (
          <article className="cottage-profile-card" key={profile.id}>
            <div>
              <span>{cottageProfileStatusLabel(locale, profile.status)}</span>
              {profile.applicationId ? (
                <span>{copy.applicationProfile}</span>
              ) : null}
            </div>
            <h2>{profile.name || copy.editorTitle}</h2>
            <p>
              {[profile.governorate, profile.approximateLocation]
                .filter(Boolean)
                .join(" · ") || copy.completion}
            </p>
            <p>
              {profile.photos.filter((photo) => photo.state === "ready").length}
              /12 {copy.photos}
            </p>
            <Link href={`/${locale}/${route}/cottages/${profile.id}`}>
              {copy.open}
            </Link>
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
