import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccountNavigation } from "@/components/account-navigation";
import { resolveRequestAccount } from "@/access/request-account-context";
import type { ReactNode } from "react";

import { directionFor, isLocale, locales } from "@/i18n/routing";

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
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const account = await resolveRequestAccount();
  const navigationAccount =
    account.status === "authenticated"
      ? {
          status: account.status,
          context: account.context
            ? {
                role: account.context.role,
                ...(account.context.role === "cottage_owner"
                  ? { approvalState: account.context.approvalState }
                  : {}),
              }
            : undefined,
        }
      : account;
  return (
    <html lang={locale} dir={directionFor(locale)}>
      <body>
        <AccountNavigation locale={locale} account={navigationAccount} />
        {children}
      </body>
    </html>
  );
}
