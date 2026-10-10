import Image from "next/image";
import Link from "next/link";

import {
  serializeCottageResultsQuery,
  type CottageDiscoveryQuery,
} from "@/cottage-discovery/discovery-query";
import { fromPriceIqd } from "@/cottage-discovery/from-price";
import type { CottageDiscoveryResult } from "@/cottage-discovery/supabase-cottage-discovery";
import { formatIqd, formatServiceDay } from "@/i18n/format";
import type { Locale } from "@/i18n/routing";
import { ActionLink } from "./interaction-controls";

const copy = {
  ar: {
    title: "البيوت المتاحة",
    empty: "لا يوجد بيت يطابق كل يوم مطلوب وجميع المرشحات المحددة.",
    unavailable: "تعذر تحميل البيوت الآن. حاول مرة أخرى.",
    location: "الموقع التقريبي",
    view: "اعرض البيت",
    back: "تعديل البحث",
    fullDay: "اليوم الكامل",
    nextDay: "اليوم التالي",
    available: "متاح",
    unavailableOption: "غير متاح",
    noPrice: "السعر غير متاح",
    selected: "مرشح محدد",
    prices: "الأسعار لكل خيار. يشمل عرض السعر الدقيق رسوم خدمة الحجز.",
    from: "ابتداءً من",
    fromNote:
      "أقل سعر لمناوبة واحدة متاحة في تواريخك، دون احتساب رسوم خدمة الحجز.",
    pagingLabel: "صفحات النتائج",
    next: "النتائج التالية",
    first: "العودة إلى أول النتائج",
    pastEnd: "لا توجد بيوت أخرى لهذا البحث.",
  },
  ckb: {
    title: "کۆتێجە بەردەستەکان",
    empty:
      "هیچ کۆتێجێک لەگەڵ هەموو ڕۆژە داواکراوەکان و پاڵاوتە دیاریکراوەکان ناگونجێت.",
    unavailable: "ئێستا ناتوانرێت کۆتێجەکان باربکرێن. دووبارە هەوڵ بدەرەوە.",
    location: "شوێنی نزیکەیی",
    view: "کۆتێجەکە ببینە",
    back: "گەڕانەکە بگۆڕە",
    fullDay: "پاکێجی ڕۆژی تەواو",
    nextDay: "ڕۆژی دواتر",
    available: "بەردەستە",
    unavailableOption: "بەردەست نییە",
    noPrice: "نرخ بەردەست نییە",
    selected: "پاڵاوتەی دیاریکراو",
    prices:
      "نرخەکان بۆ هەر هەڵبژاردەیەکن. پێشنیاری نرخی ورد کرێی خزمەتگوزاریی حجز لەخۆ دەگرێت.",
    from: "دەستپێک لە",
    fromNote:
      "کەمترین نرخ بۆ یەک شیفتی بەردەست لە ڕۆژەکانی تۆ، بەبێ کرێی خزمەتگوزاریی حجز.",
    pagingLabel: "لاپەڕەکانی ئەنجام",
    next: "ئەنجامەکانی دواتر",
    first: "گەڕانەوە بۆ یەکەم ئەنجامەکان",
    pastEnd: "هیچ کۆتێجێکی تر بۆ ئەم گەڕانە نییە.",
  },
  en: {
    title: "Available cottages",
    empty:
      "No cottage matches every requested Service Day and selected filter.",
    unavailable: "Cottages could not be loaded right now. Please try again.",
    location: "Approximate location",
    view: "View cottage",
    back: "Change search",
    fullDay: "Full-day bundle",
    nextDay: "next day",
    available: "Available",
    unavailableOption: "Unavailable",
    noPrice: "Price unavailable",
    selected: "Selected filter",
    prices:
      "Prices are per option. The exact quote includes the Booking Service Fee.",
    from: "From",
    fromNote:
      "Lowest price for one available shift on your dates, excluding the Booking Service Fee.",
    pagingLabel: "Results pages",
    next: "Next results",
    first: "Back to first results",
    pastEnd: "There are no more cottages for this search.",
  },
} as const;

export function PublicCottageResults({
  locale,
  result,
  queryString,
  query,
  after,
}: {
  locale: Locale;
  result: CottageDiscoveryResult;
  queryString: string;
  query: CottageDiscoveryQuery;
  after: string | null;
}) {
  const messages = copy[locale];
  const continued = after !== null;
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
        <p className="empty-results">
          {continued ? messages.pastEnd : messages.empty}
        </p>
      ) : (
        <section className="results-grid" aria-label={messages.title}>
          {result.cottages.map((cottage) => {
            const fromPrice = fromPriceIqd(cottage.inventory);
            return (
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
                  {fromPrice === null ? (
                    <p className="result-from-price">{messages.noPrice}</p>
                  ) : (
                    <>
                      <p className="result-from-price">
                        {messages.from} <b>{formatIqd(fromPrice, locale)}</b>
                      </p>
                      <p>{messages.fromNote}</p>
                    </>
                  )}
                  <p className="result-prices-note">{messages.prices}</p>
                  {[
                    ...new Set(
                      cottage.inventory.map((unit) => unit.serviceDay),
                    ),
                  ].map((day) => (
                    <section
                      className="result-service-day"
                      key={day}
                      aria-label={formatServiceDay(day, locale)}
                    >
                      <h3>{formatServiceDay(day, locale)}</h3>
                      <ul className="result-shifts">
                        {cottage.inventory
                          .filter((unit) => unit.serviceDay === day)
                          .map((unit) => (
                            <li key={`${unit.kind}-${unit.position ?? "full"}`}>
                              <span>
                                {unit.kind === "full-day"
                                  ? messages.fullDay
                                  : unit.name}
                              </span>
                              <span>
                                <bdi dir="ltr">
                                  {unit.startTime}–{unit.endTime}
                                </bdi>
                                {(unit.endTime < unit.startTime ||
                                  (unit.kind === "full-day" &&
                                    unit.endTime === unit.startTime)) && (
                                  <> {messages.nextDay}</>
                                )}
                              </span>
                              <b>
                                {unit.priceIqd === null
                                  ? messages.noPrice
                                  : formatIqd(unit.priceIqd, locale)}
                              </b>
                              <span>
                                {unit.available
                                  ? messages.available
                                  : messages.unavailableOption}
                              </span>
                              {query.selections.some(
                                (selection) =>
                                  selection.serviceDay === day &&
                                  selection.kind === unit.kind &&
                                  (selection.kind === "full-day" ||
                                    selection.position === unit.position),
                              ) && <span>{messages.selected}</span>}
                            </li>
                          ))}
                      </ul>
                    </section>
                  ))}
                  <ActionLink
                    kind="secondary"
                    width="full"
                    href={`/${locale}/cottages/${cottage.slug}?${serializeCottageResultsQuery(query, after)}`}
                  >
                    {messages.view}
                  </ActionLink>
                </div>
              </article>
            );
          })}
        </section>
      )}
      {result.status === "loaded" && (continued || result.nextAfter) ? (
        <nav className="results-paging" aria-label={messages.pagingLabel}>
          {continued ? (
            <ActionLink
              kind="secondary"
              width="content"
              href={`/${locale}/results?${queryString}`}
            >
              {messages.first}
            </ActionLink>
          ) : null}
          {result.nextAfter ? (
            <ActionLink
              kind="secondary"
              width="content"
              href={`/${locale}/results?${serializeCottageResultsQuery(query, result.nextAfter)}`}
            >
              {messages.next}
            </ActionLink>
          ) : null}
        </nav>
      ) : null}
    </main>
  );
}
