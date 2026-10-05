import { RequestNotificationDetails } from "@/components/request-notification-details";
import { BookingFinancialDetails } from "@/components/booking-financial-details";
import { requireRequestAccount } from "@/access/request-account-context";
import { AccountAccessRecovery } from "@/components/account-access-recovery";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadBookingRequestDetails } from "@/booking-request/request-booking-request-details";
import { ConfirmedBookingDetails } from "@/components/confirmed-booking-details";
import { isLocale } from "@/i18n/routing";
import { OwnerBookingRequestNotifications } from "@/components/owner-booking-request-notifications";
import { MessagingBookingLink } from "@/components/messaging-booking-link";

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
  const messaging = (
    <MessagingBookingLink locale={locale} reference={reference} />
  );
  const details = await loadBookingRequestDetails(reference, "cottage_owner");
  if (details.outcome === "denied")
    return (
      <AccountAccessRecovery
        locale={locale}
        status="denied"
        returnTo={returnTo}
      />
    );
  if (details.outcome === "unavailable")
    return (
      <main className="results-page">
        <section role="alert">
          <h1>{unavailableCopy[locale]}</h1>
          <Link href={`/${locale}/owner/cottages`}>RentCottage</Link>
        </section>
      </main>
    );
  const notices = (
    <RequestNotificationDetails
      locale={locale}
      reference={reference}
      delivery={details.delivery}
    />
  );
  if (details.outcome === "cancelled")
    return (
      <main className="results-page">
        <BookingFinancialDetails locale={locale} view={details.financial} />
        {messaging}
        {notices}
      </main>
    );
  if (details.outcome === "confirmed")
    return (
      <main className="results-page">
        <ConfirmedBookingDetails
          locale={locale}
          {...details.confirmed}
          lifecycleStatus={details.financial?.lifecycle.status}
        />
        {messaging}
        {details.financial ? (
          <BookingFinancialDetails locale={locale} view={details.financial} />
        ) : null}
        {notices}
      </main>
    );
  return (
    <main className="results-page">
      <OwnerBookingRequestNotifications
        locale={locale}
        notifications={[details.request]}
      />
      {messaging}
      {notices}
    </main>
  );
}
