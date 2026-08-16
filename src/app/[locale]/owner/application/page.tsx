import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";

import { createRequestSupabaseClient } from "@/access/supabase-server";
import { SupabaseAccountContextStore } from "@/access/supabase-account-access";
import { OwnerApplicationForm } from "@/components/owner-application-form";
import { OwnerApplicationReviewStatus } from "@/components/owner-application-review-status";
import { ownerApplicationMessages } from "@/i18n/owner-application-messages";
import { isLocale } from "@/i18n/routing";
import { createRequestOwnerApplication } from "@/owner-application/request-owner-application";
import { loadOwnerApplicationOwnerReview } from "@/owner-application/supabase-owner-application-review";

async function loadOwnerApplicationPage() {
  const client = await createRequestSupabaseClient();
  const context = await new SupabaseAccountContextStore(client).resolve();
  if (context?.role !== "cottage_owner") {
    return { status: "access_required" as const };
  }
  const applicationService = await createRequestOwnerApplication();
  const application = await applicationService.load();
  return {
    status: "ready" as const,
    application,
    review: application
      ? await loadOwnerApplicationOwnerReview(client, application.applicationId)
      : null,
  };
}

export default async function OwnerApplicationPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const copy = ownerApplicationMessages[locale];
  let page: Awaited<ReturnType<typeof loadOwnerApplicationPage>> | undefined;
  try {
    page = await loadOwnerApplicationPage();
  } catch (error) {
    unstable_rethrow(error);
    console.error("Owner Application page load failed", {
      phase: "owner_application_page_load",
      result: "unavailable",
    });
  }

  if (!page) {
    return (
      <main className="owner-application-page access-required-page">
        <header className="owner-application-header">
          <Link href={`/${locale}`}>RentCottage</Link>
          <span>{copy.eyebrow}</span>
        </header>
        <section className="access-required-card" role="alert">
          <h1>{copy.title}</h1>
          <p>{copy.unavailable}</p>
        </section>
      </main>
    );
  }

  if (page.status === "access_required") {
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

  return (
    <main className="owner-application-page">
      <header className="owner-application-header">
        <Link href={`/${locale}`}>RentCottage</Link>
        <span>{copy.eyebrow}</span>
      </header>
      {page.application && page.review ? (
        <OwnerApplicationReviewStatus
          locale={locale}
          application={page.application}
          review={page.review}
        />
      ) : null}
      <OwnerApplicationForm locale={locale} application={page.application} />
    </main>
  );
}
