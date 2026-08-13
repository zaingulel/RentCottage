"use client";

import Image from "next/image";

import type { Cottage } from "@/data/cottages";
import { journeyMessages } from "@/i18n/journey-messages";
import { messages } from "@/i18n/messages";
import type { Locale } from "@/i18n/routing";
import { useRoutedLocale } from "@/i18n/use-routed-locale";

import { LocaleButtons } from "./locale-buttons";

export function CottageProfile({
  initialLocale,
  cottage,
}: {
  initialLocale: Locale;
  cottage: Cottage;
}) {
  const { locale, changeLocale } = useRoutedLocale(initialLocale);
  const copy = journeyMessages[locale];

  return (
    <main className="profile-page">
      <header className="results-header">
        <a href={`/${locale}/results`}>{copy.backResults}</a>
        <LocaleButtons
          className="results-languages"
          locale={locale}
          onChange={changeLocale}
        />
      </header>
      <div className="profile-layout">
        <div>
          <div className="profile-gallery">
            {cottage.gallery.map((image, index) => (
              <div
                key={image}
                className={index === 0 ? "profile-main-image" : ""}
              >
                <Image
                  src={`/uploads/${image}`}
                  alt={index === 0 ? cottage.name[locale] : ""}
                  fill
                  sizes={
                    index === 0 ? "(min-width: 900px) 65vw, 100vw" : "30vw"
                  }
                />
              </div>
            ))}
          </div>
          <div className="profile-heading">
            <span className="verified-chip">✓ {copy.approvedOwner}</span>
            <h1>{cottage.name[locale]}</h1>
            <p>
              {copy.approximateArea}: {cottage.area[locale]}
            </p>
          </div>
          <dl className="profile-facts">
            <div>
              <dt>{copy.capacity}</dt>
              <dd>{cottage.capacity}</dd>
            </div>
            <div>
              <dt>{copy.bedrooms}</dt>
              <dd>{cottage.bedrooms}</dd>
            </div>
            <div>
              <dt>{copy.bathrooms}</dt>
              <dd>{cottage.bathrooms}</dd>
            </div>
            <div>
              <dt>{copy.nightlyPrice}</dt>
              <dd>IQD {cottage.price.toLocaleString("en-US")}</dd>
            </div>
          </dl>
          <section className="profile-section">
            <h2>{copy.description}</h2>
            <p>{cottage.description[locale]}</p>
          </section>
          <section className="profile-section">
            <h2>{copy.houseRules}</h2>
            <ul>
              {cottage.rules[locale].map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
          </section>
        </div>
        <aside className="booking-summary">
          <p>{messages[locale].tagline}</p>
          <strong>IQD {cottage.price.toLocaleString("en-US")}</strong>
          <span>{copy.nightlyPrice}</span>
          <a href={`/${locale}/request/${cottage.slug}`}>
            {copy.requestBooking}
          </a>
          <small>{copy.requestOnly}</small>
        </aside>
      </div>
    </main>
  );
}
