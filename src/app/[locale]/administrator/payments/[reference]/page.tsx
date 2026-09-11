import { loadBookingFinancialView } from "@/booking-request/request-booking-financial-view";
import { BookingFinancialDetails } from "@/components/booking-financial-details";
import { bookingManagementMessages } from "@/i18n/booking-management-messages";
import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";

import { loadAdministratorPaymentHistory } from "@/booking-request/request-administrator-payment-history";
import { AdministratorPaymentHistoryView } from "@/components/administrator-payment-history";
import { administratorPaymentHistoryMessages } from "@/i18n/administrator-payment-history-messages";
import { isLocale } from "@/i18n/routing";

export default async function AdministratorPaymentHistoryPage({
  params,
}: {
  params: Promise<{ locale: string; reference: string }>;
}) {
  const { locale, reference } = await params;
  if (!isLocale(locale)) notFound();
  const copy = administratorPaymentHistoryMessages[locale];
  let result:
    | Awaited<ReturnType<typeof loadAdministratorPaymentHistory>>
    | undefined;
  try {
    result = await loadAdministratorPaymentHistory(reference);
  } catch (error) {
    unstable_rethrow(error);
    console.error("Administrator payment history load failed", {
      phase: "administrator_payment_history_load",
      result: "unavailable",
    });
  }
  if (result?.status === "not_found") notFound();
  if (!result || result.status === "access_required") {
    return (
      <main className="owner-application-page access-required-page">
        <section
          className="access-required-card"
          role={!result ? "alert" : undefined}
        >
          <h1>{copy.title}</h1>
          <p>{result ? copy.accessRequired : copy.unavailable}</p>
          {result ? (
            <Link href={`/${locale}/administrator/access`}>
              {copy.accessAction}
            </Link>
          ) : null}
        </section>
      </main>
    );
  }
  let financial;
  let financialUnavailable = false;
  try {
    financial = await loadBookingFinancialView(
      reference,
      "platform_administrator",
    );
  } catch (error) {
    unstable_rethrow(error);
    financialUnavailable = true;
  }
  return (
    <main className="owner-application-page payment-history-page">
      <header className="owner-application-header">
        <Link href={`/${locale}/administrator/payments`}>{copy.back}</Link>
        <span>{copy.eyebrow}</span>
      </header>
      {financial ? (
        <BookingFinancialDetails locale={locale} view={financial} />
      ) : financialUnavailable ? (
        <p role="alert">{bookingManagementMessages[locale].unavailableView}</p>
      ) : null}
      <AdministratorPaymentHistoryView
        locale={locale}
        history={result.history}
      />
    </main>
  );
}
