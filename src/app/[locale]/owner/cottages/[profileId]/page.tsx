import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";

import { loadOwnerCottageEditor } from "@/cottage-profile/owner-cottage-editor";
import { CottageProfileEditor } from "@/components/cottage-profile-editor";
import { CottageProfileLifecycleControls } from "@/components/cottage-profile-lifecycle-controls";
import { CottagePricingAvailabilityEditor } from "@/components/cottage-pricing-availability-editor";
import { CottagePublicationReview } from "@/components/cottage-publication-review";
import { CottageShiftScheduleEditor } from "@/components/cottage-shift-schedule-editor";
import { OwnerCottageAccessFallback } from "@/components/owner-cottage-access-fallback";
import { cottageProfileMessages } from "@/i18n/cottage-profile-messages";
import { isLocale } from "@/i18n/routing";

export default async function OwnerCottageProfilePage({
  params,
}: {
  params: Promise<{ locale: string; profileId: string }>;
}) {
  const { locale, profileId } = await params;
  if (!isLocale(locale)) notFound();
  const copy = cottageProfileMessages[locale];
  const page = await loadOwnerCottageEditor(profileId);
  if (page.status === "unavailable") {
    unstable_rethrow(page.error);
    console.error("Owner Cottage Profile editor load failed", {
      phase: "owner_cottage_profile_editor_load",
      result: "unavailable",
    });
    return (
      <OwnerCottageAccessFallback
        locale={locale}
        title={copy.editorTitle}
        status="unavailable"
      />
    );
  }
  if (page.status === "access_required") {
    return (
      <OwnerCottageAccessFallback
        locale={locale}
        title={copy.editorTitle}
        status="access_required"
      />
    );
  }
  if (page.status === "prospective") {
    return (
      <OwnerCottageAccessFallback
        locale={locale}
        title={copy.editorTitle}
        status="prospective"
      />
    );
  }
  if (!page.value.profile) notFound();
  return (
    <main className="owner-application-page cottage-profile-page">
      <header className="owner-application-header">
        <Link href={`/${locale}/owner/cottages`}>{copy.back}</Link>
        <span>{copy.eyebrow}</span>
      </header>
      <CottageProfileEditor
        locale={locale}
        profile={page.value.profile}
        actor="owner"
        editable={page.value.editable && page.value.profile.status === "draft"}
      />
      <CottageProfileLifecycleControls
        locale={locale}
        actor="owner"
        profile={page.value.profile}
        eligible={page.value.editable}
      />
      <CottageShiftScheduleEditor
        locale={locale}
        profileId={page.value.profile.id}
        schedule={page.value.schedule}
        editable={page.value.editable && page.value.profile.status === "draft"}
      />
      <CottagePricingAvailabilityEditor
        locale={locale}
        profileId={page.value.profile.id}
        schedule={page.value.schedule}
        pricing={page.value.pricing}
        editable={
          page.value.editable && page.value.profile.status !== "abandoned"
        }
        canOpen={
          page.value.profile.status !== "abandoned" &&
          Boolean(page.value.profile.currentPublicationId)
        }
      />
      {page.value.review ? (
        <CottagePublicationReview
          locale={locale}
          review={page.value.review}
          actor="owner"
        />
      ) : null}
    </main>
  );
}
