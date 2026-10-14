"use client";
import { useId, useState } from "react";
import { unstable_rethrow, useRouter } from "next/navigation";
import { enrollOwner } from "@/access/actions";
import { accessMessages } from "@/i18n/access-messages";
import type { Locale } from "@/i18n/routing";
import {
  ActionButton,
  ActionFeedback,
  prepareActionFocusNavigation,
} from "./interaction-controls";
import { useExclusiveAction } from "./use-exclusive-action";
export function OwnerEnrollmentForm({
  locale,
  returnTo,
}: {
  locale: Locale;
  returnTo: string;
}) {
  const copy = accessMessages[locale];
  const router = useRouter();
  const enrollButtonId = useId();
  const { pending, run } = useExclusiveAction();
  const [message, setMessage] = useState("");
  async function enroll() {
    setMessage("");
    let result;
    let abortNavigation: (() => void) | undefined;
    try {
      result = await run(() => {
        abortNavigation = prepareActionFocusNavigation(enrollButtonId);
        return enrollOwner({ locale, returnTo });
      });
    } catch (error) {
      unstable_rethrow(error);
      abortNavigation?.();
      setMessage(copy.sessionUnavailable);
      return;
    }
    if (!result) return;
    if (result.status === "enrolled") {
      router.replace(result.destination);
      router.refresh();
    } else {
      abortNavigation?.();
      setMessage(
        result.status === "unavailable" ? copy.sessionUnavailable : copy.denied,
      );
    }
  }
  return (
    <section>
      <h1>{copy.enrollTitle}</h1>
      <p>{copy.enrollIntro}</p>
      <ActionButton
        kind="primary"
        type="button"
        pending={pending}
        onClick={enroll}
        id={enrollButtonId}
      >
        {copy.enroll}
      </ActionButton>
      {message && <ActionFeedback kind="error">{message}</ActionFeedback>}
    </section>
  );
}
