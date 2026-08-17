import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";

import { SupabaseAccountContextStore } from "@/access/supabase-account-access";
import { createRequestSupabaseClient } from "@/access/supabase-server";
import { createRequestCottageProfile } from "@/cottage-profile/request-cottage-profile";
import type { CottageProfileAdministratorCursor } from "@/cottage-profile/cottage-profile";
import { parseAdministratorCottageProfileCursor } from "@/cottage-profile/supabase-cottage-profile";
import { CottageProfileOverview } from "@/components/cottage-profile-overview";
import { cottageProfileMessages } from "@/i18n/cottage-profile-messages";
import { isLocale } from "@/i18n/routing";

async function loadAdministratorCottages(
  cursor?: CottageProfileAdministratorCursor,
) {
  const client = await createRequestSupabaseClient();
  const [context, authorization] = await Promise.all([
    new SupabaseAccountContextStore(client).resolve(),
    client.rpc("is_platform_administrator", { required_assurance: "aal2" }),
  ]);
  if (context?.role !== "platform_administrator") {
    return { status: "access_required" as const };
  }
  if (authorization.error) throw authorization.error;
  if (authorization.data !== true)
    return { status: "access_required" as const };
  const cottageProfile = await createRequestCottageProfile();
  return {
    status: "ready" as const,
    page: await cottageProfile.listAdministrator(cursor),
  };
}

export default async function AdministratorCottagesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const copy = cottageProfileMessages[locale];
  let page: Awaited<ReturnType<typeof loadAdministratorCottages>> | undefined;
  try {
    const query = searchParams ? await searchParams : {};
    page = await loadAdministratorCottages(
      parseAdministratorCottageProfileCursor(
        query.afterUpdatedAt,
        query.afterProfileId,
      ),
    );
  } catch (error) {
    unstable_rethrow(error);
    console.error("Administrator Cottage Profile overview load failed", {
      phase: "administrator_cottage_profile_overview_load",
      result: "unavailable",
    });
  }
  if (!page || page.status === "access_required") {
    return (
      <main className="owner-application-page access-required-page">
        <section
          className="access-required-card"
          role={!page ? "alert" : undefined}
        >
          <h1>{copy.adminTitle}</h1>
          <p>{!page ? copy.unavailable : copy.adminAccessRequired}</p>
          {page ? (
            <Link href={`/${locale}/administrator/access`}>
              {copy.administratorAccessAction}
            </Link>
          ) : null}
        </section>
      </main>
    );
  }
  return (
    <main className="owner-application-page cottage-profile-page">
      <header className="owner-application-header">
        <Link href={`/${locale}`}>RentCottage</Link>
        <span>{copy.adminEyebrow}</span>
      </header>
      <CottageProfileOverview
        locale={locale}
        actor="administrator"
        profiles={page.page.profiles}
        continuationHref={
          page.page.nextCursor
            ? `/${locale}/administrator/cottages?${new URLSearchParams({
                afterUpdatedAt: page.page.nextCursor.updatedAt,
                afterProfileId: page.page.nextCursor.profileId,
              })}`
            : undefined
        }
      />
    </main>
  );
}
