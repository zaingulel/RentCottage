"use client";

import Image from "next/image";
import { useState } from "react";

import type { Cottage } from "@/data/cottages";
import { formatIqd } from "@/i18n/format";
import { journeyMessages } from "@/i18n/journey-messages";
import type { Locale } from "@/i18n/routing";
import { useRoutedLocale } from "@/i18n/use-routed-locale";

import { LocaleButtons } from "./locale-buttons";
import { PhoneAccessForm } from "./phone-access-form";
import { ActionButton, ActionLink, FormControl } from "./interaction-controls";

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
        <ActionLink kind="text" href={`/${locale}/cottages/${cottage.slug}`}>
          {copy.backCottage}
        </ActionLink>
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
              <FormControl
                kind="input"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </label>
            <label>
              <span>{copy.ownerNote}</span>
              <FormControl
                kind="textarea"
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
            <PhoneAccessForm locale={locale} role="customer" />
            <p className="request-notice">{copy.unavailable}</p>
            <ActionButton kind="primary" width="full" type="button" disabled>
              {copy.submit}
            </ActionButton>
          </form>
        </section>
        <aside className="request-cottage">
          <div>
            <Image
              src={`/uploads/${cottage.image}`}
              alt=""
              fill
              sizes="360px"
            />
          </div>
          <h2>{copy.cottageSummary}</h2>
          <strong>{cottage.name[locale]}</strong>
          <span>{cottage.area[locale]}</span>
          <p>{formatIqd(cottage.price, locale)}</p>
          <small>{copy.requestOnly}</small>
        </aside>
      </div>
    </main>
  );
}
