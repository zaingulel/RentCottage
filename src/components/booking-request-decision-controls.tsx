"use client";

import { useId, useState } from "react";

import { actOnBookingRequest } from "@/booking-request/lifecycle-actions";
import type { BookingRequestStatus } from "@/booking-request/booking-request-status";
import type { Locale } from "@/i18n/routing";

import {
  ActionButton,
  ActionFeedback,
  FormControl,
} from "./interaction-controls";

const messages = {
  en: {
    accept: "Accept complete request",
    acceptShort: "Accept",
    decline: "Decline complete request",
    declineShort: "Decline",
    reason: "Decline reason",
    choose: "Choose a reason",
    unavailable: "Cottage is unavailable",
    cannot: "Cannot accommodate this request",
    other: "Other",
    note: "Optional note to the Customer",
    hint: "Up to 500 characters. Do not include contact details.",
    failed: "The request could not be updated safely. Try again.",
  },
  ar: {
    accept: "قبول الطلب كاملاً",
    acceptShort: "قبول",
    decline: "رفض الطلب كاملاً",
    declineShort: "رفض",
    reason: "سبب الرفض",
    choose: "اختر سبباً",
    unavailable: "البيت غير متاح",
    cannot: "لا يمكن تلبية هذا الطلب",
    other: "سبب آخر",
    note: "ملاحظة اختيارية للعميل",
    hint: "حتى 500 حرف. لا تكتب بيانات اتصال.",
    failed: "تعذر تحديث الطلب بأمان. حاول مرة أخرى.",
  },
  ckb: {
    accept: "قبوڵکردنی تەواوی داواکاری",
    acceptShort: "قبوڵکردن",
    decline: "ڕەتکردنەوەی تەواوی داواکاری",
    declineShort: "ڕەتکردنەوە",
    reason: "هۆکاری ڕەتکردنەوە",
    choose: "هۆکارێک هەڵبژێرە",
    unavailable: "کۆتێج بەردەست نییە",
    cannot: "ناتوانرێت ئەم داواکارییە جێبەجێ بکرێت",
    other: "هۆکارێکی تر",
    note: "تێبینی ئارەزوومەندانە بۆ کڕیار",
    hint: "تا ٥٠٠ پیت. زانیاری پەیوەندی مەنووسە.",
    failed: "داواکارییەکە بە سەلامەتی نوێ نەکرایەوە. دووبارە هەوڵ بدە.",
  },
} as const;

type DecisionCopy = (typeof messages)[Locale];

function useBookingRequestDecision({
  locale,
  bookingRequestId,
  onStatusChange,
}: {
  locale: Locale;
  bookingRequestId: string;
  onStatusChange?: (status: BookingRequestStatus) => void;
}) {
  const [status, setStatus] = useState<BookingRequestStatus>("pending");
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);

  async function act(action: "accept" | "decline", form?: HTMLFormElement) {
    setPending(true);
    setError(false);
    if (action === "decline") {
      setStatus("processing");
      onStatusChange?.("processing");
    }
    const data = form ? new FormData(form) : undefined;
    try {
      const result = await actOnBookingRequest({
        locale,
        bookingRequestId,
        action,
        declineReason: data?.get("declineReason"),
        declineNote: data?.get("declineNote"),
      });
      if (
        result.status === "invalid" ||
        result.status === "access-required" ||
        result.status === "unavailable"
      ) {
        setStatus("pending");
        onStatusChange?.("pending");
        setError(true);
      } else {
        setStatus(result.status);
        onStatusChange?.(result.status);
      }
    } catch {
      setStatus("pending");
      onStatusChange?.("pending");
      setError(true);
    } finally {
      setPending(false);
    }
  }

  return { status, error, pending, act };
}

function DeclineFields({ copy }: { copy: DecisionCopy }) {
  return (
    <>
      <label>
        <span>{copy.reason}</span>
        <FormControl
          kind="select"
          name="declineReason"
          required
          defaultValue=""
        >
          <option value="" disabled>
            {copy.choose}
          </option>
          <option value="cottage_unavailable">{copy.unavailable}</option>
          <option value="cannot_accommodate_request">{copy.cannot}</option>
          <option value="other">{copy.other}</option>
        </FormControl>
      </label>
      <label>
        <span>{copy.note}</span>
        <FormControl
          kind="textarea"
          name="declineNote"
          maxLength={500}
          rows={3}
        />
        <small>{copy.hint}</small>
      </label>
    </>
  );
}

export function BookingRequestDecisionControls({
  locale,
  bookingRequestId,
  onStatusChange,
  focusSuccessorId,
}: {
  locale: Locale;
  bookingRequestId: string;
  focusSuccessorId?: string;
  onStatusChange?: (status: BookingRequestStatus) => void;
}) {
  const copy = messages[locale];
  const { status, error, pending, act } = useBookingRequestDecision({
    locale,
    bookingRequestId,
    onStatusChange,
  });

  if (status !== "pending") return null;
  return (
    <div className="booking-request-decision-controls">
      <ActionButton
        kind="primary"
        width="full"
        type="button"
        pending={pending}
        focusSuccessorId={focusSuccessorId}
        onClick={() => act("accept")}
      >
        {copy.accept}
      </ActionButton>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void act("decline", event.currentTarget);
        }}
      >
        <DeclineFields copy={copy} />
        <ActionButton
          kind="secondary"
          size="regular"
          width="full"
          type="submit"
          pending={pending}
          focusSuccessorId={focusSuccessorId}
        >
          {copy.decline}
        </ActionButton>
      </form>
      {error ? (
        <ActionFeedback kind="error">{copy.failed}</ActionFeedback>
      ) : null}
    </div>
  );
}

export function BookingRequestRowDecisionControls({
  locale,
  bookingRequestId,
  focusSuccessorId,
  onStatusChange,
}: {
  locale: Locale;
  bookingRequestId: string;
  focusSuccessorId?: string;
  onStatusChange?: (status: BookingRequestStatus) => void;
}) {
  const copy = messages[locale];
  const { status, error, pending, act } = useBookingRequestDecision({
    locale,
    bookingRequestId,
    onStatusChange,
  });
  const [declineOpen, setDeclineOpen] = useState(false);
  const declineFormId = useId();

  if (status !== "pending") return null;
  return (
    <>
      <div className="request-row-actions">
        <ActionButton
          kind="secondary"
          size="regular"
          type="button"
          aria-expanded={declineOpen}
          aria-controls={declineOpen ? declineFormId : undefined}
          onClick={() => setDeclineOpen((open) => !open)}
        >
          {copy.declineShort}
        </ActionButton>
        <ActionButton
          kind="primary"
          type="button"
          aria-label={copy.accept}
          pending={pending}
          focusSuccessorId={focusSuccessorId}
          onClick={() => act("accept")}
        >
          {copy.acceptShort}
        </ActionButton>
      </div>
      {declineOpen || error ? (
        <div className="request-row-below">
          {declineOpen ? (
            <form
              id={declineFormId}
              onSubmit={(event) => {
                event.preventDefault();
                void act("decline", event.currentTarget);
              }}
            >
              <DeclineFields copy={copy} />
              <ActionButton
                kind="secondary"
                size="regular"
                type="submit"
                pending={pending}
                focusSuccessorId={focusSuccessorId}
              >
                {copy.decline}
              </ActionButton>
            </form>
          ) : null}
          {error ? (
            <ActionFeedback kind="error">{copy.failed}</ActionFeedback>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
