import type { Metadata } from "next";
import { AccountNameGate } from "@/components/account-name-gate";
import { ActionFocusTarget } from "@/components/interaction-controls";
import { SiteHeader } from "@/components/site-header";
import { navigationAccountFor } from "@/access/navigation-account";
import { resolveRequestAccount } from "@/access/request-account-context";
import { resolveRequestAccountName } from "@/access/request-account-name";
import type { ReactNode } from "react";

import { defaultLocale, directionFor, isLocale, locales } from "@/i18n/routing";

import "../globals.css";

export const metadata: Metadata = {
  title: "RentCottage",
  description: "A trilingual marketplace for rural cottages across Iraq.",
};

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale: requested } = await params;
  const locale = isLocale(requested) ? requested : defaultLocale;

  const account = await resolveRequestAccount();
  const name =
    account.status === "authenticated" && account.context
      ? await resolveRequestAccountName(account.context)
      : undefined;
  const navigationAccount = navigationAccountFor(account, name);
  return (
    <html lang={locale} dir={directionFor(locale)}>
      <body>
        <SiteHeader locale={locale} account={navigationAccount} />
        {name?.status === "named" && (
          <ActionFocusTarget targetId="site-header-account-button" />
        )}
        <AccountNameGate locale={locale} missing={name?.status === "missing"}>
          {children}
        </AccountNameGate>
      </body>
    </html>
  );
}
