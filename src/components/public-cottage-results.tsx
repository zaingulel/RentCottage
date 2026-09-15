import Image from "next/image";
import Link from "next/link";

import type { CottageDiscoveryResult } from "@/cottage-discovery/supabase-cottage-discovery";
import { formatIqd, formatServiceDay } from "@/i18n/format";
import type { Locale } from "@/i18n/routing";
import { ActionLink } from "./interaction-controls";

const copy = {
  ar: {
    title: "البيوت المتاحة",
    empty: "لا توجد بيوت متاحة تطابق هذا البحث.",
    unavailable: "تعذر تحميل البيوت الآن. حاول مرة أخرى.",
    location: "الموقع التقريبي",
    view: "اعرض البيت",
    back: "تعديل البحث",
    fullDay: "اليوم الكامل",
    total: "الإجمالي",
  },
  ckb: {
    title: "کۆتێجە بەردەستەکان",
    empty: "هیچ کۆتێجێکی بەردەست لەگەڵ ئەم گەڕانە ناگونجێت.",
    unavailable: "ئێستا ناتوانرێت کۆتێجەکان باربکرێن. دووبارە هەوڵ بدەرەوە.",
    location: "ناوچەی نزیکەوە",
    view: "کۆتێجەکە ببینە",
    back: "گەڕانەکە بگۆڕە",
    fullDay: "هەموو ڕۆژ",
    total: "کۆ",
  },
  en: {
    title: "Available cottages",
    empty: "No available cottages match this search.",
    unavailable: "Cottages could not be loaded right now. Please try again.",
    location: "Approximate location",
    view: "View cottage",
    back: "Change search",
    fullDay: "Full-day bundle",
    total: "total",
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
                <div>
                  <strong>{formatIqd(cottage.totalPriceIqd, locale)}</strong>
                  <span>{messages.total}</span>
                </div>
                <ul className="result-shifts">
                  {cottage.selectedInventory.map((unit) => (
                    <li
                      key={`${unit.serviceDay}-${unit.kind}-${unit.position ?? "full"}`}
                    >
                      <span>
                        {formatServiceDay(unit.serviceDay, locale)} ·{" "}
                        {unit.kind === "full-day"
                          ? messages.fullDay
                          : unit.name}{" "}
                        · {unit.startTime}–{unit.endTime}
                      </span>
                      {unit.priceIqd === null ? null : (
                        <b>{formatIqd(unit.priceIqd, locale)}</b>
                      )}
                    </li>
                  ))}
                </ul>
                <ActionLink
                  kind="secondary"
                  width="full"
                  href={`/${locale}/cottages/${cottage.slug}?${queryString}`}
                >
                  {messages.view}
                </ActionLink>
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
