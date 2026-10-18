import {
  hasApprovedOwnerCapability,
  hasCustomerCapability,
} from "@/access/account-access";
import { waitingBookingRequestCount } from "@/booking-request/booking-request-display";
import { loadOwnerBookingRequestNotifications } from "@/booking-request/request-owner-booking-request-notifications";
import { requireRequestAccount } from "@/access/request-account-context";
import { AccountAccessRecovery } from "@/components/account-access-recovery";
import {
  ActionFocusTarget,
  ActionLink,
} from "@/components/interaction-controls";
import { accessMessages } from "@/i18n/access-messages";
import { messages } from "@/i18n/messages";
import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";
import { loadBookingHistory } from "@/booking-request/request-booking-history";
import { isLocale } from "@/i18n/routing";
import { BookingHistoryList } from "@/components/booking-history-list";
import { BackofficeNavigation } from "@/components/backoffice-navigation";
const copy = {
  en: {
    home: "RentCottage home",
  },
  ar: {
    home: "الصفحة الرئيسية لـ RentCottage",
  },
  ckb: {
    home: "پەڕەی سەرەکیی RentCottage",
  },
} as const;
export default async function BookingHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ workspace?: string | string[] }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const workspace =
    (await searchParams).workspace === "owner" ? "owner" : "customer";
  const returnTo = `/${locale}/bookings${workspace === "owner" ? "?workspace=owner" : ""}`;
  const account = await requireRequestAccount(locale, returnTo);
  if (account.status === "unavailable")
    return (
      <AccountAccessRecovery
        locale={locale}
        status="unavailable"
        returnTo={returnTo}
      />
    );
  if (
    !(workspace === "owner"
      ? hasApprovedOwnerCapability(account.context)
      : hasCustomerCapability(account.context))
  )
    return (
      <AccountAccessRecovery
        locale={locale}
        status="denied"
        returnTo={returnTo}
      />
    );
  const title =
    workspace === "owner"
      ? accessMessages[locale].ownerBookings
      : accessMessages[locale].myBookings;
  const titleId =
    workspace === "owner"
      ? "owner-bookings-heading"
      : "customer-bookings-heading";
  let items;
  let waitingBookingRequests: number | undefined;
  try {
    items = await loadBookingHistory(
      workspace === "owner" ? "cottage_owner" : "customer",
    );
    if (items && workspace === "owner") {
      const notifications = await loadOwnerBookingRequestNotifications();
      if (notifications)
        waitingBookingRequests = waitingBookingRequestCount(notifications);
    }
  } catch (error) {
    unstable_rethrow(error);
    console.error("Booking History load failed", {
      code: "booking_history_failed",
    });
  }
  if (!items || (workspace === "owner" && waitingBookingRequests === undefined))
    return (
      <AccountAccessRecovery
        locale={locale}
        status="unavailable"
        returnTo={returnTo}
      />
    );
  return (
    <main className="results-page page page-record">
      {workspace === "owner" ? (
        <BackofficeNavigation
          locale={locale}
          area="owner"
          current="bookings"
          waitingBookingRequests={waitingBookingRequests}
        />
      ) : null}
      <section className="booking-history">
        <header>
          {workspace === "customer" ? (
            <Link href={`/${locale}`}>{copy[locale].home}</Link>
          ) : null}
          <h1
            id={titleId}
            tabIndex={-1}
            className="page-title action-focus-target"
          >
            {title}
          </h1>
          <ActionFocusTarget targetId={titleId} navigation />
        </header>
        <p>{accessMessages[locale].bookingHistoryIntro}</p>
        {items.length === 0 ? (
          <div className="empty-state">
            <p>{accessMessages[locale].bookingHistoryEmpty}</p>
            {workspace === "owner" ? (
              <ActionLink kind="secondary" href={`/${locale}/owner/cottages`}>
                {accessMessages[locale].manageCottages}
              </ActionLink>
            ) : (
              <ActionLink kind="secondary" href={`/${locale}`}>
                {messages[locale].footerSearch}
              </ActionLink>
            )}
          </div>
        ) : (
          <BookingHistoryList items={items} locale={locale} />
        )}
      </section>
    </main>
  );
}
