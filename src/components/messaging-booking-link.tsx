"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { messagingMessages } from "@/i18n/messaging-messages";
import type { Locale } from "@/i18n/routing";
import { openBookingMessagingConversation } from "@/messaging/actions";

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
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await openBookingMessagingConversation({
              bookingRequestReference: reference,
              commandId,
            });
            if (result.status === "created")
              router.push(`/${locale}/messages/${result.conversationId}`);
            else setFailed(true);
          })
        }
      >
        {copy.open}
      </button>
      {failed ? <p role="status">{copy.unavailable}</p> : null}
    </div>
  );
}
