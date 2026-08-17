import { notFound } from "next/navigation";

import { ActionLink } from "@/components/interaction-controls";
import { PhoneAccessForm } from "@/components/phone-access-form";
import { accessMessages } from "@/i18n/access-messages";
import { isLocale } from "@/i18n/routing";

export default async function OwnerAccessPage({
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
      <h1>{copy.ownerTitle}</h1>
      <p>{copy.ownerIntro}</p>
      <PhoneAccessForm
        locale={locale}
        role="cottage_owner"
        applicationHref={`/${locale}/owner/application`}
        cottageProfilesHref={`/${locale}/owner/cottages`}
      />
    </main>
  );
}
