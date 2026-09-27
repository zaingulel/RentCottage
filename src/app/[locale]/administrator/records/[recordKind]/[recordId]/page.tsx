import { notFound } from "next/navigation";

import { loadAdministratorRecord } from "@/administrator-records/supabase-administrator-records";
import { AdministratorRecordDetailView } from "@/components/administrator-records";
import { ActionFeedback, ActionLink } from "@/components/interaction-controls";
import { administratorRecordsMessages } from "@/i18n/administrator-records-messages";
import { isLocale } from "@/i18n/routing";

export default async function AdministratorRecordDetailPage({
  params,
}: {
  params: Promise<{ locale: string; recordKind: string; recordId: string }>;
}) {
  const { locale, recordKind, recordId } = await params;
  if (!isLocale(locale)) notFound();
  const result = await loadAdministratorRecord(recordKind, recordId);
  if (result.status === "invalid") notFound();
  if (result.status === "ready")
    return (
      <main className="owner-application-page">
        <AdministratorRecordDetailView locale={locale} record={result.record} />
      </main>
    );
  const copy = administratorRecordsMessages[locale];
  return (
    <main className="owner-application-page access-required-page">
      <section className="access-required-card">
        <h1>{copy.title}</h1>
        {result.status === "access_required" ? (
          <ActionFeedback kind="error">{copy.accessRequired}</ActionFeedback>
        ) : result.status === "not_found" ? (
          <ActionFeedback kind="error">{copy.notFound}</ActionFeedback>
        ) : (
          <ActionFeedback kind="error">{copy.unavailable}</ActionFeedback>
        )}
        <ActionLink
          kind="text"
          href={
            result.status === "access_required"
              ? `/${locale}/administrator/access`
              : `/${locale}/administrator/records`
          }
        >
          {result.status === "access_required" ? copy.signIn : copy.back}
        </ActionLink>
      </section>
    </main>
  );
}
