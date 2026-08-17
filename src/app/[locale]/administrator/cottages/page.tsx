import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";

import { SupabaseAccountContextStore } from "@/access/supabase-account-access";
import { createRequestSupabaseClient } from "@/access/supabase-server";
import { createRequestCottageProfile } from "@/cottage-profile/request-cottage-profile";
import { CottageProfileOverview } from "@/components/cottage-profile-overview";
import { cottageProfileMessages } from "@/i18n/cottage-profile-messages";
import { isLocale } from "@/i18n/routing";

async function loadAdministratorCottages() {
  const client = await createRequestSupabaseClient();
  const [context, authorization] = await Promise.all([
    new SupabaseAccountContextStore(client).resolve(),
    client.rpc("is_platform_administrator", { required_assurance: "aal2" }),
  ]);
  if (
    context?.role !== "platform_administrator" ||
    authorization.error ||
    authorization.data !== true
  ) {
    return { status: "access_required" as const };
  }
  const cottageProfile = await createRequestCottageProfile();
  return {
    status: "ready" as const,
    profiles: await cottageProfile.listAdministrator(),
  };
}

export default async function AdministratorCottagesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const copy = cottageProfileMessages[locale];
  let page: Awaited<ReturnType<typeof loadAdministratorCottages>> | undefined;
  try {
    page = await loadAdministratorCottages();
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
              {copy.adminAccessRequired}
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
        profiles={page.profiles}
      />
    </main>
  );
}
