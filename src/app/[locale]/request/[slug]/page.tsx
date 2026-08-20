import { notFound } from "next/navigation";

import { loadPublicBookingQuote } from "@/booking-quote/request-booking-quote";
import { isPublicCottageSlug } from "@/booking-quote/booking-quote";
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
  return (
    <BookingQuoteView
      locale={locale}
      slug={slug}
      queryString={serializeCottageDiscoveryQuery(parsed.query)}
      result={result}
    />
  );
}
