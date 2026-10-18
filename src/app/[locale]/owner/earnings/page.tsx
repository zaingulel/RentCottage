import { notFound, unstable_rethrow } from "next/navigation";
import { requireRequestAccount } from "@/access/request-account-context";
import { loadBookingHistory } from "@/booking-request/request-booking-history";
import { AccountAccessRecovery } from "@/components/account-access-recovery";
import {
  ownerBookingEarnings,
  ownerBookingEarningsTotals,
} from "@/booking-request/owner-booking-earnings";
import { OwnerBookingEarningsSummary } from "@/components/owner-booking-earnings";
import { ActionLink } from "@/components/interaction-controls";
import { BackofficeNavigation } from "@/components/backoffice-navigation";
import { BookingHistoryList } from "@/components/booking-history-list";
import { accessMessages } from "@/i18n/access-messages";
import { isLocale } from "@/i18n/routing";

const empty = {
  en: "No booking requests yet.",
  ar: "لا توجد طلبات حجز بعد.",
  ckb: "هێشتا هیچ داواکارییەکی حجز نییە.",
} as const;

export default async function OwnerEarningsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const returnTo = `/${locale}/owner/earnings`;
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
    !account.context ||
    account.context.role !== "cottage_owner" ||
    account.context.approvalState !== "approved"
  )
    return (
      <AccountAccessRecovery
        locale={locale}
        status="denied"
        returnTo={returnTo}
      />
    );
  let items;
  let totals;
  try {
    items = await loadBookingHistory("cottage_owner");
    if (items)
      totals = ownerBookingEarningsTotals(
        items.map((item) =>
          ownerBookingEarnings(item.ownerEarnings ?? { status: "unavailable" }),
        ),
      );
  } catch (error) {
    unstable_rethrow(error);
    console.error("Owner Earnings load failed", {
      code: "owner_earnings_failed",
    });
  }
  if (!items || !totals)
    return (
      <AccountAccessRecovery
        locale={locale}
        status="unavailable"
        returnTo={returnTo}
      />
    );
  return (
    <main className="results-page page page-record">
      <BackofficeNavigation locale={locale} area="owner" current="earnings" />
      <header className="page-heading">
        <h1 className="page-title">
          {accessMessages[locale].ownerEarningsTab}
        </h1>
      </header>
      <section className="owner-earnings">
        <OwnerBookingEarningsSummary locale={locale} totals={totals} />
        {items.length === 0 ? (
          <div className="empty-state">
            <p>{empty[locale]}</p>
            <ActionLink kind="secondary" href={`/${locale}/owner/cottages`}>
              {accessMessages[locale].manageCottages}
            </ActionLink>
          </div>
        ) : (
          <BookingHistoryList items={items} locale={locale} showOwnerEarnings />
        )}
      </section>
    </main>
  );
}
