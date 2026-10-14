"use client";

import { useId, useState } from "react";

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
  const [status, setStatus] = useState<
    "saved" | "invalid" | "unavailable" | undefined
  >();
  const { pending, run } = useExclusiveAction();

  async function save() {
    setStatus(undefined);
    const result = await run(() => saveAccountName({ firstName: value }));
    if (result) setStatus(result.status);
  }

  return (
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
        >
          {copy.save}
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
}
