import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";

import { loadOwnerCottageAccess } from "@/cottage-profile/request-owner-cottage-access";
import { CottageProfileOverview } from "@/components/cottage-profile-overview";
import { OwnerCottageAccessFallback } from "@/components/owner-cottage-access-fallback";
import { cottageProfileMessages } from "@/i18n/cottage-profile-messages";
import { isLocale } from "@/i18n/routing";

async function loadOwnerCottages() {
  return loadOwnerCottageAccess(async (cottageProfile, approvalState) => ({
    profiles: await cottageProfile.listOwner(),
    canCreate: approvalState === "approved",
  }));
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
      <OwnerCottageAccessFallback
        locale={locale}
        title={copy.overviewTitle}
        status="unavailable"
      />
    );
  }
  if (page.status === "access_required") {
    return (
      <OwnerCottageAccessFallback
        locale={locale}
        title={copy.overviewTitle}
        status="access_required"
      />
    );
  }
  if (page.status === "prospective") {
    return (
      <OwnerCottageAccessFallback
        locale={locale}
        title={copy.overviewTitle}
        status="prospective"
      />
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
        profiles={page.value.profiles}
        canCreate={page.value.canCreate}
      />
    </main>
  );
}
