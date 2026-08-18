import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";

import { SupabaseAccountContextStore } from "@/access/supabase-account-access";
import { createRequestSupabaseClient } from "@/access/supabase-server";
import { createRequestCottagePublication } from "@/cottage-publication/request-cottage-publication";
import { createRequestCottageProfile } from "@/cottage-profile/request-cottage-profile";
import { CottageProfileEditor } from "@/components/cottage-profile-editor";
import { CottagePublicationReview } from "@/components/cottage-publication-review";
import { cottageProfileMessages } from "@/i18n/cottage-profile-messages";
import { isLocale } from "@/i18n/routing";

async function loadAdministratorCottage(profileId: string) {
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
  const publication = await createRequestCottagePublication();
  const [profile, review] = await Promise.all([
    cottageProfile.load(profileId),
    publication.loadCurrentReview(profileId),
  ]);
  return {
    status: "ready" as const,
    profile,
    review,
  };
}

export default async function AdministratorCottageProfilePage({
  params,
}: {
  params: Promise<{ locale: string; profileId: string }>;
}) {
  const { locale, profileId } = await params;
  if (!isLocale(locale)) notFound();
  const copy = cottageProfileMessages[locale];
  let page: Awaited<ReturnType<typeof loadAdministratorCottage>> | undefined;
  try {
    page = await loadAdministratorCottage(profileId);
  } catch (error) {
    unstable_rethrow(error);
    console.error("Administrator Cottage Profile editor load failed", {
      phase: "administrator_cottage_profile_editor_load",
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
          <h1>{copy.editorTitle}</h1>
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
  if (!page.profile) notFound();
  return (
    <main className="owner-application-page cottage-profile-page">
      <header className="owner-application-header">
        <Link href={`/${locale}/administrator/cottages`}>{copy.back}</Link>
        <span>{copy.adminEyebrow}</span>
      </header>
      <CottageProfileEditor
        locale={locale}
        profile={page.profile}
        actor="administrator"
        editable
        sourceEditable={page.review?.state !== "in_review"}
        photoEditable={page.review?.state !== "in_review"}
      />
      {page.review ? (
        <CottagePublicationReview
          locale={locale}
          review={page.review}
          actor="administrator"
        />
      ) : null}
    </main>
  );
}
