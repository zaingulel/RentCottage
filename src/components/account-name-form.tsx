"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { unstable_rethrow } from "next/navigation";

import { saveAccountName } from "@/access/actions";
import { accessMessages } from "@/i18n/access-messages";
import type { Locale } from "@/i18n/routing";

import {
  ActionButton,
  ActionFeedback,
  FormControl,
} from "./interaction-controls";
import { useExclusiveAction } from "./use-exclusive-action";

export function AccountNameForm({
  locale,
  mode,
  firstName = "",
}: {
  locale: Locale;
  mode: "step" | "details";
  firstName?: string;
}) {
  const copy = accessMessages[locale];
  const inputId = useId();
  const errorId = useId();
  const [value, setValue] = useState(firstName);
  const [previousFirstName, setPreviousFirstName] = useState(firstName);
  const [submittedFirstName, setSubmittedFirstName] = useState<string>();
  const [status, setStatus] = useState<
    "saved" | "invalid" | "unavailable" | undefined
  >();
  const { pending, run } = useExclusiveAction();
  const stepTitle = useRef<HTMLHeadingElement>(null);

  // A first name saved elsewhere reaches this form as a new prop while it stays
  // mounted, so the field follows it unless the person typed since the last
  // name shown or submitted; a remount would drop the saved status.
  if (firstName !== previousFirstName) {
    setPreviousFirstName(firstName);
    if (value === previousFirstName || value === submittedFirstName)
      setValue(firstName);
  }

  useLayoutEffect(() => {
    const title = stepTitle.current;
    const active = document.activeElement;
    if (
      !title ||
      active?.closest("header.site-header") ||
      title.closest("main")?.contains(active)
    )
      return;
    // The press that brought the step may have left focus on a page control
    // that Activity has just hidden, so focus on the body is not the only case.
    title.focus();
  }, []);

  async function save() {
    setStatus(undefined);
    let result;
    setSubmittedFirstName(value);
    try {
      result = await run(() => saveAccountName({ firstName: value }));
    } catch (error) {
      unstable_rethrow(error);
      setStatus("unavailable");
      return;
    }
    if (result) setStatus(result.status);
  }

  const panel = (
    <section className="access-panel">
      {/* The input stays unnamed, like the administrator sign-in inputs: a name
          would put the first name in the URL on a native (pre-hydration)
          submission. */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label>
          <span>{copy.firstName}</span>
          <FormControl
            kind="input"
            id={inputId}
            autoComplete="given-name"
            value={value}
            aria-invalid={status === "invalid" || undefined}
            aria-describedby={status === "invalid" ? errorId : undefined}
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
        {status === "invalid" && (
          <p id={errorId} className="field-error">
            {copy.invalidFirstName}
          </p>
        )}
        <ActionButton
          kind="primary"
          width="full"
          type="submit"
          pending={pending}
          focusSuccessorId={
            mode === "step" ? "site-header-account-button" : undefined
          }
        >
          {mode === "step" ? copy.saveAndContinue : copy.save}
        </ActionButton>
      </form>
      {status === "unavailable" && (
        <ActionFeedback kind="error">
          {copy.accountNameUnavailable}
        </ActionFeedback>
      )}
      {status === "saved" && mode === "details" && (
        <ActionFeedback kind="success">{copy.accountNameSaved}</ActionFeedback>
      )}
    </section>
  );
  if (mode === "details") return panel;
  return (
    <>
      <h1
        id="account-name-step-title"
        tabIndex={-1}
        className="action-focus-target"
        ref={stepTitle}
      >
        {copy.accountNameStepTitle}
      </h1>
      <p>{copy.accountNameIntro}</p>
      {panel}
    </>
  );
}
