"use client";

import { useActionState } from "react";

import {
  retryPaidConfirmationNotification,
  type RetryPaidConfirmationNotificationState,
} from "@/notification/notification-actions";
import {
  ActionButton,
  ActionFeedback,
  ActionFocusTarget,
} from "./interaction-controls";

const idle: RetryPaidConfirmationNotificationState = { status: "idle" };

export function NotificationRetryControl({
  locale,
  reference,
  receiptId,
  eventId,
  label,
  failed,
  queued,
  focusSuccessorId,
}: {
  locale: string;
  reference: string;
  receiptId: string | null;
  eventId?: string;
  label: string;
  failed: string;
  queued: string;
  focusSuccessorId?: string;
}) {
  const [state, action, pending] = useActionState(
    retryPaidConfirmationNotification,
    idle,
  );
  return (
    <form action={action}>
      {!pending && focusSuccessorId ? (
        <ActionFocusTarget targetId={focusSuccessorId} />
      ) : null}
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="reference" value={reference} />
      {receiptId ? (
        <input type="hidden" name="receiptId" value={receiptId} />
      ) : null}
      {eventId ? <input type="hidden" name="eventId" value={eventId} /> : null}
      <ActionButton
        type="submit"
        kind="primary"
        pending={pending}
        focusSuccessorId={focusSuccessorId}
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
