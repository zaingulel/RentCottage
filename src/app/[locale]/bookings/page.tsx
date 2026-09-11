import { requireRequestAccount } from "@/access/request-account-context";
import { AccountAccessRecovery } from "@/components/account-access-recovery";
import { accessMessages } from "@/i18n/access-messages";
import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";
import { loadConfirmedBookingHistory } from "@/booking-request/request-confirmed-booking-history";
import { formatIraqDateTime } from "@/i18n/format";
import { isLocale } from "@/i18n/routing";
const copy = {
  en: {
    empty: "No confirmed bookings yet.",
    home: "RentCottage home",
  },
  ar: {
    empty: "لا توجد حجوزات مؤكدة بعد.",
    home: "العودة إلى RentCottage",
  },
  ckb: {
    empty: "هێشتا هیچ حجزێکی پشتڕاستکراو نییە.",
    home: "گەڕانەوە بۆ RentCottage",
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
    !account.context ||
    account.context.role === "platform_administrator" ||
    (workspace === "owner" &&
      (account.context.role !== "cottage_owner" ||
        account.context.approvalState !== "approved"))
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
  let items;
  try {
    items = (await loadConfirmedBookingHistory())?.filter(
      (item) =>
        item.actorRole ===
        (workspace === "owner" ? "cottage_owner" : "customer"),
    );
  } catch (error) {
    unstable_rethrow(error);
    console.error("Booking History load failed", {
      code: "booking_history_failed",
    });
  }
  if (!items)
    return (
      <AccountAccessRecovery
        locale={locale}
        status="unavailable"
        returnTo={returnTo}
      />
    );
  return (
    <main className="results-page">
      <section className="booking-history">
        <header>
          <Link href={`/${locale}`}>{copy[locale].home}</Link>
          <h1>{title}</h1>
        </header>
        <p>{accessMessages[locale].confirmedOnly}</p>
        {items.length === 0 ? (
          <p>{copy[locale].empty}</p>
        ) : (
          <ul>
            {items.map((item) => (
              <li key={item.receiptId}>
                <Link
                  href={
                    item.actorRole === "customer"
                      ? `/${locale}/booking-requests/${item.bookingRequestReference}`
                      : `/${locale}/owner/booking-requests/${item.bookingRequestReference}`
                  }
                >
                  <strong>{item.cottageName}</strong>
                  <span>{item.bookingReference}</span>
                  <time dateTime={item.confirmedAt}>
                    {formatIraqDateTime(item.confirmedAt, locale)}
                  </time>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
