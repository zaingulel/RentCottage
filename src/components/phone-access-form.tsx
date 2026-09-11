"use client";

import { useState } from "react";

import {
  completePhoneAccess,
  requestPhoneAccess,
  verifyPhoneAccess,
} from "@/access/actions";
import { accessMessages } from "@/i18n/access-messages";
import type { Locale } from "@/i18n/routing";

import {
  ActionButton,
  ActionFeedback,
  FormControl,
} from "./interaction-controls";
import { useExclusiveAction } from "./use-exclusive-action";

export function PhoneAccessForm({
  locale,
  returnTo,
  onVerified,
}: {
  locale: Locale;
  returnTo?: string;
  onVerified?: () => void;
}) {
  const copy = accessMessages[locale];
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"phone" | "code" | "verified">("phone");
  const [message, setMessage] = useState("");
  const { pending, run } = useExclusiveAction();

  async function sendCode() {
    setMessage("");
    let result;
    try {
      result = await run(() => requestPhoneAccess(phone));
    } catch {
      setMessage(copy.unavailable);
      return;
    }
    if (!result) return;
    if (result.status === "code_sent") setStage("code");
    else
      setMessage(
        result.status === "invalid_phone"
          ? copy.invalidPhone
          : result.status === "rate_limited"
            ? copy.rateLimited
            : copy.unavailable,
      );
  }

  async function verifyCode() {
    setMessage("");
    let result;
    try {
      result = await run(() => verifyPhoneAccess({ phone, code }));
    } catch {
      setMessage(copy.unavailable);
      return;
    }
    if (!result) return;
    if (result.status === "authenticated") {
      setStage("verified");
      setMessage(copy.verified);
      if (returnTo) {
        try {
          const destination = await completePhoneAccess(locale, returnTo);
          if (destination?.status === "unavailable") {
            setStage("code");
            setMessage(copy.unavailable);
          }
        } catch {
          setStage("code");
          setMessage(copy.unavailable);
        }
      }
      onVerified?.();
    } else {
      setMessage(
        result.status === "role_conflict"
          ? copy.denied
          : result.status === "unavailable"
            ? copy.unavailable
            : result.status === "expired_code"
              ? copy.expiredCode
              : result.status === "rate_limited"
                ? copy.rateLimited
                : result.status === "invalid_code"
                  ? copy.invalidCode
                  : copy.unavailable,
      );
    }
  }

  return (
    <section className="access-panel" aria-live="polite">
      {stage === "phone" && (
        <>
          <label>
            <span>{copy.phone}</span>
            <FormControl
              kind="input"
              type="tel"
              dir="ltr"
              autoComplete="tel"
              value={phone}
              placeholder="+9647501234567"
              onChange={(event) => setPhone(event.target.value)}
            />
          </label>
          <small>
            {copy.phoneHint} <bdi dir="ltr">+9647501234567</bdi>
          </small>
          <ActionButton
            kind="primary"
            width="full"
            type="button"
            pending={pending}
            onClick={sendCode}
          >
            {copy.sendCode}
          </ActionButton>
        </>
      )}
      {stage === "code" && (
        <>
          <label>
            <span>{copy.code}</span>
            <FormControl
              kind="input"
              dir="ltr"
              inputMode="numeric"
              maxLength={6}
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
          <ActionButton
            kind="primary"
            width="full"
            type="button"
            pending={pending}
            onClick={verifyCode}
          >
            {copy.verify}
          </ActionButton>
          <ActionButton
            kind="secondary"
            size="regular"
            type="button"
            disabled={pending}
            onClick={sendCode}
          >
            {copy.resend}
          </ActionButton>
          <ActionButton
            kind="secondary"
            size="regular"
            type="button"
            disabled={pending}
            onClick={() => {
              setStage("phone");
              setCode("");
              setMessage("");
            }}
          >
            {copy.editNumber}
          </ActionButton>
        </>
      )}
      {message && (
        <ActionFeedback kind={stage === "verified" ? "success" : "error"}>
          {message}
        </ActionFeedback>
      )}
    </section>
  );
}
