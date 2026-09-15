"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import {
  serializeCottageDiscoveryQuery,
  type CottageDiscoverySelection,
} from "@/cottage-discovery/discovery-query";
import type { CottageDiscoveryFacetsResult } from "@/cottage-discovery/supabase-cottage-discovery";
import { formatServiceDay } from "@/i18n/format";
import { publicCottageAmenityName } from "@/i18n/public-cottage-amenities";
import type { Locale } from "@/i18n/routing";
import { ActionButton } from "./interaction-controls";

const copy = {
  ar: {
    title: "ابحث عن بيت ريفي متاح",
    from: "من تاريخ",
    to: "إلى تاريخ",
    guests: "عدد الضيوف",
    governorate: "المحافظة (اختياري)",
    area: "المنطقة التقريبية (اختياري)",
    shifts: "الفترات المطلوبة لكل يوم",
    shift: "الفترة",
    fullDay: "اليوم الكامل",
    fullDayShort: "يوم كامل",
    defaultsHint: "ينطبق على كل يوم خدمة. اختر تواريخك لتحديدها يومًا بيوم.",
    amenities: "المرافق",
    submit: "ابحث عن البيوت المتاحة",
    choose: "اختر فترة واحدة على الأقل لكل يوم.",
    all: "الكل",
    unavailable: "تعذر تحميل خيارات البحث الآن.",
  },
  ckb: {
    title: "بۆ کۆتێجێکی بەردەست بگەڕێ",
    from: "لە بەرواری",
    to: "تا بەرواری",
    guests: "ژمارەی میوان",
    governorate: "پارێزگا (ئارەزوومەندانە)",
    area: "ناوچەی نزیکەوە (ئارەزوومەندانە)",
    shifts: "شیفتە داواکراوەکانی هەر ڕۆژ",
    shift: "شیفت",
    fullDay: "هەموو ڕۆژ",
    fullDayShort: "هەموو ڕۆژ",
    defaultsHint:
      "بۆ هەموو ڕۆژێکی خزمەت جێبەجێ دەبێت. بەروارەکانت هەڵبژێرە بۆ دیاریکردنیان ڕۆژ بە ڕۆژ.",
    amenities: "خزمەتگوزارییەکان",
    submit: "گەڕان بۆ کۆتێجی بەردەست",
    choose: "بۆ هەر ڕۆژێک لانیکەم یەک شیفت هەڵبژێرە.",
    all: "هەموو",
    unavailable: "ئێستا ناتوانرێت هەڵبژاردەکانی گەڕان باربکرێن.",
  },
  en: {
    title: "Find an available cottage",
    from: "From Service Day",
    to: "To Service Day",
    guests: "Guests",
    governorate: "Governorate (optional)",
    area: "Approximate area (optional)",
    shifts: "Booking Period for each Service Day",
    shift: "Shift",
    fullDay: "Full-day bundle",
    fullDayShort: "Full day",
    defaultsHint:
      "Applies to every Service Day. Choose your dates to set them day by day.",
    amenities: "Amenities",
    submit: "Search available cottages",
    choose: "Choose at least one shift for every Service Day.",
    all: "All",
    unavailable: "Search choices could not be loaded right now.",
  },
} as const;

function baghdadToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Baghdad",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function serviceDays(from: string, to: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(to) ||
    from > to
  ) {
    return [];
  }
  const days: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const last = new Date(`${to}T00:00:00Z`);
  while (cursor <= last && days.length < 400) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

const bookingPeriods = ["1", "2", "3", "full-day"] as const;

function toggleBookingPeriod(current: readonly string[], value: string) {
  if (current.includes(value)) return current.filter((item) => item !== value);
  return value === "full-day"
    ? [value]
    : [...current.filter((item) => item !== "full-day"), value];
}

