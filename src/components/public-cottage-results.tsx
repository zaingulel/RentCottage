import Image from "next/image";
import Link from "next/link";

import type { CottageDiscoveryResult } from "@/cottage-discovery/supabase-cottage-discovery";
import { formatIqd } from "@/i18n/format";
import type { Locale } from "@/i18n/routing";
import { LocaleLinks } from "./locale-links";

const copy = {
  ar: {
    title: "البيوت المتاحة",
    empty: "لا توجد بيوت متاحة تطابق هذا البحث.",
    unavailable: "تعذر تحميل البيوت الآن. حاول مرة أخرى.",
    location: "الموقع التقريبي",
    view: "اعرض البيت",
    back: "تعديل البحث",
    fullDay: "اليوم الكامل",
  },
  ckb: {
    title: "کۆتێجە بەردەستەکان",
    empty: "هیچ کۆتێجێکی بەردەست لەگەڵ ئەم گەڕانە ناگونجێت.",
    unavailable: "ئێستا ناتوانرێت کۆتێجەکان باربکرێن. دووبارە هەوڵ بدەرەوە.",
    location: "ناوچەی نزیکەوە",
    view: "کۆتێجەکە ببینە",
    back: "گەڕانەکە بگۆڕە",
    fullDay: "هەموو ڕۆژ",
  },
  en: {
    title: "Available cottages",
    empty: "No available cottages match this search.",
    unavailable: "Cottages could not be loaded right now. Please try again.",
    location: "Approximate location",
    view: "View cottage",
    back: "Change search",
    fullDay: "Full-day bundle",
  },
} as const;

export function PublicCottageResults({
  locale,
  result,
  queryString,
}: {
  locale: Locale;
  result: CottageDiscoveryResult;
  queryString: string;
}) {
  const messages = copy[locale];
  return (
    <main className="results-page">
      <header className="results-header">
        <Link href={`/${locale}`}>{messages.back}</Link>
        <LocaleLinks
          locale={locale}
          path="/results"
          queryString={queryString}
        />
      </header>
      <section className="results-intro">
        <p>RentCottage</p>
        <h1>{messages.title}</h1>
      </section>
      {result.status === "unavailable" ? (
        <p role="alert" className="empty-results">
          {messages.unavailable}
        </p>
      ) : result.cottages.length === 0 ? (
        <p className="empty-results">{messages.empty}</p>
      ) : (
        <section className="results-grid" aria-label={messages.title}>
          {result.cottages.map((cottage) => (
            <article key={cottage.slug}>
              {cottage.mediaUrls[0] ? (
                <div className="result-image">
                  <Image
                    src={cottage.mediaUrls[0]}
                    alt={cottage.name}
                    fill
                    sizes="(min-width: 900px) 33vw, 100vw"
                  />
                </div>
              ) : null}
              <div className="result-content">
                <h2>{cottage.name}</h2>
                <p>
                  {messages.location}: {cottage.approximateLocation},{" "}
                  {cottage.governorate}
                </p>
                <strong>{formatIqd(cottage.totalPriceIqd, locale)}</strong>
                <ul>
                  {cottage.selectedInventory.map((unit) => (
                    <li
                      key={`${unit.serviceDay}-${unit.kind}-${unit.position ?? "full"}`}
                    >
                      {unit.serviceDay}:{" "}
                      {unit.kind === "full-day" ? messages.fullDay : unit.name}{" "}
                      ({unit.startTime}–{unit.endTime}) —{" "}
                      {unit.priceIqd === null
                        ? ""
                        : formatIqd(unit.priceIqd, locale)}
                    </li>
                  ))}
                </ul>
                <Link
                  href={`/${locale}/cottages/${cottage.slug}?${queryString}`}
                >
                  {messages.view}
                </Link>
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
