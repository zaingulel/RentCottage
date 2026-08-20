"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import {
  serializeCottageDiscoveryQuery,
  type CottageDiscoverySelection,
} from "@/cottage-discovery/discovery-query";
import type { CottageDiscoveryFacetsResult } from "@/cottage-discovery/supabase-cottage-discovery";
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
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [invalid, setInvalid] = useState(false);
  const days = useMemo(() => serviceDays(from, to), [from, to]);
  const hasMissingSelection =
    days.length === 0 || days.some((day) => !selections[day]?.length);

  function setDaySelection(day: string, value: string, checked: boolean) {
    setSelections((current) => {
      const existing = current[day] ?? [];
      if (value === "full-day") {
        return { ...current, [day]: checked ? [value] : [] };
      }
      const withoutFullDay = existing.filter((item) => item !== "full-day");
      return {
        ...current,
        [day]: checked
          ? [...withoutFullDay, value]
          : withoutFullDay.filter((item) => item !== value),
      };
    });
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
          selections[day].map((selection) =>
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
      {days.length > 0 ? (
        <fieldset className="booking-period-filter">
          <legend>{messages.shifts}</legend>
          {days.map((day) => (
            <fieldset key={day}>
              <legend>{day}</legend>
              {[1, 2, 3].map((position) => (
                <label key={position}>
                  <input
                    type="checkbox"
                    checked={(selections[day] ?? []).includes(String(position))}
                    onChange={(event) =>
                      setDaySelection(
                        day,
                        String(position),
                        event.target.checked,
                      )
                    }
                  />
                  {messages.shift} {position}
                </label>
              ))}
              <label>
                <input
                  type="checkbox"
                  checked={(selections[day] ?? []).includes("full-day")}
                  onChange={(event) =>
                    setDaySelection(day, "full-day", event.target.checked)
                  }
                />
                {messages.fullDay}
              </label>
            </fieldset>
          ))}
        </fieldset>
      ) : null}
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
