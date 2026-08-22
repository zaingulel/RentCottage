import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";

import { loadOwnerCottageAccess } from "@/cottage-profile/request-owner-cottage-access";
import { createRequestCottageInventory } from "@/cottage-inventory/request-cottage-inventory";
import { createRequestCottagePublication } from "@/cottage-publication/request-cottage-publication";
import { CottageProfileEditor } from "@/components/cottage-profile-editor";
import { CottageProfileLifecycleControls } from "@/components/cottage-profile-lifecycle-controls";
import { CottagePricingAvailabilityEditor } from "@/components/cottage-pricing-availability-editor";
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
    const inventory = await createRequestCottageInventory();
    const [profile, review, scheduleResult] = await Promise.all([
      cottageProfile.load(profileId),
      publication.loadCurrentReview(profileId),
      shiftSchedule.loadCurrent(profileId),
    ]);
    if (scheduleResult.status !== "loaded") {
      throw new Error("Owner Cottage Shift Schedule load failed");
    }
    let pricing = null;
    if (scheduleResult.schedule?.scheduleRevisionId) {
      const pricingResult = await inventory.loadOwnerEditorState(
        profileId,
        scheduleResult.schedule.scheduleRevisionId,
      );
      if (pricingResult.status !== "loaded") {
        throw new Error("Owner Cottage Inventory load failed");
      }
      const expectedUnits = new Map<string, "shift" | "full_day_bundle">([
        ...scheduleResult.schedule.shifts.map(
          (shift) => [shift.id, "shift"] as const,
        ),
        [scheduleResult.schedule.fullDayBundleId, "full_day_bundle"] as const,
      ]);
      if (
        pricingResult.state.units.length !== expectedUnits.size ||
        pricingResult.state.units.some(
          (unit) => expectedUnits.get(unit.id) !== unit.kind,
        )
      ) {
        throw new Error("Owner Cottage Inventory units do not match schedule");
      }
      pricing = pricingResult.state;
    }
    return {
      profile,
      review,
      schedule: scheduleResult.schedule,
      pricing,
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
