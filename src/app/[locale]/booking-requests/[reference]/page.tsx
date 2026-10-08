import { RequestNotificationDetails } from "@/components/request-notification-details";
import { BookingFinancialDetails } from "@/components/booking-financial-details";
import { requireRequestAccount } from "@/access/request-account-context";
import { AccountAccessRecovery } from "@/components/account-access-recovery";
import Link from "next/link";
import { notFound } from "next/navigation";

import { loadBookingRequestDetails } from "@/booking-request/request-booking-request-details";
import { confirmedBookingProgress } from "@/booking-request/booking-request-progress";
import { BookingRequestProgress } from "@/components/booking-request-progress";
import { CustomerBookingRequestStatus } from "@/components/customer-booking-request-status";
import { ConfirmedBookingDetails } from "@/components/confirmed-booking-details";
import { MessagingBookingLink } from "@/components/messaging-booking-link";
import { CustomerReviewForm } from "@/components/customer-review-form";
import { isLocale } from "@/i18n/routing";

const unavailableCopy = {
  en: {
    title: "Booking Request status is unavailable",
    home: "RentCottage home",
  },
  ar: {
    title: "حالة طلب الحجز غير متاحة",
    home: "الصفحة الرئيسية لـ RentCottage",
  },
  ckb: {
    title: "دۆخی داواکاری حجز بەردەست نییە",
    home: "پەڕەی سەرەکیی RentCottage",
  },
} as const;

export default async function CustomerBookingRequestPage({
  params,
}: {
  params: Promise<{ locale: string; reference: string }>;
}) {
  const { locale, reference } = await params;
  if (!isLocale(locale) || !/^RC-REQ-[A-F0-9]{16}$/.test(reference)) notFound();
  const returnTo = `/${locale}/booking-requests/${reference}`;
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
  const details = await loadBookingRequestDetails(reference, "customer");
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
          <h1>{unavailableCopy[locale].title}</h1>
          <Link href={`/${locale}`}>{unavailableCopy[locale].home}</Link>
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
        <div className="booking-request-progress-card">
          <BookingRequestProgress
            locale={locale}
            progress={confirmedBookingProgress}
          />
        </div>
        <ConfirmedBookingDetails
          locale={locale}
          {...details.confirmed}
          lifecycleStatus={details.financial?.lifecycle.status}
        />
        <CustomerReviewForm
          locale={locale}
          bookingRequestReference={reference}
          initialResult={details.review}
        />
        {messaging}
        {details.financial ? (
          <BookingFinancialDetails locale={locale} view={details.financial} />
        ) : null}
        {notices}
      </main>
    );
  return (
    <main className="results-page page page-record">
      <CustomerBookingRequestStatus locale={locale} request={details.request} />
      {messaging}
      {notices}
    </main>
  );
}
