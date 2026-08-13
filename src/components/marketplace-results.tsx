"use client";

import Image from "next/image";

import { cottages } from "@/data/cottages";
import type {
  AmenityKey,
  AreaKey,
  BookingPeriodOption,
} from "@/domain/discovery";
import { formatIqd } from "@/i18n/format";
import { messages } from "@/i18n/messages";
import type { Locale } from "@/i18n/routing";
import { useRoutedLocale } from "@/i18n/use-routed-locale";

import { LocaleButtons } from "./locale-buttons";

export function MarketplaceResults({
  initialLocale,
  search,
}: {
  initialLocale: Locale;
  search: {
    area: AreaKey | "all";
    arrival: string;
    period: BookingPeriodOption;
    guests: string;
    amenities: AmenityKey[];
  };
}) {
  const { locale, changeLocale } = useRoutedLocale(initialLocale);
  const copy = messages[locale];
  const guestCount = Number.parseInt(search.guests, 10) || 1;
  const matchingCottages = cottages.filter(
    (cottage) =>
      (search.area === "all" || cottage.areaKey === search.area) &&
      cottage.capacity >= guestCount &&
      search.amenities.every((amenity) => cottage.amenities.includes(amenity)),
  );

  return (
    <main className="results-page">
      <header className="results-header">
        <a href={`/${locale}`}>{copy.backToSearch}</a>
        <LocaleButtons
          className="results-languages"
          locale={locale}
          onChange={changeLocale}
        />
      </header>
      <section className="results-intro">
        <p>{copy.tagline}</p>
        <h1>{copy.resultsTitle}</h1>
        <span>{copy.resultsSubtitle}</span>
        <div className="search-summary" aria-label={copy.searchSummary}>
          {[
            search.arrival,
            copy.bookingPeriods[search.period],
            `${search.guests} ${copy.guestsUnit}`,
          ]
            .filter(Boolean)
            .map((value) => (
              <span key={value}>{value}</span>
            ))}
        </div>
      </section>
      <section className="results-grid" aria-label={copy.resultsTitle}>
        {matchingCottages.map((result) => (
          <article key={result.slug}>
            <div className="result-image">
              <Image
                src={`/uploads/${result.image}`}
                alt={result.name[locale]}
                fill
                sizes="(min-width: 900px) 33vw, 100vw"
              />
            </div>
            <div className="result-content">
              <h2>{result.name[locale]}</h2>
              <p>
                {copy.approximateArea}: {result.area[locale]}
              </p>
              <div>
                <strong>{formatIqd(result.price, locale)}</strong>
                <span>{copy.samplePrice}</span>
              </div>
              <a href={`/${locale}/cottages/${result.slug}`}>
                {copy.viewCottage}
              </a>
            </div>
          </article>
        ))}
      </section>
      {matchingCottages.length === 0 ? (
        <p className="empty-results">{copy.noResults}</p>
      ) : null}
      <p className="fictional-note">{copy.fictionalNote}</p>
    </main>
  );
}
