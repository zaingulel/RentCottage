import { requireRequestAccount } from "@/access/request-account-context";
import { AccountAccessRecovery } from "@/components/account-access-recovery";
import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";
import { loadConfirmedBookingAccess } from "@/booking-request/request-confirmed-booking-access";
import { ConfirmedBookingDetails } from "@/components/confirmed-booking-details";
import { isLocale } from "@/i18n/routing";

const unavailableCopy = {
  en: "Confirmed booking is unavailable",
  ar: "الحجز المؤكد غير متاح",
  ckb: "حجزی پشتڕاستکراو بەردەست نییە",
} as const;

export default async function OwnerConfirmedBookingPage({
  params,
}: {
  params: Promise<{ locale: string; reference: string }>;
}) {
  const { locale, reference } = await params;
  if (!isLocale(locale) || !/^RC-REQ-[A-F0-9]{16}$/.test(reference)) notFound();
  const returnTo = `/${locale}/owner/booking-requests/${reference}`;
  const account = await requireRequestAccount(locale, returnTo);
  if (account.status === "unavailable")
    return (
      <AccountAccessRecovery
        locale={locale}
        status="unavailable"
        returnTo={returnTo}
      />
    );
  let confirmed;
  try {
    confirmed = await loadConfirmedBookingAccess(reference);
  } catch (error) {
    unstable_rethrow(error);
    console.error("Owner confirmed Booking load failed", {
      code: "owner_confirmed_booking_failed",
    });
  }
  if (confirmed === null)
    return (
      <AccountAccessRecovery
        locale={locale}
        status="denied"
        returnTo={returnTo}
      />
    );
  if (!confirmed)
    return (
      <main className="results-page">
        <section role="alert">
          <h1>{unavailableCopy[locale]}</h1>
          <Link href={`/${locale}/owner/cottages`}>RentCottage</Link>
        </section>
      </main>
    );
  if (confirmed.access.actorRole !== "cottage_owner")
    return (
      <AccountAccessRecovery
        locale={locale}
        status="denied"
        returnTo={returnTo}
      />
    );
  return (
    <main className="results-page">
      <ConfirmedBookingDetails locale={locale} {...confirmed} />
    </main>
  );
}
