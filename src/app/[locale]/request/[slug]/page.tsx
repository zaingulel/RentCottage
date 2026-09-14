import { hasCustomerCapability } from "@/access/account-access";
import { notFound, unstable_rethrow } from "next/navigation";

import { SupabaseAccountContextStore } from "@/access/supabase-account-access";
import { createRequestSupabaseClient } from "@/access/supabase-server";
import { loadPublicBookingQuote } from "@/booking-quote/request-booking-quote";
import { isPublicCottageSlug } from "@/booking-quote/booking-quote";
import {
  bookingRequestAcceptanceEvidence,
  bookingRequestUiPolicy,
} from "@/booking-request/booking-request-policy";
import { bookingRequestTestRuntimeIsEnabled } from "@/booking-request/booking-request-test-runtime";
import { BookingQuoteView } from "@/components/booking-quote";
import { InvalidCottageSearch } from "@/components/invalid-cottage-search";
import {
  parseCottageDiscoveryQuery,
  preserveRawCottageDiscoveryQuery,
  serializeCottageDiscoveryQuery,
} from "@/cottage-discovery/discovery-query";
import { isLocale } from "@/i18n/routing";
import { bookingRequestMessages } from "@/i18n/booking-request-messages";
import { messagingEnquiryLabel } from "@/messaging/messaging-enquiry-label";
import { createRequestMessagingRuntime } from "@/messaging/request-messaging-runtime";

export default async function RequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  if (!bookingRequestTestRuntimeIsEnabled()) {
    const copy = bookingRequestMessages[locale];
    return (
      <main className="results-page">
        <section
          className="results-intro"
          role="alert"
          aria-labelledby="booking-request-future-title"
        >
          <h1 id="booking-request-future-title">{copy.futureTitle}</h1>
          <p>{copy.futureBody}</p>
        </section>
      </main>
    );
  }
  if (!isPublicCottageSlug(slug)) return notFound();
  const rawQuery = await searchParams;
  if (Object.keys(rawQuery).length === 0) notFound();
  const selectedConversationId =
    typeof rawQuery.conversation === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      rawQuery.conversation,
    )
      ? rawQuery.conversation
      : undefined;
  if (rawQuery.conversation !== undefined && !selectedConversationId)
    notFound();
  const discoveryRawQuery = { ...rawQuery };
  delete discoveryRawQuery.conversation;
  const parsed = parseCottageDiscoveryQuery(discoveryRawQuery);
  if (parsed.status === "invalid") {
    return (
      <InvalidCottageSearch
        locale={locale}
        path={`/request/${slug}`}
        queryString={preserveRawCottageDiscoveryQuery(discoveryRawQuery)}
      />
    );
  }
  const result = await loadPublicBookingQuote(locale, slug, parsed.query);
  if (result.status === "not-found") notFound();
  let customerReady = false;
  let customerAccessUnavailable = false;
  let enquiryOptions: { conversationId: string; label: string }[] = [];
  const evaluatedAt = new Date().toISOString();
  const uiPolicy =
    result.status === "quoted"
      ? bookingRequestUiPolicy({
          firstStartsAt: result.quote.items[0]?.startsAt ?? "",
          evaluatedAt,
        })
      : null;
  const acceptanceEvidence =
    result.status === "quoted" && uiPolicy
      ? bookingRequestAcceptanceEvidence({
          locale,
          termsVersion: result.quote.termsVersion,
          requiresInside48HourNoRefundAcceptance:
            uiPolicy.requiresInside48HourNoRefundAcceptance,
        })
      : null;
  if (result.status === "quoted") {
    try {
      const context = await new SupabaseAccountContextStore(
        await createRequestSupabaseClient(),
      ).resolve();
      customerReady = hasCustomerCapability(context);
      if (customerReady) {
        const runtime = await createRequestMessagingRuntime();
        if (runtime.enabled) {
          const inbox = await runtime.reader.listConversations({
            limit: 50,
            publicSlug: slug,
          });
          enquiryOptions = inbox.items
            .filter((item) => item.canContinueBookingRequest)
            .map((item) => ({
              conversationId: item.conversationId,
              label: messagingEnquiryLabel(item, locale),
            }));
          if (selectedConversationId) {
            const selected = await runtime.reader.getConversation({
              conversationId: selectedConversationId,
              limit: 1,
            });
            if (
              selected.cottage.publicSlug !== slug ||
              !selected.canContinueBookingRequest
            )
              notFound();
            if (
              !enquiryOptions.some(
                (item) => item.conversationId === selectedConversationId,
              )
            ) {
              enquiryOptions.push({
                conversationId: selected.conversationId,
                label: messagingEnquiryLabel(selected, locale),
              });
            }
          }
        }
      }
    } catch (error) {
      unstable_rethrow(error);
      customerAccessUnavailable = true;
      console.error("Booking Request Customer access check failed", {
        phase: "booking_request_customer_access",
        result: "unavailable",
      });
    }
  }
  return (
    <BookingQuoteView
      locale={locale}
      slug={slug}
      queryString={serializeCottageDiscoveryQuery(parsed.query)}
      result={result}
      discoveryQuery={parsed.query}
      idempotencyKey={crypto.randomUUID()}
      customerReady={customerReady}
      customerAccessUnavailable={customerAccessUnavailable}
      bookingRequestUiPolicy={uiPolicy}
      bookingRequestAcceptanceEvidence={acceptanceEvidence}
      enquiryOptions={enquiryOptions}
      selectedConversationId={selectedConversationId}
    />
  );
}
