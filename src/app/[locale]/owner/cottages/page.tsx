import { requireRequestAccount } from "@/access/request-account-context";
import { accountAccessHref } from "@/access/return-destination";
import { AccountAccessRecovery } from "@/components/account-access-recovery";
import { notFound, redirect, unstable_rethrow } from "next/navigation";

import { loadOwnerCottageAccess } from "@/cottage-profile/request-owner-cottage-access";
import { bookingRequestTestRuntimeIsEnabled } from "@/booking-request/booking-request-test-runtime";
import { loadOwnerBookingRequestNotifications } from "@/booking-request/request-owner-booking-request-notifications";
import { BackofficeNavigation } from "@/components/backoffice-navigation";
import { CottageProfileOverview } from "@/components/cottage-profile-overview";
import { OwnerCottageAccessFallback } from "@/components/owner-cottage-access-fallback";
import { OwnerBookingRequestNotifications } from "@/components/owner-booking-request-notifications";
import { cottageProfileMessages } from "@/i18n/cottage-profile-messages";
import { isLocale } from "@/i18n/routing";

async function loadOwnerCottages() {
  return loadOwnerCottageAccess(async (cottageProfile, approvalState) => ({
    profiles: await cottageProfile.listOwner(),
    canCreate: approvalState === "approved",
    notifications:
      approvalState === "approved" && bookingRequestTestRuntimeIsEnabled()
        ? await loadOwnerBookingRequestNotifications()
        : undefined,
  }));
}

export default async function OwnerCottagesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const account = await requireRequestAccount(
    locale,
    `/${locale}/owner/cottages`,
  );
  if (account.status === "unavailable")
    return (
      <AccountAccessRecovery
        locale={locale}
        status="unavailable"
        returnTo={`/${locale}/owner/cottages`}
      />
    );
  if (account.context?.role === "customer")
    redirect(accountAccessHref(locale, `/${locale}/owner/cottages`));
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
      <BackofficeNavigation locale={locale} area="owner" current="cottages" />
      <CottageProfileOverview
        locale={locale}
        actor="owner"
        profiles={page.value.profiles}
        canCreate={page.value.canCreate}
      />
      <OwnerBookingRequestNotifications
        locale={locale}
        notifications={page.value.notifications}
      />
    </main>
  );
}
