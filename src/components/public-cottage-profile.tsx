import Image from "next/image";
import Link from "next/link";

import type { CottageDiscoveryQuery } from "@/cottage-discovery/discovery-query";
import type { CottageDiscoveryProfileResult } from "@/cottage-discovery/supabase-cottage-discovery";
import { publicCottageAmenityName } from "@/i18n/public-cottage-amenities";
import type { Locale } from "@/i18n/routing";
import { customerReviewMessages } from "@/i18n/customer-review-messages";
import { CottageBookingPeriodPicker } from "./cottage-booking-period-picker";

const copy = {
  ar: {
    back: "العودة إلى النتائج",
    unavailable: "تعذر تحميل البيت الآن.",
    location: "الموقع التقريبي",
    capacity: "السعة",
    guests: "ضيوف",
    rooms: "غرف النوم والحمامات",
    amenities: "المرافق",
    rules: "قواعد البيت",
  },
  ckb: {
    back: "گەڕانەوە بۆ ئەنجامەکان",
    unavailable: "ئێستا ناتوانرێت کۆتێجەکە باربکرێت.",
    location: "شوێنی نزیکەیی",
    capacity: "گنجایش",
    guests: "میوان",
    rooms: "ژووری نوستن و حەمام",
    amenities: "خزمەتگوزارییەکان",
    rules: "یاساکانی کۆتێج",
  },
  en: {
    back: "Back to results",
    unavailable: "This cottage could not be loaded right now.",
    location: "Approximate location",
    capacity: "Capacity",
    guests: "guests",
    rooms: "Bedrooms and bathrooms",
    amenities: "Amenities",
    rules: "House Rules",
  },
} as const;

export function PublicCottageProfileView({
  locale,
  result,
  queryString,
  query,
}: {
  locale: Locale;
  result: CottageDiscoveryProfileResult;
  queryString: string;
  query: CottageDiscoveryQuery | null;
}) {
  const messages = copy[locale];
  if (result.status !== "loaded" || query === null)
    return (
      <main className="results-page">
        <header className="results-header">
          <Link href={`/${locale}/results?${queryString}`}>
            {messages.back}
          </Link>
        </header>
        <p role="alert">{messages.unavailable}</p>
      </main>
    );
  const cottage = result.cottage;
  return (
    <main className="profile-page">
      <header className="results-header">
        <Link href={`/${locale}/results?${queryString}`}>{messages.back}</Link>
      </header>
      <div className="profile-layout">
        <div>
          {cottage.mediaUrls.length ? (
            <section className="profile-gallery">
              {cottage.mediaUrls.map((url, index) => (
                <div
                  className={index === 0 ? "profile-main-image" : undefined}
                  key={url}
                >
                  <Image
                    src={url}
                    alt={`${cottage.name} ${index + 1}`}
                    fill
                    sizes="(min-width: 900px) 50vw, 100vw"
                  />
                </div>
              ))}
            </section>
          ) : null}
          <header className="profile-heading">
            <h1>{cottage.name}</h1>
            <p>
              {messages.location}: {cottage.approximateLocation},{" "}
              {cottage.governorate}
            </p>
          </header>
          <dl className="profile-facts">
            <div>
              <dt>{messages.capacity}</dt>
              <dd>
                {cottage.capacity} {messages.guests}
              </dd>
            </div>
            <div>
              <dt>{messages.rooms}</dt>
              <dd>
                {cottage.bedrooms} / {cottage.bathrooms}
              </dd>
            </div>
          </dl>
          <section className="profile-section">
            <p>{cottage.description}</p>
          </section>
          <section className="profile-section">
            <h2>{messages.amenities}</h2>
            <ul>
              {cottage.amenities.map((amenity) => (
                <li key={amenity}>
                  {publicCottageAmenityName(locale, amenity)}
                </li>
              ))}
            </ul>
          </section>
          <section className="profile-section">
            <h2>{messages.rules}</h2>
            <p>{cottage.houseRules}</p>
          </section>
          <section className="profile-section">
            <Link href={`/${locale}/cottages/${cottage.slug}/reviews`}>
              {customerReviewMessages[locale].publicLink}
            </Link>
          </section>
        </div>
        <aside className="booking-summary">
          <CottageBookingPeriodPicker
            locale={locale}
            slug={cottage.slug}
            query={query}
            inventory={cottage.inventory}
          />
        </aside>
      </div>
    </main>
  );
}
