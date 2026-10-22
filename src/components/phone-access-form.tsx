"use client";

import { useId, useState } from "react";
import { unstable_rethrow } from "next/navigation";

import {
  completePhoneAccess,
  requestPhoneAccess,
  verifyPhoneAccess,
} from "@/access/actions";
import type { PhoneAccessMode } from "@/access/account-access";
import {
  accessMessages,
  hostedDemoAccessMessages,
} from "@/i18n/access-messages";
import type { Locale } from "@/i18n/routing";

import {
  ActionButton,
  ActionFeedback,
  ActionFocusTarget,
  FormControl,
  prepareActionFocusNavigation,
} from "./interaction-controls";
import { useExclusiveAction } from "./use-exclusive-action";

export function PhoneAccessForm({
  locale,
  phoneAccessMode = "standard",
  returnTo,
  onVerified,
  verifiedFocusTargetId,
}: {
  locale: Locale;
  phoneAccessMode?: PhoneAccessMode;
  returnTo?: string;
  onVerified?: () => void;
  verifiedFocusTargetId?: string;
}) {
  const hostedDemo = phoneAccessMode === "hosted-demo";
  const copy = {
    ...accessMessages[locale],
    ...(hostedDemo ? hostedDemoAccessMessages[locale] : {}),
  };
  const verifyButtonId = useId();
  const codeInputId = useId();
  const verifiedFeedbackId = useId();
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
    if (
      (result.status === "code_sent" && !hostedDemo) ||
      (result.status === "demo_code_ready" && hostedDemo)
    )
      setStage("code");
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
    let abortNavigation: (() => void) | undefined;
    try {
      result = await run(() => {
        if (returnTo && !verifiedFocusTargetId)
          abortNavigation = prepareActionFocusNavigation(verifyButtonId);
        return verifyPhoneAccess({ phone, code });
      });
    } catch (error) {
      unstable_rethrow(error);
      abortNavigation?.();
      setMessage(copy.unavailable);
      return;
    }
    if (!result) return;
    if (result.status === "authenticated") {
      setStage("verified");
      setMessage(copy.verified);
      try {
        if (returnTo) {
          try {
            const destination = verifiedFocusTargetId
              ? await completePhoneAccess(locale, returnTo, true)
              : await completePhoneAccess(locale, returnTo);
            if (destination?.status === "unavailable") {
              setStage("code");
              setMessage(copy.unavailable);
              abortNavigation?.();
            }
          } catch (error) {
            unstable_rethrow(error);
            setStage("code");
            setMessage(copy.unavailable);
            abortNavigation?.();
          }
        }
      } finally {
        onVerified?.();
      }
    } else {
      abortNavigation?.();
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
              placeholder={hostedDemo ? undefined : "+9647501234567"}
              onChange={(event) => setPhone(event.target.value)}
            />
          </label>
          <small>
            {copy.phoneHint}{" "}
            {!hostedDemo && <bdi dir="ltr">+9647501234567</bdi>}
          </small>
          <ActionButton
            kind="primary"
            width="full"
            type="button"
            pending={pending}
            onClick={sendCode}
            focusSuccessorId={codeInputId}
          >
            {copy.sendCode}
          </ActionButton>
        </>
      )}
      {stage === "code" && (
        <>
          {hostedDemo && (
            <small>{hostedDemoAccessMessages[locale].codeHint}</small>
          )}
          <label>
            <span>{copy.code}</span>
            <FormControl
              kind="input"
              dir="ltr"
              id={codeInputId}
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
            id={verifyButtonId}
            focusSuccessorId={
              verifiedFocusTargetId ??
              (returnTo ? codeInputId : verifiedFeedbackId)
            }
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
      {stage === "code" && !pending && (
        <ActionFocusTarget targetId={codeInputId} />
      )}
      {message && (
        <ActionFeedback
          kind={stage === "verified" ? "success" : "error"}
          focusTargetId={
            stage === "verified" &&
            !pending &&
            !returnTo &&
            !verifiedFocusTargetId
              ? verifiedFeedbackId
              : undefined
          }
        >
          {message}
        </ActionFeedback>
      )}
    </section>
  );
}
