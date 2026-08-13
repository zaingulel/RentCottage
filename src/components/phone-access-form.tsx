"use client";

import { useState } from "react";

import { requestPhoneAccess, verifyPhoneAccess } from "@/access/actions";
import type { MarketplaceRole } from "@/access/account-access";
import { accessMessages } from "@/i18n/access-messages";
import type { Locale } from "@/i18n/routing";

export function PhoneAccessForm({
  locale,
  role,
}: {
  locale: Locale;
  role: MarketplaceRole;
}) {
  const copy = accessMessages[locale];
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"phone" | "code" | "verified">("phone");
  const [message, setMessage] = useState("");

  async function sendCode() {
    setMessage("");
    const result = await requestPhoneAccess(phone);
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
    const result = await verifyPhoneAccess({ phone, code, role });
    if (result.status === "authenticated") {
      setStage("verified");
      setMessage(
        role === "customer" ? copy.verifiedCustomer : copy.verifiedOwner,
      );
    } else {
      setMessage(
        result.status === "role_conflict"
          ? copy.roleConflict
          : result.status === "unavailable"
            ? copy.unavailable
            : copy.invalidCode,
      );
    }
  }

  return (
    <section className="access-panel" aria-live="polite">
      {stage === "phone" && (
        <>
          <label>
            <span>{copy.phone}</span>
            <input
              type="tel"
              value={phone}
              placeholder="+9647501234567"
              onChange={(event) => setPhone(event.target.value)}
            />
          </label>
          <small>{copy.phoneHint}</small>
          <button type="button" onClick={sendCode}>
            {copy.sendCode}
          </button>
        </>
      )}
      {stage === "code" && (
        <>
          <label>
            <span>{copy.code}</span>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
          <button type="button" onClick={verifyCode}>
            {copy.verify}
          </button>
        </>
      )}
      {message && (
        <p className={stage === "verified" ? "access-success" : "access-error"}>
          {message}
        </p>
      )}
    </section>
  );
}
