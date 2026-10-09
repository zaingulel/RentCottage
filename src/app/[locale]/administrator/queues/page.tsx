import Link from "next/link";
import { notFound } from "next/navigation";

import { administratorQueues } from "@/administrator-records/administrator-records";
import { loadAdministratorQueue } from "@/administrator-records/supabase-administrator-records";
import { AdministratorQueues } from "@/components/administrator-queues";
import { BackofficeNavigation } from "@/components/backoffice-navigation";
import { ActionFeedback } from "@/components/interaction-controls";
import { administratorQueuesMessages } from "@/i18n/administrator-queues-messages";
import { administratorRecordsMessages } from "@/i18n/administrator-records-messages";
import { isLocale } from "@/i18n/routing";

const queryKeys = [
  "queue",
  "state",
  "from",
  "through",
  "afterAt",
  "afterId",
] as const;

export default async function AdministratorQueuesPage({
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
        !(queryKeys as readonly string[]).includes(key) ||
        typeof value !== "string",
    )
  )
    notFound();

  const outcome = await loadAdministratorQueue(query);
  const title = administratorQueuesMessages[locale].title;
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
        current="queues"
      />
      <h1 className="page-title">{title}</h1>
      <AdministratorQueues
        locale={locale}
        filters={{
          queue:
            administratorQueues.find((queue) => queue === query.queue) ??
            "requests",
          state: text("state"),
          from: text("from"),
          through: text("through"),
        }}
        outcome={outcome.status === "ready" ? outcome : { status: "invalid" }}
      />
    </main>
  );
}
