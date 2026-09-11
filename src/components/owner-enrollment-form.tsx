"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { enrollOwner } from "@/access/actions";
import { accessMessages } from "@/i18n/access-messages";
import type { Locale } from "@/i18n/routing";
import { ActionButton, ActionFeedback } from "./interaction-controls";
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
  const { pending, run } = useExclusiveAction();
  const [message, setMessage] = useState("");
  async function enroll() {
    setMessage("");
    let result;
    try {
      result = await run(() => enrollOwner({ locale, returnTo }));
    } catch {
      setMessage(copy.sessionUnavailable);
      return;
    }
    if (!result) return;
    if (result.status === "enrolled") {
      router.replace(result.destination);
      router.refresh();
    } else
      setMessage(
        result.status === "unavailable" ? copy.sessionUnavailable : copy.denied,
      );
  }
  return (
    <section>
      <h1>{copy.enrollTitle}</h1>
      <p>{copy.enrollIntro}</p>
      <ActionButton
        kind="primary"
        width="content"
        type="button"
        pending={pending}
        onClick={enroll}
      >
        {copy.enroll}
      </ActionButton>
      {message && <ActionFeedback kind="error">{message}</ActionFeedback>}
    </section>
  );
}
