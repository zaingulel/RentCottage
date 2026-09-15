import { messagingEnquiryLabel } from "@/messaging/messaging-enquiry-label";
import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";

import { requireRequestAccount } from "@/access/request-account-context";
import { AccountAccessRecovery } from "@/components/account-access-recovery";
import { MessagingInbox } from "@/components/messaging-inbox";
import { MessagingStart } from "@/components/messaging-start";
import { messagingMessages } from "@/i18n/messaging-messages";
import { isLocale } from "@/i18n/routing";
import { createRequestMessagingRuntime } from "@/messaging/request-messaging-runtime";
import type { SupabaseMessagingReader } from "@/messaging/supabase-messaging-reader";
import {
  parseCottageDiscoveryQuery,
  serializeCottageDiscoveryQuery,
} from "@/cottage-discovery/discovery-query";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const publicSlug = /^cottage-[0-9a-f]{32}$/;

export default async function MessagesPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  const activityAt =
    typeof query.activityAt === "string" &&
    !Number.isNaN(Date.parse(query.activityAt))
      ? query.activityAt
      : undefined;
  const conversationId =
    typeof query.conversationId === "string" && uuid.test(query.conversationId)
      ? query.conversationId
      : undefined;
  const cottage =
    typeof query.cottage === "string" && publicSlug.test(query.cottage)
      ? query.cottage
      : undefined;
  if ((activityAt && !conversationId) || (!activityAt && conversationId))
    notFound();
  if (query.cottage !== undefined && !cottage) notFound();
  const discoveryRaw = { ...query };
  delete discoveryRaw.activityAt;
  delete discoveryRaw.conversationId;
  delete discoveryRaw.cottage;
  const hasDiscovery = Object.keys(discoveryRaw).length > 0;
  const parsedDiscovery = hasDiscovery
    ? parseCottageDiscoveryQuery(discoveryRaw)
    : null;
  if (parsedDiscovery?.status === "invalid" || (hasDiscovery && !cottage))
    notFound();
  const contextQuery =
    parsedDiscovery?.status === "loaded"
      ? serializeCottageDiscoveryQuery(parsedDiscovery.query)
      : undefined;
  const returnQuery = cottage
    ? `cottage=${cottage}${contextQuery ? `&${contextQuery}` : ""}`
    : "";
  const returnTo = `/${locale}/messages${returnQuery ? `?${returnQuery}` : ""}`;
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
  let page: Awaited<ReturnType<SupabaseMessagingReader["listConversations"]>>;
  try {
    const runtime = await createRequestMessagingRuntime();
    if (!runtime.enabled) throw new Error("disabled");
    page = await runtime.reader.listConversations({
      cursor:
        activityAt && conversationId
          ? { activityAt, conversationId }
          : undefined,
      limit: 20,
      publicSlug: cottage,
    });
  } catch (error) {
    unstable_rethrow(error);
    return (
      <AccountAccessRecovery
        locale={locale}
        status="unavailable"
        returnTo={returnTo}
      />
    );
  }
  const related = cottage ? page.items : [];
  return (
    <main className="results-page">
      {cottage && account.context.role !== "platform_administrator" ? (
        <section className="messaging-shell">
          <h1>{messagingMessages[locale].messageCottage}</h1>
          {related.length ? (
            <ul>
              {related.map((item) => (
                <li key={item.conversationId}>
                  <Link
                    href={`/${locale}/messages/${item.conversationId}${contextQuery ? `?${contextQuery}` : ""}`}
                  >
                    {messagingMessages[locale].continueEnquiry}:{" "}
                    {messagingEnquiryLabel(item, locale)}
                  </Link>
                  {contextQuery && item.canContinueBookingRequest ? (
                    <Link
                      href={`/${locale}/request/${cottage}?${contextQuery}&conversation=${item.conversationId}`}
                    >
                      {messagingMessages[locale].booking}
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          <MessagingStart
            locale={locale}
            publicSlug={cottage}
            contextQuery={contextQuery}
          />
        </section>
      ) : null}
      <MessagingInbox
        locale={locale}
        items={page.items}
        nextCursor={page.nextCursor}
        publicSlug={cottage}
        contextQuery={contextQuery}
      />
    </main>
  );
}
