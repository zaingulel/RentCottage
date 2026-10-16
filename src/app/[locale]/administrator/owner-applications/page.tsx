import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";

import { resolvePlatformAdministratorAccess } from "@/access/platform-administrator-gate";
import { createRequestSupabaseClient } from "@/access/supabase-server";
import { BackofficeNavigation } from "@/components/backoffice-navigation";
import { ActionLink } from "@/components/interaction-controls";
import { OwnerApplicationReviewQueue } from "@/components/owner-application-review-queue";
import { ownerApplicationReviewMessages } from "@/i18n/owner-application-review-messages";
import { isLocale } from "@/i18n/routing";
import {
  loadSubmittedOwnerApplicationsForReview,
  parseSubmittedOwnerApplicationReviewCursor,
} from "@/owner-application/supabase-owner-application";
import type { SubmittedOwnerApplicationReviewCursor } from "@/owner-application/supabase-owner-application";

async function loadOwnerApplicationReviewPage(
  cursor?: SubmittedOwnerApplicationReviewCursor,
) {
  if ((await resolvePlatformAdministratorAccess()) !== "allowed")
    return { status: "access_required" as const };
  const client = await createRequestSupabaseClient();
  return {
    status: "ready" as const,
    review: await loadSubmittedOwnerApplicationsForReview(client, cursor),
  };
}

export default async function OwnerApplicationReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const copy = ownerApplicationReviewMessages[locale];
  let page:
    | Awaited<ReturnType<typeof loadOwnerApplicationReviewPage>>
    | undefined;

  try {
    const query = searchParams ? await searchParams : {};
    page = await loadOwnerApplicationReviewPage(
      parseSubmittedOwnerApplicationReviewCursor(
        query.afterSubmittedAt,
        query.afterApplicationId,
      ),
    );
  } catch (error) {
    unstable_rethrow(error);
    console.error("Owner Application review queue failed", {
      phase: "owner_application_review_queue_load",
      result: "unavailable",
    });
  }

  if (!page) {
    return (
      <main className="page results-page">
        <header className="page-heading">
          <h1 className="page-title">{copy.title}</h1>
        </header>
        <section className="administrator-notice" role="alert">
          <p>{copy.unavailable}</p>
        </section>
      </main>
    );
  }

  if (page.status === "access_required") {
    return (
      <main className="page results-page">
        <header className="page-heading">
          <h1 className="page-title">{copy.title}</h1>
        </header>
        <section className="administrator-notice">
          <p>{copy.accessRequired}</p>
          <Link href={`/${locale}/administrator/access`}>{copy.signIn}</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="page results-page">
      <BackofficeNavigation
        locale={locale}
        area="administrator"
        current="owner-applications"
      />
      <section className="administrator-review-page">
        <header className="page-heading">
          <h1 className="page-title">{copy.title}</h1>
          <p>{copy.intro}</p>
        </header>
        <OwnerApplicationReviewQueue
          locale={locale}
          applications={page.review.applications}
        />
        {page.review.nextCursor ? (
          <div className="administrator-review-next">
            <ActionLink
              kind="secondary"
              href={`/${locale}/administrator/owner-applications?${new URLSearchParams(
                {
                  afterSubmittedAt: page.review.nextCursor.submittedAt,
                  afterApplicationId: page.review.nextCursor.applicationId,
                },
              )}`}
            >
              {copy.nextPage}
            </ActionLink>
          </div>
        ) : null}
      </section>
    </main>
  );
}
