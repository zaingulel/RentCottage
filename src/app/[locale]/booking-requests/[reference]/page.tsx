import { ActionFocusTarget } from "@/components/interaction-controls";
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
        focusTargetId="customer-booking-request-detail"
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
        focusTargetId="customer-booking-request-detail"
      />
    );
  if (details.outcome === "unavailable")
    return (
      <main
        id="customer-booking-request-detail"
        tabIndex={-1}
        className="results-page action-focus-target"
      >
        <ActionFocusTarget targetId="customer-booking-request-detail" />
        <section role="alert">
          <h1
            id="customer-booking-request-unavailable-title"
            tabIndex={-1}
            className="action-focus-target"
          >
            {unavailableCopy[locale].title}
          </h1>
          <ActionFocusTarget
            targetId="customer-booking-request-unavailable-title"
            navigation
          />
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
      <main
        id="customer-booking-request-detail"
        tabIndex={-1}
        className="results-page action-focus-target action-focus-target-inset"
      >
        <ActionFocusTarget targetId="customer-booking-request-detail" />
        <BookingFinancialDetails locale={locale} view={details.financial} />
        {messaging}
        {notices}
      </main>
    );
  if (details.outcome === "confirmed")
    return (
      <main
        id="customer-booking-request-detail"
        tabIndex={-1}
        className="results-page page page-record action-focus-target"
      >
        <ActionFocusTarget targetId="customer-booking-request-detail" />
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
    <main
      id="customer-booking-request-detail"
      tabIndex={-1}
      className="results-page page page-record action-focus-target"
    >
      <ActionFocusTarget targetId="customer-booking-request-detail" />
      <CustomerBookingRequestStatus
        locale={locale}
        request={details.request}
        focusSuccessorId="customer-booking-request-detail"
      />
      {messaging}
      {notices}
    </main>
  );
}
