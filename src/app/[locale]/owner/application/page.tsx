import Link from "next/link";
import { notFound } from "next/navigation";

import { createRequestSupabaseClient } from "@/access/supabase-server";
import { SupabaseAccountContextStore } from "@/access/supabase-account-access";
import { OwnerApplicationForm } from "@/components/owner-application-form";
import { ownerApplicationMessages } from "@/i18n/owner-application-messages";
import { isLocale } from "@/i18n/routing";
import { createRequestOwnerApplication } from "@/owner-application/request-owner-application";

export default async function OwnerApplicationPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const copy = ownerApplicationMessages[locale];
  const client = await createRequestSupabaseClient();
  const context = await new SupabaseAccountContextStore(client).resolve();

  if (context?.role !== "cottage_owner") {
    return (
      <main className="owner-application-page access-required-page">
        <header className="owner-application-header">
          <Link href={`/${locale}`}>RentCottage</Link>
          <span>{copy.eyebrow}</span>
        </header>
        <section className="access-required-card">
          <h1>{copy.title}</h1>
          <p>{copy.accessRequired}</p>
          <Link href={`/${locale}/owner/access`}>{copy.verifyPhone}</Link>
        </section>
      </main>
    );
  }

  const applicationService = await createRequestOwnerApplication();
  const application = await applicationService.load();

  return (
    <main className="owner-application-page">
      <header className="owner-application-header">
        <Link href={`/${locale}`}>RentCottage</Link>
        <span>{copy.eyebrow}</span>
      </header>
      <OwnerApplicationForm locale={locale} application={application} />
    </main>
  );
}
