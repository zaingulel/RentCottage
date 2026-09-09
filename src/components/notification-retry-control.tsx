"use client";

import { useActionState } from "react";

import {
  retryPaidConfirmationNotification,
  type RetryPaidConfirmationNotificationState,
} from "@/notification/notification-actions";
import { ActionButton, ActionFeedback } from "./interaction-controls";

const idle: RetryPaidConfirmationNotificationState = { status: "idle" };

export function NotificationRetryControl({
  locale,
  reference,
  receiptId,
  label,
  failed,
  queued,
}: {
  locale: string;
  reference: string;
  receiptId: string;
  label: string;
  failed: string;
  queued: string;
}) {
  const [state, action, pending] = useActionState(
    retryPaidConfirmationNotification,
    idle,
  );
  return (
    <form action={action}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="reference" value={reference} />
      <input type="hidden" name="receiptId" value={receiptId} />
      <ActionButton
        type="submit"
        kind="primary"
        width="content"
        pending={pending}
      >
        {label}
      </ActionButton>
      {state.status === "failed" ||
      state.status === "invalid" ||
      state.status === "unavailable" ? (
        <ActionFeedback kind="error">{failed}</ActionFeedback>
      ) : state.status === "queued" ? (
        <ActionFeedback kind="success">{queued}</ActionFeedback>
      ) : null}
    </form>
  );
}
