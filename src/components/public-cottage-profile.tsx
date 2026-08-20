import Image from "next/image";
import Link from "next/link";

import type { CottageDiscoveryProfileResult } from "@/cottage-discovery/supabase-cottage-discovery";
import { formatIqd } from "@/i18n/format";
import { publicCottageAmenityName } from "@/i18n/public-cottage-amenities";
import type { Locale } from "@/i18n/routing";
import { LocaleLinks } from "./locale-links";

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
    period: "الفترة المطلوبة",
    total: "السعر الإجمالي",
    fullDay: "اليوم الكامل",
    closed: "غير متاح",
    noPrice: "السعر غير متاح",
    quote: "عرض السعر الدقيق",
  },
  ckb: {
    back: "گەڕانەوە بۆ ئەنجامەکان",
    unavailable: "ئێستا ناتوانرێت کۆتێجەکە باربکرێت.",
    location: "ناوچەی نزیکەوە",
    capacity: "توانا",
    guests: "میوان",
    rooms: "ژووری نووستن و حەمام",
    amenities: "خزمەتگوزارییەکان",
    rules: "یاساکانی کۆتێج",
    period: "ماوە داواکراوەکە",
    total: "کۆی نرخ",
    fullDay: "هەموو ڕۆژ",
    closed: "بەردەست نییە",
    noPrice: "نرخ بەردەست نییە",
    quote: "پێشنیاری نرخی ورد",
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
    period: "Requested Booking Period",
    total: "Total price",
    fullDay: "Full-day bundle",
    closed: "Unavailable",
    noPrice: "Price unavailable",
    quote: "Get exact quote",
  },
} as const;

export function PublicCottageProfileView({
  locale,
  slug,
  result,
  queryString,
}: {
  locale: Locale;
  slug: string;
  result: CottageDiscoveryProfileResult;
  queryString: string;
}) {
  const messages = copy[locale];
  if (result.status !== "loaded")
    return (
      <main className="results-page">
        <header className="results-header">
          <Link href={`/${locale}/results?${queryString}`}>
            {messages.back}
          </Link>
          <LocaleLinks
            locale={locale}
            path={`/cottages/${slug}`}
            queryString={queryString}
          />
        </header>
        <p role="alert">{messages.unavailable}</p>
      </main>
    );
  const cottage = result.cottage;
  return (
    <main className="profile-page">
      <header className="results-header">
        <Link href={`/${locale}/results?${queryString}`}>{messages.back}</Link>
        <LocaleLinks
          locale={locale}
          path={`/cottages/${cottage.slug}`}
          queryString={queryString}
        />
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
        </div>
        <aside className="booking-summary">
          <h2>{messages.period}</h2>
          <ul>
            {cottage.selectedInventory.map((unit) => (
              <li
                key={`${unit.serviceDay}-${unit.kind}-${unit.position ?? "full"}`}
              >
                {unit.serviceDay}:{" "}
                {unit.kind === "full-day" ? messages.fullDay : unit.name},{" "}
                {unit.startTime}–{unit.endTime} —{" "}
                {unit.priceIqd === null
                  ? messages.noPrice
                  : formatIqd(unit.priceIqd, locale)}
                {unit.available ? "" : ` — ${messages.closed}`}
              </li>
            ))}
          </ul>
          <strong>
            {messages.total}:{" "}
            {cottage.totalPriceIqd === null
              ? messages.noPrice
              : formatIqd(cottage.totalPriceIqd, locale)}
          </strong>
          <Link
            className="action-link action-primary action-full"
            href={`/${locale}/request/${cottage.slug}?${queryString}`}
          >
            {messages.quote}
          </Link>
        </aside>
      </div>
    </main>
  );
}
