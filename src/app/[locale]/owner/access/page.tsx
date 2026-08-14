import Link from "next/link";
import { notFound } from "next/navigation";

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
      <Link href={`/${locale}`}>RentCottage</Link>
      <h1>{copy.ownerTitle}</h1>
      <p>{copy.ownerIntro}</p>
      <PhoneAccessForm locale={locale} role="cottage_owner" />
      <Link
        className="owner-application-link"
        href={`/${locale}/owner/application`}
      >
        {copy.ownerApplicationCta}
      </Link>
    </main>
  );
}
