import Image from "next/image";

import type { CottageDiscoveryQuery } from "@/cottage-discovery/discovery-query";
import type { CottageDiscoveryProfileResult } from "@/cottage-discovery/supabase-cottage-discovery";
import { publicCottageAmenityName } from "@/i18n/public-cottage-amenities";
import type { Locale } from "@/i18n/routing";
import { customerReviewMessages } from "@/i18n/customer-review-messages";
import { CottageBookingPeriodPicker } from "./cottage-booking-period-picker";
import { ActionFocusTarget, ActionLink } from "./interaction-controls";

const copy = {
  ar: {
    descriptionHidden: "الوصف مخفي مؤقتًا.",
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
    descriptionHidden: "وەسفەکە کاتییانە شاردراوەتەوە.",
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
    descriptionHidden: "The description is temporarily hidden.",
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
  resultsQueryString,
  query,
}: {
  locale: Locale;
  result: CottageDiscoveryProfileResult;
  resultsQueryString: string;
  query: CottageDiscoveryQuery | null;
}) {
  const messages = copy[locale];
  if (result.status !== "loaded" || query === null)
    return (
      <main className="results-page page">
        <header className="page-heading">
          <ActionLink
            kind="text"
            href={`/${locale}/results?${resultsQueryString}`}
          >
            {messages.back}
          </ActionLink>
        </header>
        <p
          id="public-cottage-unavailable"
          role="alert"
          tabIndex={-1}
          className="action-focus-target"
        >
          {messages.unavailable}
        </p>
        <ActionFocusTarget targetId="public-cottage-unavailable" navigation />
      </main>
    );
  const cottage = result.cottage;
  return (
    <main className="profile-page page">
      <header className="page-heading profile-heading">
        <ActionLink
          kind="text"
          href={`/${locale}/results?${resultsQueryString}`}
        >
          {messages.back}
        </ActionLink>
        <h1
          id="public-cottage-profile-title"
          tabIndex={-1}
          className="page-title action-focus-target"
        >
          {cottage.name}
        </h1>
        <ActionFocusTarget targetId="public-cottage-profile-title" navigation />
        <p>
          {messages.location}: {cottage.approximateLocation},{" "}
          {cottage.governorate}
        </p>
      </header>
      {cottage.mediaUrls[0] ? (
        <div className="profile-main-image">
          <Image
            src={cottage.mediaUrls[0]}
            alt={`${cottage.name} 1`}
            fill
            sizes="(max-width: 72.25rem) calc(100vw - 36px), 1120px"
          />
        </div>
      ) : null}
      <div
        className={`profile-layout${cottage.mediaUrls.length > 1 ? " profile-layout-has-gallery" : ""}`}
      >
        {cottage.mediaUrls.length > 1 ? (
          <section className="profile-gallery">
            {cottage.mediaUrls.slice(1).map((url, index) => (
              <div key={url}>
                <Image
                  src={url}
                  alt={`${cottage.name} ${index + 2}`}
                  fill
                  sizes="(max-width: 40rem) calc((100vw - 52px) / 3), (max-width: 47.5rem) calc((100vw - 60px) / 3), (max-width: 72.25rem) calc((100vw - 476px) / 3), calc(680px / 3)"
                />
              </div>
            ))}
          </section>
        ) : null}
        <dl className="fact-list profile-facts">
          <div>
            <dt>{messages.capacity}</dt>
            <dd>
              {cottage.capacity} {messages.guests}
            </dd>
          </div>
          <div>
            <dt>{messages.rooms}</dt>
            <dd>
              <bdi dir="ltr">
                {cottage.bedrooms} / {cottage.bathrooms}
              </bdi>
            </dd>
          </div>
        </dl>
        <aside className="card booking-summary">
          <CottageBookingPeriodPicker
            locale={locale}
            slug={cottage.slug}
            query={query}
            inventory={cottage.inventory}
          />
        </aside>
        <div className="profile-copy">
          <section className="profile-section">
            <p>
              {cottage.descriptionHidden
                ? messages.descriptionHidden
                : cottage.description}
            </p>
          </section>
          <section className="profile-section">
            <h2 className="section-title">{messages.amenities}</h2>
            <ul>
              {cottage.amenities.map((amenity) => (
                <li key={amenity}>
                  {publicCottageAmenityName(locale, amenity)}
                </li>
              ))}
            </ul>
          </section>
          <section className="profile-section">
            <h2 className="section-title">{messages.rules}</h2>
            <p>{cottage.houseRules}</p>
          </section>
          <section className="profile-section">
            <ActionLink
              kind="text"
              href={`/${locale}/cottages/${cottage.slug}/reviews`}
            >
              {customerReviewMessages[locale].publicLink}
            </ActionLink>
          </section>
        </div>
      </div>
    </main>
  );
}
