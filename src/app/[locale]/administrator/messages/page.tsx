import { notFound, unstable_rethrow } from "next/navigation";

import { requireRequestAccount } from "@/access/request-account-context";
import { AccountAccessRecovery } from "@/components/account-access-recovery";
import { MessagingModeration } from "@/components/messaging-moderation";
import { isLocale } from "@/i18n/routing";
import { createRequestMessagingRuntime } from "@/messaging/request-messaging-runtime";
import type { MessagingModeration as MessagingModerationResult } from "@/messaging/supabase-messaging-reader";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function AdministratorMessagingPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ locale: string }>;
  readonly searchParams: Promise<{
    at?: string | string[];
    id?: string | string[];
    type?: string | string[];
  }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  const cursorType =
    query.type === "blocked" || query.type === "translation-report"
      ? query.type
      : undefined;
  const cursor: MessagingModerationResult["nextCursor"] | undefined =
    typeof query.at === "string" &&
    !Number.isNaN(Date.parse(query.at)) &&
    typeof query.id === "string" &&
    uuid.test(query.id) &&
    cursorType
      ? { at: query.at, id: query.id, type: cursorType }
      : undefined;
  if ((query.at || query.id || query.type) && !cursor) notFound();
  const returnTo = `/${locale}/administrator/messages`;
  const account = await requireRequestAccount(
    locale,
    `/${locale}/administrator/access`,
  );
  if (
    account.status === "unavailable" ||
    account.context?.role !== "platform_administrator"
  ) {
    return (
      <AccountAccessRecovery
        locale={locale}
        status={account.status === "unavailable" ? "unavailable" : "denied"}
        returnTo={returnTo}
      />
    );
  }
  let moderation: MessagingModerationResult;
  try {
    const runtime = await createRequestMessagingRuntime();
    if (!runtime.enabled) throw new Error("disabled");
    moderation = await runtime.reader.getModeration({
      limit: 50,
      cursor,
    });
  } catch (error) {
    unstable_rethrow(error);
    return (
      <AccountAccessRecovery
        locale={locale}
        status="denied"
        returnTo={returnTo}
      />
    );
  }
  return (
    <main className="results-page">
      <MessagingModeration locale={locale} moderation={moderation} />
    </main>
  );
}
