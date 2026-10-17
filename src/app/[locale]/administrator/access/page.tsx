import { notFound } from "next/navigation";

import { safeAdministratorReturnDestination } from "@/access/return-destination";
import { AdministratorAccessForm } from "@/components/administrator-access-form";
import { accessMessages } from "@/i18n/access-messages";
import { isLocale } from "@/i18n/routing";

export default async function AdministratorAccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  const copy = accessMessages[locale];

  return (
    <main className="page results-page administrator-access-page page-record">
      <header className="page-heading">
        <h1 className="page-title">{copy.administratorTitle}</h1>
      </header>
      <AdministratorAccessForm
        locale={locale}
        returnTo={safeAdministratorReturnDestination(locale, query.returnTo)}
        reviewHref={`/${locale}/administrator/owner-applications`}
        cottageProfilesHref={`/${locale}/administrator/cottages`}
        recordsHref={`/${locale}/administrator/records`}
      />
    </main>
  );
}
