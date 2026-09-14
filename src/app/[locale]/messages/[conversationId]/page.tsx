import { notFound, unstable_rethrow } from "next/navigation";

import { requireRequestAccount } from "@/access/request-account-context";
import { AccountAccessRecovery } from "@/components/account-access-recovery";
import { MessagingConversation } from "@/components/messaging-conversation";
import { isLocale } from "@/i18n/routing";
import { createRequestMessagingRuntime } from "@/messaging/request-messaging-runtime";
import type { MessagingConversation as ConversationData } from "@/messaging/supabase-messaging-reader";
import {
  parseCottageDiscoveryQuery,
  serializeCottageDiscoveryQuery,
} from "@/cottage-discovery/discovery-query";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function MessagingConversationPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ locale: string; conversationId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, conversationId } = await params;
  if (!isLocale(locale) || !uuid.test(conversationId)) notFound();
  const query = await searchParams;
  const rawBefore = query.before;
  const before =
    typeof rawBefore === "string" &&
    /^\d+$/.test(rawBefore) &&
    Number.isSafeInteger(Number(rawBefore)) &&
    Number(rawBefore) > 0
      ? Number(rawBefore)
      : undefined;
  if (rawBefore !== undefined && before === undefined) notFound();
  const discoveryRaw = { ...query };
  delete discoveryRaw.before;
  const hasDiscovery = Object.keys(discoveryRaw).length > 0;
  const parsedDiscovery = hasDiscovery
    ? parseCottageDiscoveryQuery(discoveryRaw)
    : null;
  if (parsedDiscovery?.status === "invalid") notFound();
  const contextQuery =
    parsedDiscovery?.status === "loaded"
      ? serializeCottageDiscoveryQuery(parsedDiscovery.query)
      : undefined;
  const returnQuery = [before ? `before=${before}` : "", contextQuery ?? ""]
    .filter(Boolean)
    .join("&");
  const returnTo = `/${locale}/messages/${conversationId}${returnQuery ? `?${returnQuery}` : ""}`;
  const account = await requireRequestAccount(locale, returnTo);
  if (account.status === "unavailable" || !account.context) {
    return (
      <AccountAccessRecovery
        locale={locale}
        status={account.status === "unavailable" ? "unavailable" : "denied"}
        returnTo={returnTo}
      />
    );
  }
  let conversation: ConversationData;
  try {
    const runtime = await createRequestMessagingRuntime();
    if (!runtime.enabled) throw new Error("disabled");
    conversation = await runtime.reader.getConversation({
      conversationId,
      beforePosition: before,
      limit: 30,
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
      <MessagingConversation
        locale={locale}
        conversation={conversation}
        beforePosition={before}
        contextQuery={contextQuery}
      />
    </main>
  );
}
