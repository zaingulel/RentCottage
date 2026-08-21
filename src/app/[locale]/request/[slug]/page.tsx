import { notFound } from "next/navigation";

import { SupabaseAccountContextStore } from "@/access/supabase-account-access";
import { createRequestSupabaseClient } from "@/access/supabase-server";
import { loadPublicBookingQuote } from "@/booking-quote/request-booking-quote";
import { isPublicCottageSlug } from "@/booking-quote/booking-quote";
import {
  bookingRequestAcceptanceEvidence,
  bookingRequestUiPolicy,
} from "@/booking-request/booking-request-policy";
import { BookingQuoteView } from "@/components/booking-quote";
import { InvalidCottageSearch } from "@/components/invalid-cottage-search";
import {
  parseCottageDiscoveryQuery,
  preserveRawCottageDiscoveryQuery,
  serializeCottageDiscoveryQuery,
} from "@/cottage-discovery/discovery-query";
import { isLocale } from "@/i18n/routing";

export default async function RequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  if (!isPublicCottageSlug(slug)) return notFound();
  const rawQuery = await searchParams;
  if (Object.keys(rawQuery).length === 0) notFound();
  const parsed = parseCottageDiscoveryQuery(rawQuery);
  if (parsed.status === "invalid") {
    return (
      <InvalidCottageSearch
        locale={locale}
        path={`/request/${slug}`}
        queryString={preserveRawCottageDiscoveryQuery(rawQuery)}
      />
    );
  }
  const result = await loadPublicBookingQuote(locale, slug, parsed.query);
  if (result.status === "not-found") notFound();
  let customerReady = false;
  let customerAccessUnavailable = false;
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
      customerReady = context?.role === "customer";
    } catch {
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
    />
  );
}
