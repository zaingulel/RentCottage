import { notFound } from "next/navigation";

import { AdministratorAccessForm } from "@/components/administrator-access-form";
import { ActionLink } from "@/components/interaction-controls";
import { accessMessages } from "@/i18n/access-messages";
import { isLocale } from "@/i18n/routing";

export default async function AdministratorAccessPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const copy = accessMessages[locale];

  return (
    <main className="standalone-access">
      <ActionLink kind="text" href={`/${locale}`}>
        RentCottage
      </ActionLink>
      <h1>{copy.administratorTitle}</h1>
      <AdministratorAccessForm
        locale={locale}
        reviewHref={`/${locale}/administrator/owner-applications`}
        cottageProfilesHref={`/${locale}/administrator/cottages`}
      />
    </main>
  );
}
