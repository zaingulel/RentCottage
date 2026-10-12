import { ActionButton, ActionFocusTarget, ActionLink } from "./interaction-controls";
import { signOutAccount } from "@/access/actions";
import { accessMessages } from "@/i18n/access-messages";
import type { Locale } from "@/i18n/routing";
export function AccountAccessRecovery({
  locale,
  status,
  returnTo,
  focusTargetId,
}: {
  locale: Locale;
  status: "unavailable" | "denied";
  returnTo: string;
  focusTargetId?: string;
}) {
  const copy = accessMessages[locale];
  return (
    <main
      id={focusTargetId}
      tabIndex={focusTargetId ? -1 : undefined}
      className={`standalone-access${focusTargetId ? " action-focus-target" : ""}`}
    >
      {focusTargetId ? <ActionFocusTarget targetId={focusTargetId} /> : null}
      <section role="alert">
        <h1>
          {status === "unavailable" ? copy.sessionUnavailable : copy.denied}
        </h1>
        <ActionLink kind="secondary" width="content" href={returnTo}>
          {copy.retry}
        </ActionLink>
        <form action={signOutAccount.bind(null, locale)}>
          <ActionButton kind="secondary" size="regular" type="submit">
            {copy.signOut}
          </ActionButton>
        </form>
      </section>
    </main>
  );
}
