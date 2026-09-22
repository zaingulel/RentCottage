import { notFound } from "next/navigation";

import { safeAdministratorReturnDestination } from "@/access/return-destination";
import { AdministratorAccessForm } from "@/components/administrator-access-form";
import { ActionLink } from "@/components/interaction-controls";
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
    <main className="standalone-access">
      <ActionLink kind="text" href={`/${locale}`}>
        RentCottage
      </ActionLink>
      <h1>{copy.administratorTitle}</h1>
      <AdministratorAccessForm
        locale={locale}
        returnTo={safeAdministratorReturnDestination(locale, query.returnTo)}
        reviewHref={`/${locale}/administrator/owner-applications`}
        cottageProfilesHref={`/${locale}/administrator/cottages`}
      />
    </main>
  );
}
