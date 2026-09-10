import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";

import { loadCustomerBookingRequest } from "@/booking-request/request-customer-booking-request";
import { loadConfirmedBookingAccess } from "@/booking-request/request-confirmed-booking-access";
import { CustomerBookingRequestStatus } from "@/components/customer-booking-request-status";
import { ConfirmedBookingDetails } from "@/components/confirmed-booking-details";
import { isLocale } from "@/i18n/routing";

const unavailableCopy = {
  en: {
    title: "Booking Request status is unavailable",
    home: "RentCottage home",
  },
  ar: { title: "حالة طلب الحجز غير متاحة", home: "العودة إلى RentCottage" },
  ckb: {
    title: "دۆخی داواکاری حجز بەردەست نییە",
    home: "گەڕانەوە بۆ RentCottage",
  },
} as const;

export default async function CustomerBookingRequestPage({
  params,
}: {
  params: Promise<{ locale: string; reference: string }>;
}) {
  const { locale, reference } = await params;
  if (!isLocale(locale) || !/^RC-REQ-[A-F0-9]{16}$/.test(reference)) notFound();
  let confirmed;
  try {
    confirmed = await loadConfirmedBookingAccess(reference);
  } catch (error) {
    unstable_rethrow(error);
    console.error("Customer confirmed Booking load failed", {
      code: "customer_confirmed_booking_failed",
    });
    return (
      <main className="results-page">
        <section role="alert">
          <h1>{unavailableCopy[locale].title}</h1>
          <Link href={`/${locale}`}>{unavailableCopy[locale].home}</Link>
        </section>
      </main>
    );
  }
  if (
    confirmed?.access.actorRole !== undefined &&
    confirmed.access.actorRole !== "customer"
  )
    notFound();
  if (confirmed)
    return (
      <main className="results-page">
        <ConfirmedBookingDetails locale={locale} {...confirmed} />
      </main>
    );
  let request;
  try {
    request = await loadCustomerBookingRequest(reference);
  } catch (error) {
    unstable_rethrow(error);
    console.error("Customer Booking Request status failed", {
      code: "customer_booking_request_status_failed",
    });
  }
  if (request === null) notFound();
  if (!request)
    return (
      <main className="results-page">
        <section role="alert">
          <h1>{unavailableCopy[locale].title}</h1>
          <Link href={`/${locale}`}>{unavailableCopy[locale].home}</Link>
        </section>
      </main>
    );
  return (
    <main className="results-page">
      <CustomerBookingRequestStatus locale={locale} request={request} />
    </main>
  );
}
