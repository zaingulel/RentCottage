import {
  BookingPeriodIdentity,
  BookingPeriodEndpoints,
} from "./booking-period-details";
import { bookingPeriodMessages } from "@/i18n/booking-period-messages";
import {
  inventoryAccessBounds,
  inventoryDayPresentation,
} from "@/booking-quote/booking-period-presentation";
import Image from "next/image";

import {
  serializeCottageResultsQuery,
  type CottageDiscoveryQuery,
} from "@/cottage-discovery/discovery-query";
import { fromPriceIqd } from "@/cottage-discovery/from-price";
import type { CottageDiscoveryResult } from "@/cottage-discovery/supabase-cottage-discovery";
import { formatIqd, formatServiceDay } from "@/i18n/format";
import { publicCottageAmenityName } from "@/i18n/public-cottage-amenities";
import type { Locale } from "@/i18n/routing";
import {
  ActionFeedback,
  ActionFocusTarget,
  ActionLink,
} from "./interaction-controls";

const copy = {
  ar: {
    title: "البيوت المتاحة",
    empty: "لا يوجد بيت يطابق كل يوم مطلوب وجميع المرشحات المحددة.",
    unavailable: "تعذر تحميل البيوت الآن. حاول مرة أخرى.",
    location: "الموقع التقريبي",
    view: "اعرض البيت",
    back: "تعديل البحث",
    changeSearch: "غيّر البحث",
    fullDay: "اليوم الكامل",
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
    searchTitle: "بحثك",
    searchFrom: "من تاريخ",
    searchTo: "إلى تاريخ",
    guests: "عدد الضيوف",
    filters: "مرشحات فترة الحجز",
    shift: "الفترة",
    governorate: "المحافظة",
    area: "المنطقة التقريبية",
    amenities: "المرافق",
    capacity: "السعة",
    capacityGuests: "ضيوف",
    matchedAmenities: "المرافق التي بحثت عنها",
  },
  ckb: {
    title: "کۆتێجە بەردەستەکان",
    empty:
      "هیچ کۆتێجێک لەگەڵ هەموو ڕۆژە داواکراوەکان و پاڵاوتە دیاریکراوەکان ناگونجێت.",
    unavailable: "ئێستا ناتوانرێت کۆتێجەکان باربکرێن. دووبارە هەوڵ بدەرەوە.",
    location: "شوێنی نزیکەیی",
    view: "کۆتێجەکە ببینە",
    back: "گەڕانەکە بگۆڕە",
    changeSearch: "گەڕان بگۆڕە",
    fullDay: "پاکێجی ڕۆژی تەواو",
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
    searchTitle: "گەڕانەکەت",
    searchFrom: "لە بەرواری",
    searchTo: "تا بەرواری",
    guests: "ژمارەی میوان",
    filters: "پاڵاوتەکانی ماوەی حجز",
    shift: "شیفت",
    governorate: "پارێزگا",
    area: "ناوچەی نزیکەیی",
    amenities: "خزمەتگوزارییەکان",
    capacity: "گنجایش",
    capacityGuests: "میوان",
    matchedAmenities: "ئەو خزمەتگوزارییانەی بۆیان گەڕایت",
  },
  en: {
    title: "Available cottages",
    empty:
      "No cottage matches every requested Service Day and selected filter.",
    unavailable: "Cottages could not be loaded right now. Please try again.",
    location: "Approximate location",
    view: "View cottage",
    back: "Change search",
    changeSearch: "Change search",
    fullDay: "Full-day bundle",
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
    searchTitle: "Your search",
    searchFrom: "From Service Day",
    searchTo: "To Service Day",
    guests: "Guests",
    filters: "Booking Period filters",
    shift: "Shift",
    governorate: "Governorate",
    area: "Approximate area",
    amenities: "Amenities",
    capacity: "Capacity",
    capacityGuests: "guests",
    matchedAmenities: "Amenities you searched for",
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
    <main className="results-page page">
      <header className="page-heading">
        <ActionLink kind="text" href={`/${locale}`}>
          {messages.back}
        </ActionLink>
        <h1
          id="public-cottage-results-title"
          tabIndex={-1}
          className="page-title action-focus-target"
        >
          {messages.title}
        </h1>
        <ActionFocusTarget targetId="public-cottage-results-title" navigation />
      </header>
      <section
        className="search-summary"
        aria-labelledby="search-summary-heading"
      >
        <h2 id="search-summary-heading" className="section-title">
          {messages.searchTitle}
        </h2>
        <dl className="fact-list">
          <div>
            <dt>{messages.searchFrom}</dt>
            <dd>{formatServiceDay(query.from, locale, { weekday: true })}</dd>
          </div>
          <div>
            <dt>{messages.searchTo}</dt>
            <dd>{formatServiceDay(query.to, locale, { weekday: true })}</dd>
          </div>
          <div>
            <dt>{messages.guests}</dt>
            <dd>{query.guests}</dd>
          </div>
          {query.selections.length > 0 ? (
            <div>
              <dt>{messages.filters}</dt>
              <dd>
                {query.selections.map((selection) => (
                  <span
                    key={`${selection.serviceDay}-${selection.kind === "full-day" ? "full" : selection.position}`}
                  >
                    <bdi>
                      {formatServiceDay(selection.serviceDay, locale, {
                        weekday: true,
                      })}
                    </bdi>
                    :{" "}
                    {selection.kind === "full-day"
                      ? messages.fullDay
                      : `${messages.shift} ${selection.position}`}
                  </span>
                ))}
              </dd>
            </div>
          ) : null}
          {query.governorate ? (
            <div>
              <dt>{messages.governorate}</dt>
              <dd>
                <bdi>{query.governorate}</bdi>
              </dd>
            </div>
          ) : null}
          {query.area ? (
            <div>
              <dt>{messages.area}</dt>
              <dd>
                <bdi>{query.area}</bdi>
              </dd>
            </div>
          ) : null}
          {query.amenities.length > 0 ? (
            <div>
              <dt>{messages.amenities}</dt>
              <dd>
                {query.amenities.map((amenity) => (
                  <span key={amenity}>
                    {publicCottageAmenityName(locale, amenity)}
                  </span>
                ))}
              </dd>
            </div>
          ) : null}
        </dl>
      </section>
      {result.status === "unavailable" ? (
        <ActionFeedback kind="error">{messages.unavailable}</ActionFeedback>
      ) : result.cottages.length === 0 ? (
        <div className="empty-state">
          <p>{continued ? messages.pastEnd : messages.empty}</p>
          <ActionLink kind="secondary" href={`/${locale}`}>
            {messages.changeSearch}
          </ActionLink>
        </div>
      ) : (
        <section className="results-list" aria-label={messages.title}>
          {result.cottages.map((cottage) => {
            const fromPrice = fromPriceIqd(cottage.inventory);
            const matchedAmenities = query.amenities.filter((amenity) =>
              cottage.amenities.includes(amenity),
            );
            return (
              <article className="card" key={cottage.slug}>
                {cottage.mediaUrls[0] ? (
                  <div className="result-image">
                    <Image
                      src={cottage.mediaUrls[0]}
                      alt={cottage.name}
                      fill
                      sizes="(max-width: 47.5rem) calc(100vw - 36px), 18rem"
                    />
                  </div>
                ) : null}
                <div className="result-content">
                  <div className="result-overview">
                    <h2 className="card-title">{cottage.name}</h2>
                    <p>
                      {messages.location}: {cottage.approximateLocation},{" "}
                      {cottage.governorate}
                    </p>
                    <dl className="fact-list">
                      <div>
                        <dt>{messages.capacity}</dt>
                        <dd>
                          {cottage.capacity} {messages.capacityGuests}
                        </dd>
                      </div>
                      {matchedAmenities.length > 0 ? (
                        <div>
                          <dt>{messages.matchedAmenities}</dt>
                          <dd>
                            {matchedAmenities.map((amenity) => (
                              <span key={amenity}>
                                {publicCottageAmenityName(locale, amenity)}
                              </span>
                            ))}
                          </dd>
                        </div>
                      ) : null}
                    </dl>
                  </div>
                  <div className="result-price">
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
                  </div>
                  <div className="result-days">
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
                              <li
                                key={`${unit.kind}-${unit.position ?? "full"}`}
                              >
                                <BookingPeriodIdentity
                                  locale={locale}
                                  kind={unit.kind}
                                  position={unit.position}
                                  originalName={unit.name}
                                  presentation={inventoryDayPresentation(
                                    cottage.inventory.filter(
                                      (option) => option.serviceDay === day,
                                    ),
                                  )}
                                />
                                <b>
                                  <bdi dir="auto">
                                    {unit.priceIqd === null
                                      ? messages.noPrice
                                      : formatIqd(unit.priceIqd, locale)}
                                  </bdi>
                                </b>
                                <BookingPeriodEndpoints
                                  locale={locale}
                                  {...inventoryAccessBounds(unit)}
                                />
                                {unit.kind === "full-day" ? (
                                  <span className="booking-period-explanation">
                                    {inventoryDayPresentation(
                                      cottage.inventory.filter(
                                        (option) => option.serviceDay === day,
                                      ),
                                    ) === "morning-evening-v1" ? (
                                      <span>
                                        {
                                          bookingPeriodMessages[locale]
                                            .fullDayIncludes
                                        }
                                      </span>
                                    ) : null}
                                    <span>
                                      {
                                        bookingPeriodMessages[locale]
                                          .fullDaySchedule
                                      }
                                    </span>
                                    <span>
                                      {
                                        bookingPeriodMessages[locale]
                                          .fullDayPrice
                                      }
                                    </span>
                                  </span>
                                ) : null}
                                <span
                                  className={`result-availability${unit.available ? " result-availability-available" : ""}`}
                                >
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
                                ) && (
                                  <span className="status-badge">
                                    {messages.selected}
                                  </span>
                                )}
                              </li>
                            ))}
                        </ul>
                      </section>
                    ))}
                  </div>
                  <div className="result-footer">
                    <p>{messages.prices}</p>
                    <ActionLink
                      kind="primary"
                      href={`/${locale}/cottages/${cottage.slug}?${serializeCottageResultsQuery(query, after)}`}
                    >
                      {messages.view}
                    </ActionLink>
                  </div>
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
              href={`/${locale}/results?${queryString}`}
            >
              {messages.first}
            </ActionLink>
          ) : null}
          {result.nextAfter ? (
            <ActionLink
              kind="secondary"
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
