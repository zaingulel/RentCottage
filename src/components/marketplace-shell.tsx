"use client";

import Image from "next/image";
import type { CottageDiscoveryFacetsResult } from "@/cottage-discovery/supabase-cottage-discovery";
import { messages } from "@/i18n/messages";
import type { Locale } from "@/i18n/routing";
import { useRoutedLocale } from "@/i18n/use-routed-locale";

import { ActionLink } from "./interaction-controls";
import { LocaleButtons } from "./locale-buttons";
import { CottageDiscoveryForm } from "./cottage-discovery-form";

interface MarketplaceShellProps {
  initialLocale: Locale;
  facets: CottageDiscoveryFacetsResult;
}

export function MarketplaceShell({
  initialLocale,
  facets,
}: MarketplaceShellProps) {
  const { locale, changeLocale } = useRoutedLocale(initialLocale);
  const copy = messages[locale];

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
          <div className="retreat-access">
            <ActionLink
              kind="secondary"
              width="content"
              href={`/${locale}/owner/access`}
            >
              {copy.ownerSignIn}
            </ActionLink>
            <LocaleButtons
              className="language-switcher"
              locale={locale}
              onChange={changeLocale}
            />
          </div>
        </div>
        <div className="retreat-copy">
          <h1>{copy.heroTitle}</h1>
          <p>{copy.heroSubtitle}</p>
        </div>
      </section>

      <main>
        <CottageDiscoveryForm locale={locale} facets={facets} />

        <p className="retreat-blurb">{copy.retreatBlurb}</p>

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
      </main>
    </div>
  );
}
