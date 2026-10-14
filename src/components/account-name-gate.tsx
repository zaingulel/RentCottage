"use client";

import { Activity, type ReactNode } from "react";

import type { Locale } from "@/i18n/routing";

import { AccountNameForm } from "./account-name-form";

export function AccountNameGate({
  locale,
  missing,
  children,
}: {
  locale: Locale;
  missing: boolean;
  children: ReactNode;
}) {
  // Both slots exist in every state, so the page keeps its React identity and
  // state while the step shows.
  return (
    <>
      {missing && (
        <main className="standalone-access">
          <AccountNameForm locale={locale} mode="step" />
        </main>
      )}
      <Activity mode={missing ? "hidden" : "visible"}>{children}</Activity>
    </>
  );
}
