import { notFound } from "next/navigation";

import { MarketplaceResults } from "@/components/marketplace-results";
import {
  isAmenityKey,
  isAreaKey,
  isBookingPeriodOption,
} from "@/domain/discovery";
import { isLocale } from "@/i18n/routing";

function positiveInteger(
  value: string | string[] | undefined,
  fallback: string,
) {
  if (typeof value !== "string") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? String(parsed) : fallback;
}

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
        area:
          typeof query.area === "string" && isAreaKey(query.area)
            ? query.area
            : "all",
        arrival: typeof query.arrival === "string" ? query.arrival : "",
        period:
          typeof query.period === "string" &&
          isBookingPeriodOption(query.period)
            ? query.period
            : "full-day",
        guests: positiveInteger(query.guests, "4"),
        amenities: (Array.isArray(query.amenity)
          ? query.amenity
          : query.amenity
            ? [query.amenity]
            : []
        ).filter(isAmenityKey),
      }}
    />
  );
}
