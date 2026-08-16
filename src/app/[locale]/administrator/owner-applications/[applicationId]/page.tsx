import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";

import { SupabaseAccountContextStore } from "@/access/supabase-account-access";
import { createRequestSupabaseClient } from "@/access/supabase-server";
import { OwnerApplicationReviewDetailView } from "@/components/owner-application-review-detail";
import { ownerApplicationReviewDetailMessages } from "@/i18n/owner-application-review-detail-messages";
import { isLocale } from "@/i18n/routing";
import { loadOwnerApplicationReviewDetail } from "@/owner-application/supabase-owner-application-review";

async function loadOwnerApplicationReviewDetailPage(applicationId: string) {
  const client = await createRequestSupabaseClient();
  const [context, authorization] = await Promise.all([
    new SupabaseAccountContextStore(client).resolve(),
    client.rpc("is_platform_administrator", {
      required_assurance: "aal2",
    }),
  ]);
  if (
    context?.role !== "platform_administrator" ||
    authorization.error ||
    authorization.data !== true
  ) {
    return { status: "access_required" as const };
  }
  return {
    status: "ready" as const,
    detail: await loadOwnerApplicationReviewDetail(client, applicationId),
  };
}

export default async function OwnerApplicationReviewDetailPage({
  params,
}: {
  params: Promise<{ locale: string; applicationId: string }>;
}) {
  const { locale, applicationId } = await params;
  if (!isLocale(locale)) notFound();
  const copy = ownerApplicationReviewDetailMessages[locale];
  let page:
    | Awaited<ReturnType<typeof loadOwnerApplicationReviewDetailPage>>
    | undefined;
  try {
    page = await loadOwnerApplicationReviewDetailPage(applicationId);
  } catch (error) {
    unstable_rethrow(error);
    console.error("Owner Application review detail load failed", {
      phase: "owner_application_review_detail_load",
      result: "unavailable",
    });
  }

  if (!page) {
    return (
      <main className="owner-application-page access-required-page">
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
        <section className="access-required-card">
          <h1>{copy.title}</h1>
          <Link href={`/${locale}/administrator/access`}>{copy.back}</Link>
        </section>
      </main>
    );
  }

  if (!page.detail) notFound();
  return (
    <main className="owner-application-page">
      <header className="owner-application-header">
        <Link href={`/${locale}/administrator/owner-applications`}>
          {copy.back}
        </Link>
        <span>{copy.title}</span>
      </header>
      <OwnerApplicationReviewDetailView locale={locale} detail={page.detail} />
    </main>
  );
}
