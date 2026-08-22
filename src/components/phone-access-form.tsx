"use client";

import { useState } from "react";

import { requestPhoneAccess, verifyPhoneAccess } from "@/access/actions";
import type { MarketplaceRole } from "@/access/account-access";
import { accessMessages } from "@/i18n/access-messages";
import { cottageProfileMessages } from "@/i18n/cottage-profile-messages";
import type { Locale } from "@/i18n/routing";

import {
  ActionButton,
  ActionFeedback,
  ActionLink,
  FormControl,
} from "./interaction-controls";
import { useExclusiveAction } from "./use-exclusive-action";

export function PhoneAccessForm({
  locale,
  role,
  applicationHref,
  cottageProfilesHref,
  onVerified,
}: {
  locale: Locale;
  role: MarketplaceRole;
  applicationHref?: string;
  cottageProfilesHref?: string;
  onVerified?: () => void;
}) {
  const copy = accessMessages[locale];
  const cottageProfileCopy = cottageProfileMessages[locale];
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"phone" | "code" | "verified">("phone");
  const [ownerDestination, setOwnerDestination] = useState<
    "application" | "cottages"
  >();
  const [message, setMessage] = useState("");
  const { pending, run } = useExclusiveAction();

  async function sendCode() {
    setMessage("");
    const result = await run(() => requestPhoneAccess(phone));
    if (!result) return;
    if (result.status === "code_sent") setStage("code");
    else
      setMessage(
        result.status === "invalid_phone"
          ? copy.invalidPhone
          : copy.unavailable,
      );
  }

  async function verifyCode() {
    setMessage("");
    const result = await run(() => verifyPhoneAccess({ phone, code, role }));
    if (!result) return;
    if (result.status === "authenticated") {
      setStage("verified");
      if (result.context.role === "cottage_owner") {
        setOwnerDestination(
          result.context.approvalState === "prospective"
            ? "application"
            : "cottages",
        );
      }
      setMessage(
        role === "customer"
          ? copy.verifiedCustomer
          : result.context.role === "cottage_owner" &&
              result.context.approvalState === "approved"
            ? copy.verifiedApprovedOwner
            : result.context.role === "cottage_owner" &&
                (result.context.approvalState === "expired" ||
                  result.context.approvalState === "suspended")
              ? cottageProfileCopy.readOnly
              : copy.verifiedOwner,
      );
      onVerified?.();
    } else {
      setMessage(
        result.status === "role_conflict"
          ? copy.roleConflict
          : result.status === "unavailable"
            ? copy.unavailable
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
              value={phone}
              placeholder="+9647501234567"
              onChange={(event) => setPhone(event.target.value)}
            />
          </label>
          <small>{copy.phoneHint}</small>
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
              inputMode="numeric"
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
        </>
      )}
      {message && (
        <ActionFeedback kind={stage === "verified" ? "success" : "error"}>
          {message}
        </ActionFeedback>
      )}
      {stage === "verified" &&
      ownerDestination === "application" &&
      applicationHref ? (
        <ActionLink kind="secondary" width="content" href={applicationHref}>
          {copy.ownerApplicationCta}
        </ActionLink>
      ) : null}
      {stage === "verified" &&
      ownerDestination === "cottages" &&
      cottageProfilesHref ? (
        <ActionLink kind="secondary" width="content" href={cottageProfilesHref}>
          {copy.cottageProfilesCta}
        </ActionLink>
      ) : null}
    </section>
  );
}
