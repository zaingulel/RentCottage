import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";
import { loadConfirmedBookingHistory } from "@/booking-request/request-confirmed-booking-history";
import { formatIraqDateTime } from "@/i18n/format";
import { isLocale } from "@/i18n/routing";
const copy = {
  en: {
    title: "Booking History",
    empty: "No confirmed bookings yet.",
    home: "RentCottage home",
  },
  ar: {
    title: "سجل الحجوزات",
    empty: "لا توجد حجوزات مؤكدة بعد.",
    home: "العودة إلى RentCottage",
  },
  ckb: {
    title: "مێژووی حجزەکان",
    empty: "هێشتا هیچ حجزێکی پشتڕاستکراو نییە.",
    home: "گەڕانەوە بۆ RentCottage",
  },
} as const;
export default async function BookingHistoryPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  let items;
  try {
    items = await loadConfirmedBookingHistory();
  } catch (error) {
    unstable_rethrow(error);
    console.error("Booking History load failed", {
      code: "booking_history_failed",
    });
  }
  if (!items)
    return (
      <main className="results-page">
        <section role="alert">
          <h1>{copy[locale].title}</h1>
          <Link href={`/${locale}`}>{copy[locale].home}</Link>
        </section>
      </main>
    );
  return (
    <main className="results-page">
      <section className="booking-history">
        <header>
          <Link href={`/${locale}`}>{copy[locale].home}</Link>
          <h1>{copy[locale].title}</h1>
        </header>
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
