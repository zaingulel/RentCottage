"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { messagingMessages } from "@/i18n/messaging-messages";
import type { Locale } from "@/i18n/routing";
import { openBookingMessagingConversation } from "@/messaging/actions";

import {
  ActionButton,
  prepareActionFocusNavigation,
} from "./interaction-controls";

export function MessagingBookingLink({
  locale,
  reference,
}: {
  readonly locale: Locale;
  readonly reference: string;
}) {
  const copy = messagingMessages[locale];
  const router = useRouter();
  const [commandId] = useState(() => crypto.randomUUID());
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  return (
    <section className="request-follow-up" aria-label={copy.inbox}>
      <h2 className="section-title">{copy.inbox}</h2>
      <ActionButton
        id="messaging-open-conversation"
        kind="secondary"
        size="regular"
        width="content"
        type="button"
        pending={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await openBookingMessagingConversation({
              bookingRequestReference: reference,
              commandId,
            });
            if (result.status === "created") {
              prepareActionFocusNavigation("messaging-open-conversation");
              router.push(`/${locale}/messages/${result.conversationId}`);
            } else setFailed(true);
          })
        }
      >
        {copy.open}
      </ActionButton>
      {failed ? <p role="status">{copy.unavailable}</p> : null}
    </section>
  );
}
