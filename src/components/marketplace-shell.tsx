"use client";

import Image from "next/image";
import { useState } from "react";

import { cottages } from "@/data/cottages";
import {
  amenityKeys,
  bookingPeriodOptions,
  type AmenityKey,
  type BookingPeriodOption,
} from "@/domain/discovery";
import { messages } from "@/i18n/messages";
import type { Locale } from "@/i18n/routing";
import { useRoutedLocale } from "@/i18n/use-routed-locale";

import { LocaleButtons } from "./locale-buttons";

interface MarketplaceShellProps {
  initialLocale: Locale;
}

function iraqToday() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Baghdad",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function MarketplaceShell({ initialLocale }: MarketplaceShellProps) {
  const { locale, changeLocale } = useRoutedLocale(initialLocale);
  const [area, setArea] = useState("all");
  const [minimumArrival] = useState(iraqToday);
  const [arrival, setArrival] = useState(iraqToday);
  const [period, setPeriod] = useState<BookingPeriodOption>("full-day");
  const [guests, setGuests] = useState(4);
  const [selectedAmenities, setSelectedAmenities] = useState<AmenityKey[]>([]);
  const copy = messages[locale];

  function toggleAmenity(amenity: AmenityKey) {
    setSelectedAmenities((current) =>
      current.includes(amenity)
        ? current.filter((item) => item !== amenity)
        : [...current, amenity],
    );
  }

  return (
    <div className="marketplace-shell">
      <section className="retreat-hero">
        <Image
          className="retreat-hero-image"
          src="/uploads/hero-retreat.png"
          alt="A rural house at sunset in Iraq"
          fill
          priority
          unoptimized
          sizes="100vw"
        />
        <div className="retreat-shade" />
        <div className="retreat-utility">
          <a className="retreat-brand" href={`/${locale}`}>
            <strong>{copy.brand}</strong>
            <span>{copy.tagline}</span>
          </a>
          <LocaleButtons
            className="language-switcher"
            locale={locale}
            onChange={changeLocale}
          />
        </div>
        <div className="retreat-copy">
          <h1>{copy.heroTitle}</h1>
          <p>{copy.heroSubtitle}</p>
        </div>
      </section>

      <main>
        <form className="retreat-search" action={`/${locale}/results`}>
          <div className="search-fields">
            <label>
              <span>{copy.areaLabel}</span>
              <select
                name="area"
                value={area}
                onChange={(event) => setArea(event.target.value)}
              >
                <option value="all">{copy.allAreas}</option>
                {copy.areas.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{copy.arrivalLabel}</span>
              <input
                name="arrival"
                type="date"
                min={minimumArrival || undefined}
                value={arrival}
                onChange={(event) => setArrival(event.target.value)}
              />
            </label>
            <label>
              <span>{copy.bookingPeriodLabel}</span>
              <select
                name="period"
                value={period}
                onChange={(event) =>
                  setPeriod(event.target.value as BookingPeriodOption)
                }
              >
                {bookingPeriodOptions.map((option) => (
                  <option key={option} value={option}>
                    {copy.bookingPeriods[option]}
                  </option>
                ))}
              </select>
            </label>
            <Counter
              label={copy.guestsLabel}
              value={guests}
              minimum={1}
              onChange={setGuests}
            />
          </div>

          <fieldset className="amenity-filter">
            <legend>{copy.amenitiesLabel}</legend>
            <div>
              {amenityKeys.map((amenity) => {
                const selected = selectedAmenities.includes(amenity);
                return (
                  <button
                    key={amenity}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleAmenity(amenity)}
                  >
                    {copy.amenityNames[amenity]}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <input type="hidden" name="guests" value={guests} />
          {selectedAmenities.map((amenity) => (
            <input key={amenity} type="hidden" name="amenity" value={amenity} />
          ))}
          <button className="search-cta" type="submit">
            {copy.searchCta}
          </button>
        </form>

        <p className="retreat-blurb">{copy.retreatBlurb}</p>

        <section className="cottage-preview" aria-labelledby="preview-title">
          <div className="section-heading">
            <div>
              <p>{copy.selectedCottages}</p>
              <h2 id="preview-title">{copy.cottagePreviewTitle}</h2>
            </div>
            <div className="lattice-mark" aria-hidden="true" />
          </div>
          <div className="preview-grid">
            {cottages.map((cottage) => (
              <article key={cottage.image}>
                <Image
                  src={`/uploads/${cottage.image}`}
                  alt=""
                  width={640}
                  height={420}
                />
                <span>{cottage.name[locale]}</span>
              </article>
            ))}
          </div>
        </section>

        <section className="trusted-booking">
          <div className="trusted-photo">
            <Image
              src="/uploads/hero-marsh.png"
              alt="A peaceful rural cottage among palm trees"
              fill
              sizes="(min-width: 900px) 45vw, 100vw"
            />
          </div>
          <div className="trusted-copy">
            <p>{copy.tagline}</p>
            <h2>{copy.trustedTitle}</h2>
            <p>{copy.trustedSubtitle}</p>
            <ol>
              {copy.steps.map((step, index) => (
                <li key={step}>
                  <b>{index + 1}</b>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <p className="fictional-note">{copy.fictionalNote}</p>
      </main>
    </div>
  );
}

interface CounterProps {
  label: string;
  value: number;
  minimum: number;
  onChange: (value: number) => void;
}

function Counter({ label, value, minimum, onChange }: CounterProps) {
  return (
    <div className="counter-field">
      <span>{label}</span>
      <div>
        <button
          type="button"
          aria-label={`Decrease ${label}`}
          onClick={() => onChange(Math.max(minimum, value - 1))}
        >
          −
        </button>
        <strong>{value}</strong>
        <button
          type="button"
          aria-label={`Increase ${label}`}
          onClick={() => onChange(value + 1)}
        >
          +
        </button>
      </div>
    </div>
  );
}