export function CottageDiscoveryForm({
  locale,
  facets,
}: {
  locale: Locale;
  facets: CottageDiscoveryFacetsResult;
}) {
  const router = useRouter();
  const messages = copy[locale];
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [guests, setGuests] = useState(4);
  const [governorate, setGovernorate] = useState("");
  const [area, setArea] = useState("");
  const [amenities, setAmenities] = useState<string[]>([]);
  const [defaults, setDefaults] = useState<string[]>([]);
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [invalid, setInvalid] = useState(false);
  const days = useMemo(() => serviceDays(from, to), [from, to]);
  const effectiveSelection = (day: string) => selections[day] ?? defaults;
  const hasMissingSelection =
    days.length === 0 || days.some((day) => !effectiveSelection(day).length);

  function periodLabel(value: string, fullDayLabel: string) {
    return value === "full-day" ? fullDayLabel : `${messages.shift} ${value}`;
  }

  if (facets.status === "unavailable")
    return (
      <p role="alert" className="retreat-search">
        {messages.unavailable}
      </p>
    );
  return (
    <form
      className="retreat-search"
      onSubmit={(event) => {
        event.preventDefault();
        if (hasMissingSelection) {
          setInvalid(true);
          return;
        }
        const requested: CottageDiscoverySelection[] = days.flatMap((day) =>
          effectiveSelection(day).map((selection) =>
            selection === "full-day"
              ? { serviceDay: day, kind: "full-day" as const }
              : {
                  serviceDay: day,
                  kind: "shift" as const,
                  position: Number(selection) as 1 | 2 | 3,
                },
          ),
        );
        router.push(
          `/${locale}/results?${serializeCottageDiscoveryQuery({
            from,
            to,
            selections: requested,
            guests,
            ...(governorate.trim() ? { governorate: governorate.trim() } : {}),
            ...(area.trim() ? { area: area.trim() } : {}),
            amenities,
          })}`,
        );
      }}
    >
      <div className="search-fields">
        <label>
          {messages.from}
          <input
            type="date"
            required
            min={baghdadToday()}
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </label>
        <label>
          {messages.to}
          <input
            type="date"
            required
            min={from}
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </label>
        <label>
          {messages.guests}
          <input
            type="number"
            min="1"
            max="100"
            required
            value={guests}
            onChange={(event) => setGuests(Number(event.target.value))}
          />
        </label>
        <label>
          {messages.governorate}
          <select
            value={governorate}
            onChange={(event) => setGovernorate(event.target.value)}
          >
            <option value="">{messages.all}</option>
            {facets.governorates.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          {messages.area}
          <select
            value={area}
            onChange={(event) => setArea(event.target.value)}
          >
            <option value="">{messages.all}</option>
            {facets.areas.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset className="booking-period-filter">
        <legend>{messages.shifts}</legend>
        {days.length > 0 ? (
          days.map((day) => (
            <div
              key={day}
              role="group"
              aria-label={formatServiceDay(day, locale, { weekday: true })}
            >
              <span>{formatServiceDay(day, locale, { weekday: true })}</span>
              {bookingPeriods.map((value) => (
                <ActionButton
                  key={value}
                  kind="toggle"
                  size="compact"
                  type="button"
                  pressed={effectiveSelection(day).includes(value)}
                  onClick={() =>
                    setSelections((current) => ({
                      ...current,
                      [day]: toggleBookingPeriod(
                        current[day] ?? defaults,
                        value,
                      ),
                    }))
                  }
                >
                  {periodLabel(value, messages.fullDayShort)}
                </ActionButton>
              ))}
            </div>
          ))
        ) : (
          <>
            <div className="booking-period-defaults">
              {bookingPeriods.map((value) => (
                <ActionButton
                  key={value}
                  kind="toggle"
                  size="compact"
                  type="button"
                  pressed={defaults.includes(value)}
                  onClick={() =>
                    setDefaults((current) =>
                      toggleBookingPeriod(current, value),
                    )
                  }
                >
                  {periodLabel(value, messages.fullDay)}
                </ActionButton>
              ))}
            </div>
            <p>{messages.defaultsHint}</p>
          </>
        )}
      </fieldset>
      <fieldset className="amenity-filter">
        <legend>{messages.amenities}</legend>
        <div>
          {facets.amenities.map((amenity) => (
            <label key={amenity}>
              <input
                type="checkbox"
                checked={amenities.includes(amenity)}
                onChange={(event) =>
                  setAmenities((current) =>
                    event.target.checked
                      ? [...current, amenity]
                      : current.filter((item) => item !== amenity),
                  )
                }
              />
              {publicCottageAmenityName(locale, amenity)}
            </label>
          ))}
        </div>
      </fieldset>
      {invalid && hasMissingSelection ? (
        <p role="alert">{messages.choose}</p>
      ) : null}
      <ActionButton kind="primary" width="content" type="submit">
        {messages.submit}
      </ActionButton>
    </form>
  );
}
