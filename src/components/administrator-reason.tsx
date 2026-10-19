"use client";

import { cottageProfileMessages } from "@/i18n/cottage-profile-messages";
import type { Locale } from "@/i18n/routing";
import { FormControl } from "./interaction-controls";

export function AdministratorReason({
  locale,
  state,
  describedBy,
}: {
  locale: Locale;
  state: { readonly status: string; readonly fields?: readonly string[] };
  describedBy?: string;
}) {
  return (
    <label>
      {cottageProfileMessages[locale].lifecycleReason}
      <FormControl
        kind="textarea"
        name="reason"
        required
        maxLength={1000}
        aria-describedby={describedBy}
        aria-invalid={
          state.status === "invalid" && state.fields?.includes("reason")
            ? true
            : undefined
        }
      />
    </label>
  );
}
