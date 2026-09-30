"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  signInPlatformAdministrator,
  verifyPlatformAdministratorMfa,
} from "@/access/actions";
import { safeAdministratorReturnDestination } from "@/access/return-destination";
import { accessMessages } from "@/i18n/access-messages";
import { administratorRecordsMessages } from "@/i18n/administrator-records-messages";
import type { Locale } from "@/i18n/routing";

import {
  ActionButton,
  ActionFeedback,
  ActionLink,
  FormControl,
} from "./interaction-controls";
import { useExclusiveAction } from "./use-exclusive-action";

type MfaState = {
  factorId: string;
  challengeId: string;
  qrCode?: string;
  secret?: string;
};

export function AdministratorAccessForm({
  locale,
  returnTo,
  reviewHref,
  cottageProfilesHref,
  recordsHref,
}: {
  locale: Locale;
  returnTo?: string;
  reviewHref?: string;
  cottageProfilesHref?: string;
  recordsHref?: string;
}) {
  const router = useRouter();
  const copy = accessMessages[locale];
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [mfa, setMfa] = useState<MfaState>();
  const [complete, setComplete] = useState(false);
  const [message, setMessage] = useState("");
  const { pending, run } = useExclusiveAction();

  async function signIn() {
    setMessage("");
    const result = await run(() =>
      signInPlatformAdministrator({ email, password }),
    );
    if (!result) return;
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
      setMessage(
        result.status === "unavailable" ? copy.unavailable : copy.invalidSignIn,
      );
    }
  }

  async function verifyMfa() {
    if (!mfa) return;
    setMessage("");
    const result = await run(() =>
      verifyPlatformAdministratorMfa({
        factorId: mfa.factorId,
        challengeId: mfa.challengeId,
        code,
      }),
    );
    if (!result) return;
    if (result.status === "authenticated") {
      setComplete(true);
      setMessage(copy.administratorReady);
      const destination = safeAdministratorReturnDestination(locale, returnTo);
      if (destination) {
        router.replace(destination);
        router.refresh();
      }
    } else {
      if (result.status !== "invalid_code") {
        setMfa(undefined);
        setCode("");
      }
      setMessage(
        result.status === "unavailable" ? copy.unavailable : copy.invalidCode,
      );
    }
  }

  return (
    <section className="access-panel" aria-live="polite">
      {!mfa && !complete && (
        // The email and password inputs, like the MFA code input below, stay
        // unnamed: a name would put the value in the URL on any native
        // (pre-hydration) submission. noValidate keeps a malformed email on
        // the server sign-in mapping instead of a native browser bubble.
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void signIn();
          }}
        >
          <label>
            <span>{copy.email}</span>
            <FormControl
              kind="input"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            <span>{copy.password}</span>
            <FormControl
              kind="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <ActionButton
            kind="primary"
            width="full"
            type="submit"
            pending={pending}
          >
            {copy.signIn}
          </ActionButton>
        </form>
      )}
      {mfa && !complete && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void verifyMfa();
          }}
        >
          <p>{mfa.qrCode ? copy.mfaSetup : copy.mfaChallenge}</p>
          {mfa.qrCode && (
            <Image
              src={mfa.qrCode.trimEnd()}
              alt={copy.mfaQrAlt}
              width={192}
              height={192}
              unoptimized
            />
          )}
          {mfa.secret && <code data-testid="mfa-secret">{mfa.secret}</code>}
          <label>
            <span>{copy.mfaCode}</span>
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
            type="submit"
            pending={pending}
          >
            {copy.verify}
          </ActionButton>
        </form>
      )}
      {message && (
        <ActionFeedback kind={complete ? "success" : "error"}>
          {message}
        </ActionFeedback>
      )}
      {complete && reviewHref ? (
        <ActionLink kind="text" href={reviewHref}>
          {copy.reviewApplications}
        </ActionLink>
      ) : null}
      {complete && cottageProfilesHref ? (
        <ActionLink kind="text" href={cottageProfilesHref}>
          {copy.manageCottageProfiles}
        </ActionLink>
      ) : null}
      {complete && recordsHref ? (
        <ActionLink kind="text" href={recordsHref}>
          {administratorRecordsMessages[locale].records}
        </ActionLink>
      ) : null}
    </section>
  );
}
