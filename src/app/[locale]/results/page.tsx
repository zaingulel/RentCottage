import { notFound } from "next/navigation";

import { MarketplaceResults } from "@/components/marketplace-results";
import { isLocale } from "@/i18n/routing";

export default async function ResultsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  if (!isLocale(locale)) notFound();

  return (
    <MarketplaceResults
      initialLocale={locale}
      search={{
        area: typeof query.area === "string" ? query.area : "all",
        arrival: typeof query.arrival === "string" ? query.arrival : "",
        nights: typeof query.nights === "string" ? query.nights : "2",
        guests: typeof query.guests === "string" ? query.guests : "4",
        amenities: Array.isArray(query.amenity)
          ? query.amenity
          : query.amenity
            ? [query.amenity]
            : [],
      }}
    />
  );
}
