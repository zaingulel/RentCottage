import Link from "next/link";
import { notFound } from "next/navigation";

import { readAdministratorBookingMoney } from "@/administrator-records/supabase-administrator-booking-money";
import { AdministratorBookingMoney } from "@/components/administrator-booking-money";
import { BackofficeNavigation } from "@/components/backoffice-navigation";
import { ActionFeedback } from "@/components/interaction-controls";
import {
  bookingMoneyExportErrors,
  type BookingMoneyExportError,
} from "@/i18n/administrator-booking-money-export-messages";
import { administratorRecordsMessages } from "@/i18n/administrator-records-messages";
import { administratorTotalsMessages } from "@/i18n/administrator-totals-messages";
import { isLocale } from "@/i18n/routing";

const queryKeys = ["state", "from", "through", "afterAt", "afterId"] as const;

export default async function AdministratorTotalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  if (
    Object.entries(query).some(
      ([key, value]) =>
        !([...queryKeys, "exportError"] as readonly string[]).includes(key) ||
        typeof value !== "string",
    )
  )
    notFound();

  const { exportError, ...selection } = query;
  if (
    exportError !== undefined &&
    !(bookingMoneyExportErrors as readonly string[]).includes(
      exportError as string,
    )
  )
    notFound();
  const outcome = await readAdministratorBookingMoney(selection);
  const title = administratorTotalsMessages[locale].title;
  const records = administratorRecordsMessages[locale];

  if (outcome.status === "access_required")
    return (
      <main className="owner-application-page access-required-page">
        <section className="access-required-card">
          <h1>{title}</h1>
          <p>{records.accessRequired}</p>
          <Link href={`/${locale}/administrator/access`}>{records.signIn}</Link>
        </section>
      </main>
    );
  if (outcome.status === "unavailable")
    return (
      <main className="results-page page">
        <h1 className="page-title">{title}</h1>
        <ActionFeedback kind="error">{records.unavailable}</ActionFeedback>
      </main>
    );

  const text = (key: (typeof queryKeys)[number]) => {
    const value = query[key];
    return typeof value === "string" ? value : "";
  };
  return (
    <main className="results-page page">
      <BackofficeNavigation
        locale={locale}
        area="administrator"
        current="totals"
      />
      <h1 className="page-title">{title}</h1>
      <AdministratorBookingMoney
        locale={locale}
        exportError={exportError as BookingMoneyExportError | undefined}
        filters={{
          state: text("state"),
          from: text("from"),
          through: text("through"),
        }}
        outcome={
          outcome.status === "ready" || outcome.status === "too_many"
            ? outcome
            : { status: "invalid" }
        }
      />
    </main>
  );
}
