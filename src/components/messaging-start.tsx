"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { messagingMessages } from "@/i18n/messaging-messages";
import type { Locale } from "@/i18n/routing";
import { startMessagingConversation } from "@/messaging/actions";
import { ActionButton, ActionFeedback } from "./interaction-controls";

export function MessagingStart({
  locale,
  publicSlug,
  contextQuery,
}: {
  readonly locale: Locale;
  readonly publicSlug: string;
  readonly contextQuery?: string;
}) {
  const copy = messagingMessages[locale];
  const router = useRouter();
  const [commandId, setCommandId] = useState(() => crypto.randomUUID());
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  return (
    <div>
      <p>{copy.newEnquiryHelp}</p>
      <ActionButton
        kind="primary"
        width="content"
        type="button"
        pending={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await startMessagingConversation({
              publicSlug,
              commandId,
            });
            if (result.status === "created") {
              router.push(
                `/${locale}/messages/${result.conversationId}${contextQuery ? `?${contextQuery}` : ""}`,
              );
            } else {
              setFailed(true);
              if (
                result.status === "invalid" ||
                result.status === "access-required"
              ) {
                setCommandId(crypto.randomUUID());
              }
            }
          })
        }
      >
        {copy.newEnquiry}
      </ActionButton>
      {failed ? (
        <ActionFeedback kind="error">{copy.unavailable}</ActionFeedback>
      ) : null}
    </div>
  );
}
