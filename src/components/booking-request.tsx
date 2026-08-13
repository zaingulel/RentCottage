"use client";

import Image from "next/image";
import { useState } from "react";

import type { Cottage } from "@/data/cottages";
import { journeyMessages } from "@/i18n/journey-messages";
import type { Locale } from "@/i18n/routing";
import { useRoutedLocale } from "@/i18n/use-routed-locale";

import { LocaleButtons } from "./locale-buttons";

export function BookingRequest({
  initialLocale,
  cottage,
}: {
  initialLocale: Locale;
  cottage: Cottage;
}) {
  const { locale, changeLocale } = useRoutedLocale(initialLocale);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [terms, setTerms] = useState(false);
  const copy = journeyMessages[locale];

  return (
    <main className="request-page">
      <header className="results-header">
        <a href={`/${locale}/cottages/${cottage.slug}`}>{copy.backResults}</a>
        <LocaleButtons
          className="results-languages"
          locale={locale}
          onChange={changeLocale}
        />
      </header>
      <div className="request-layout">
        <section>
          <p className="request-eyebrow">{cottage.name[locale]}</p>
          <h1>{copy.requestTitle}</h1>
          <form className="request-form">
            <label>
              <span>{copy.fullName}</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </label>
            <label>
              <span>{copy.ownerNote}</span>
              <textarea
                value={note}
                placeholder={copy.ownerNotePlaceholder}
                onChange={(event) => setNote(event.target.value)}
                rows={4}
              />
            </label>
            <label className="terms-field">
              <input
                type="checkbox"
                checked={terms}
                onChange={(event) => setTerms(event.target.checked)}
                required
              />
              <span>{copy.terms}</span>
            </label>
            <p className="request-notice">{copy.unavailable}</p>
            <button type="button" disabled>
              {copy.submit}
            </button>
          </form>
        </section>
        <aside className="request-stay">
          <div>
            <Image
              src={`/uploads/${cottage.image}`}
              alt=""
              fill
              sizes="360px"
            />
          </div>
          <h2>{copy.staySummary}</h2>
          <strong>{cottage.name[locale]}</strong>
          <span>{cottage.area[locale]}</span>
          <p>IQD {cottage.price.toLocaleString("en-US")}</p>
          <small>{copy.requestOnly}</small>
        </aside>
      </div>
    </main>
  );
}
