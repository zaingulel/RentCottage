import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";

import { loadOwnerCottageAccess } from "@/cottage-profile/request-owner-cottage-access";
import { createRequestCottagePublication } from "@/cottage-publication/request-cottage-publication";
import { CottageProfileEditor } from "@/components/cottage-profile-editor";
import { CottagePublicationReview } from "@/components/cottage-publication-review";
import { CottageShiftScheduleEditor } from "@/components/cottage-shift-schedule-editor";
import { OwnerCottageAccessFallback } from "@/components/owner-cottage-access-fallback";
import { createRequestCottageShiftSchedule } from "@/cottage-shift-schedule/request-cottage-shift-schedule";
import { cottageProfileMessages } from "@/i18n/cottage-profile-messages";
import { isLocale } from "@/i18n/routing";

async function loadOwnerCottage(profileId: string) {
  return loadOwnerCottageAccess(async (cottageProfile, approvalState) => {
    const publication = await createRequestCottagePublication();
    const shiftSchedule = await createRequestCottageShiftSchedule();
    const [profile, review, scheduleResult] = await Promise.all([
      cottageProfile.load(profileId),
      publication.loadCurrentReview(profileId),
      shiftSchedule.loadCurrent(profileId),
    ]);
    if (scheduleResult.status !== "loaded") {
      throw new Error("Owner Cottage Shift Schedule load failed");
    }
    return {
      profile,
      review,
      schedule: scheduleResult.schedule,
      editable: approvalState === "approved",
    };
  });
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
      <CottageShiftScheduleEditor
        locale={locale}
        profileId={page.value.profile.id}
        schedule={page.value.schedule}
        editable={page.value.editable && page.value.profile.status === "draft"}
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
