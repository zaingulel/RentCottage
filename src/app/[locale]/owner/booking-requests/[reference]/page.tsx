import {
  ActionFocusTarget,
  ActionLink,
} from "@/components/interaction-controls";
import { RequestNotificationDetails } from "@/components/request-notification-details";
import { BookingFinancialDetails } from "@/components/booking-financial-details";
import { requireRequestAccount } from "@/access/request-account-context";
import { AccountAccessRecovery } from "@/components/account-access-recovery";
import { notFound } from "next/navigation";
import { loadBookingRequestDetails } from "@/booking-request/request-booking-request-details";
import { ConfirmedBookingDetails } from "@/components/confirmed-booking-details";
import { CustomerReviewOwnerReply } from "@/components/customer-review-owner-reply";
import { isLocale } from "@/i18n/routing";
import { OwnerBookingRequestNotifications } from "@/components/owner-booking-request-notifications";
import { accessMessages } from "@/i18n/access-messages";
import { MessagingBookingLink } from "@/components/messaging-booking-link";

const unavailableCopy = {
  en: "Booking details are unavailable",
  ar: "تفاصيل الحجز غير متاحة",
  ckb: "وردەکارییەکانی حجز بەردەست نییە",
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
        focusTargetId="owner-booking-request-detail"
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
        focusTargetId="owner-booking-request-detail"
      />
    );
  if (details.outcome === "unavailable")
    return (
      <main
        id="owner-booking-request-detail"
        tabIndex={-1}
        className="results-page page page-record action-focus-target"
      >
        <ActionFocusTarget targetId="owner-booking-request-detail" />
        <section role="alert">
          <header className="page-heading">
            <ActionLink
              kind="text"
              href={`/${locale}/bookings?workspace=owner`}
            >
              {accessMessages[locale].ownerBookings}
            </ActionLink>
            <h1
              id="owner-booking-request-unavailable-title"
              tabIndex={-1}
              className="page-title action-focus-target"
            >
              {unavailableCopy[locale]}
            </h1>
            <ActionFocusTarget
              targetId="owner-booking-request-unavailable-title"
              navigation
            />
          </header>
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
        id="owner-booking-request-detail"
        tabIndex={-1}
        className="results-page action-focus-target"
      >
        <ActionFocusTarget targetId="owner-booking-request-detail" />
        <BookingFinancialDetails locale={locale} view={details.financial} />
        {messaging}
        {notices}
      </main>
    );
  if (details.outcome === "confirmed")
    return (
      <main
        id="owner-booking-request-detail"
        tabIndex={-1}
        className="results-page page page-record action-focus-target"
      >
        <ActionFocusTarget targetId="owner-booking-request-detail" />
        <ConfirmedBookingDetails
          locale={locale}
          {...details.confirmed}
          lifecycleStatus={details.financial?.lifecycle.status}
        />
        <CustomerReviewOwnerReply
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
      id="owner-booking-request-detail"
      tabIndex={-1}
      className="results-page action-focus-target"
    >
      <ActionFocusTarget targetId="owner-booking-request-detail" />
      <ActionFocusTarget targetId="owner-booking-request-detail" navigation />
      <OwnerBookingRequestNotifications
        headingLevel={1}
        locale={locale}
        notifications={[details.request]}
        focusSuccessorId="owner-booking-request-detail"
      />
      {messaging}
      {notices}
    </main>
  );
}
