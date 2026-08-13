"use client";

import Image from "next/image";
import { useState } from "react";

import {
  signInPlatformAdministrator,
  verifyPlatformAdministratorMfa,
} from "@/access/actions";
import { accessMessages } from "@/i18n/access-messages";
import type { Locale } from "@/i18n/routing";

type MfaState = {
  factorId: string;
  challengeId: string;
  qrCode?: string;
  secret?: string;
};

export function AdministratorAccessForm({ locale }: { locale: Locale }) {
  const copy = accessMessages[locale];
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [mfa, setMfa] = useState<MfaState>();
  const [complete, setComplete] = useState(false);
  const [message, setMessage] = useState("");

  async function signIn() {
    setMessage("");
    const result = await signInPlatformAdministrator({ email, password });
    if (
      result.status === "challenge_required" ||
      result.status === "enrollment_required"
    ) {
      setMfa({
        factorId: result.factorId,
        challengeId: result.challengeId,
        qrCode:
          result.status === "enrollment_required" ? result.qrCode : undefined,
        secret:
          result.status === "enrollment_required" ? result.secret : undefined,
      });
    } else {
      setMessage(copy.invalidSignIn);
    }
  }

  async function verifyMfa() {
    if (!mfa) return;
    setMessage("");
    const result = await verifyPlatformAdministratorMfa({ ...mfa, code });
    if (result.status === "authenticated") {
      setComplete(true);
      setMessage(copy.administratorReady);
    } else {
      setMessage(copy.invalidCode);
    }
  }

  return (
    <section className="access-panel" aria-live="polite">
      {!mfa && !complete && (
        <>
          <label>
            <span>{copy.email}</span>
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            <span>{copy.password}</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button type="button" onClick={signIn}>
            {copy.signIn}
          </button>
        </>
      )}
      {mfa && !complete && (
        <>
          <p>{mfa.qrCode ? copy.mfaSetup : copy.mfaChallenge}</p>
          {mfa.qrCode && (
            <Image
              src={mfa.qrCode}
              alt={copy.mfaQrAlt}
              width={192}
              height={192}
              unoptimized
            />
          )}
          {mfa.secret && <code data-testid="mfa-secret">{mfa.secret}</code>}
          <label>
            <span>{copy.mfaCode}</span>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
          <button type="button" onClick={verifyMfa}>
            {copy.verify}
          </button>
        </>
      )}
      {message && (
        <p className={complete ? "access-success" : "access-error"}>
          {message}
        </p>
      )}
    </section>
  );
}
