import { notFound, redirect } from "next/navigation";

import { requireRequestAccount } from "@/access/request-account-context";
import { resolveRequestAccountName } from "@/access/request-account-name";
import { AccountAccessRecovery } from "@/components/account-access-recovery";
import { AccountNameForm } from "@/components/account-name-form";
import {
  ActionFocusTarget,
  ActionLink,
} from "@/components/interaction-controls";
import { accessMessages } from "@/i18n/access-messages";
import { isLocale } from "@/i18n/routing";

export default async function PersonalInformationPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const returnTo = `/${locale}/account`;
  const account = await requireRequestAccount(locale, returnTo);
  const name =
    account.status === "authenticated" && account.context
      ? await resolveRequestAccountName(account.context)
      : undefined;
  if (!name || name.status === "unavailable")
    return (
      <AccountAccessRecovery
        locale={locale}
        status="unavailable"
        returnTo={returnTo}
      />
    );
  if (name.status === "not_asked") redirect(`/${locale}/administrator/access`);
  const copy = accessMessages[locale];
  return (
    <main className="results-page page page-record">
      <header className="page-heading">
        <ActionLink kind="text" href={`/${locale}`}>
          {copy.home}
        </ActionLink>
        <h1
          id="personal-information-title"
          tabIndex={-1}
          className="page-title action-focus-target"
        >
          {copy.personalInformation}
        </h1>
        <ActionFocusTarget targetId="personal-information-title" navigation />
        <p>{copy.accountNameIntro}</p>
      </header>
      <AccountNameForm
        locale={locale}
        mode="details"
        firstName={name.status === "named" ? name.firstName : undefined}
      />
    </main>
  );
}
