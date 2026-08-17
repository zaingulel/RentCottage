import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";

import { SupabaseAccountContextStore } from "@/access/supabase-account-access";
import { createRequestSupabaseClient } from "@/access/supabase-server";
import { createRequestCottageProfile } from "@/cottage-profile/request-cottage-profile";
import { CottageProfileEditor } from "@/components/cottage-profile-editor";
import { cottageProfileMessages } from "@/i18n/cottage-profile-messages";
import { isLocale } from "@/i18n/routing";

async function loadOwnerCottage(profileId: string) {
  const client = await createRequestSupabaseClient();
  const context = await new SupabaseAccountContextStore(client).resolve();
  if (
    context?.role !== "cottage_owner" ||
    context.approvalState === "prospective"
  ) {
    return { status: "access_required" as const };
  }
  const cottageProfile = await createRequestCottageProfile();
  return {
    status: "ready" as const,
    profile: await cottageProfile.load(profileId),
    editable: context.approvalState === "approved",
  };
}

export default async function OwnerCottageProfilePage({
  params,
}: {
  params: Promise<{ locale: string; profileId: string }>;
}) {
  const { locale, profileId } = await params;
  if (!isLocale(locale)) notFound();
  const copy = cottageProfileMessages[locale];
  let page: Awaited<ReturnType<typeof loadOwnerCottage>> | undefined;
  try {
    page = await loadOwnerCottage(profileId);
  } catch (error) {
    unstable_rethrow(error);
    console.error("Owner Cottage Profile editor load failed", {
      phase: "owner_cottage_profile_editor_load",
      result: "unavailable",
    });
  }
  if (!page) {
    return (
      <main className="owner-application-page access-required-page">
        <section className="access-required-card" role="alert">
          <h1>{copy.editorTitle}</h1>
          <p>{copy.unavailable}</p>
        </section>
      </main>
    );
  }
  if (page.status === "access_required") {
    return (
      <main className="owner-application-page access-required-page">
        <section className="access-required-card">
          <h1>{copy.editorTitle}</h1>
          <p>{copy.accessRequired}</p>
          <Link href={`/${locale}/owner/application`}>
            {copy.ownerApplication}
          </Link>
        </section>
      </main>
    );
  }
  if (!page.profile) notFound();
  return (
    <main className="owner-application-page cottage-profile-page">
      <header className="owner-application-header">
        <Link href={`/${locale}/owner/cottages`}>{copy.back}</Link>
        <span>{copy.eyebrow}</span>
      </header>
      <CottageProfileEditor
        locale={locale}
        profile={page.profile}
        actor="owner"
        editable={page.editable && page.profile.status === "draft"}
      />
    </main>
  );
}
