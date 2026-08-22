"use client";

import { useActionState } from "react";

import {
  abandonAdministratorCottageProfileAction,
  abandonOwnerCottageProfileAction,
  restoreAdministratorCottageProfileAction,
  type CottageProfileActionState,
} from "@/cottage-profile/actions";
import type { CottageProfile } from "@/cottage-profile/cottage-profile";
import { cottageProfileMessages } from "@/i18n/cottage-profile-messages";
import type { Locale } from "@/i18n/routing";

const idle: CottageProfileActionState = { status: "idle" };

export function CottageProfileLifecycleControls({
  locale,
  actor,
  profile,
  eligible,
}: {
  locale: Locale;
  actor: "owner" | "administrator";
  profile: CottageProfile;
  eligible: boolean;
}) {
  const additionalUnpublished =
    profile.applicationId === null && profile.currentPublicationId === null;
  const operation = profile.status === "abandoned" ? "restore" : "abandon";
  const available =
    eligible &&
    additionalUnpublished &&
    (actor === "administrator"
      ? profile.status === "draft" || profile.status === "abandoned"
      : profile.status === "draft");
  const action =
    actor === "owner"
      ? abandonOwnerCottageProfileAction
      : operation === "restore"
        ? restoreAdministratorCottageProfileAction
        : abandonAdministratorCottageProfileAction;
  const [state, submit] = useActionState(action, idle);

  if (!available) return null;
  const copy = cottageProfileMessages[locale];
  return (
    <form
      action={submit}
      className="cottage-profile-editor cottage-profile-form"
    >
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="profileId" value={profile.id} />
      <input type="hidden" name="expectedVersion" value={profile.version} />
      <fieldset>
        {actor === "administrator" ? (
          <label>
            {copy.lifecycleReason}
            <textarea name="reason" required maxLength={1000} />
          </label>
        ) : null}
        <button type="submit">
          {operation === "restore" ? copy.restore : copy.abandon}
        </button>
        {state.status !== "idle" ? (
          <p
            role={
              state.status === "abandoned" || state.status === "restored"
                ? "status"
                : "alert"
            }
          >
            {state.status === "abandoned"
              ? copy.abandonedSuccess
              : state.status === "restored"
                ? copy.restoredSuccess
                : state.status === "capacity_limit"
                  ? copy.capacityLimit
                  : copy.failed}
          </p>
        ) : null}
      </fieldset>
    </form>
  );
}
