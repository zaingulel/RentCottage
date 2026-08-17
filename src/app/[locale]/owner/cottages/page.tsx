import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";

import { SupabaseAccountContextStore } from "@/access/supabase-account-access";
import { createRequestSupabaseClient } from "@/access/supabase-server";
import { createRequestCottageProfile } from "@/cottage-profile/request-cottage-profile";
import { CottageProfileOverview } from "@/components/cottage-profile-overview";
import { cottageProfileMessages } from "@/i18n/cottage-profile-messages";
import { isLocale } from "@/i18n/routing";

async function loadOwnerCottages() {
  const client = await createRequestSupabaseClient();
  const context = await new SupabaseAccountContextStore(client).resolve();
  if (context?.role !== "cottage_owner") {
    return { status: "access_required" as const };
  }
  if (context.approvalState === "prospective") {
    return { status: "prospective" as const };
  }
  const cottageProfile = await createRequestCottageProfile();
  return {
    status: "ready" as const,
    profiles: await cottageProfile.listOwner(),
    canCreate: context.approvalState === "approved",
  };
}

export default async function OwnerCottagesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const copy = cottageProfileMessages[locale];
  let page: Awaited<ReturnType<typeof loadOwnerCottages>> | undefined;
  try {
    page = await loadOwnerCottages();
  } catch (error) {
    unstable_rethrow(error);
    console.error("Owner Cottage Profile overview load failed", {
      phase: "owner_cottage_profile_overview_load",
      result: "unavailable",
    });
  }

  if (!page) {
    return (
      <main className="owner-application-page access-required-page">
        <section className="access-required-card" role="alert">
          <h1>{copy.overviewTitle}</h1>
          <p>{copy.unavailable}</p>
        </section>
      </main>
    );
  }
  if (page.status === "access_required") {
    return (
      <main className="owner-application-page access-required-page">
        <section className="access-required-card">
          <h1>{copy.overviewTitle}</h1>
          <p>{copy.accessRequired}</p>
          <Link href={`/${locale}/owner/access`}>{copy.ownerAccessAction}</Link>
        </section>
      </main>
    );
  }
  if (page.status === "prospective") {
    return (
      <main className="owner-application-page access-required-page">
        <section className="access-required-card">
          <h1>{copy.overviewTitle}</h1>
          <p>{copy.prospective}</p>
          <Link href={`/${locale}/owner/application`}>
            {copy.ownerApplication}
          </Link>
        </section>
      </main>
    );
  }
  return (
    <main className="owner-application-page cottage-profile-page">
      <header className="owner-application-header">
        <Link href={`/${locale}`}>RentCottage</Link>
        <span>{copy.eyebrow}</span>
      </header>
      <CottageProfileOverview
        locale={locale}
        actor="owner"
        profiles={page.profiles}
        canCreate={page.canCreate}
      />
    </main>
  );
}
