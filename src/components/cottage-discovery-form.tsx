"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import {
  marketplaceToday,
  parseCottageDiscoveryQuery,
  serializeCottageDiscoveryQuery,
  type CottageDiscoverySelection,
} from "@/cottage-discovery/discovery-query";
import type { CottageDiscoveryFacetsResult } from "@/cottage-discovery/supabase-cottage-discovery";
import { formatServiceDay } from "@/i18n/format";
import { publicCottageAmenityName } from "@/i18n/public-cottage-amenities";
import type { Locale } from "@/i18n/routing";
import {
  ActionButton,
  ChoiceControl,
  Disclosure,
  FormControl,
  OptionGroup,
} from "./interaction-controls";

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
    filters: "مرشحات فترة الحجز (اختياري)",
    timesHint:
      "تتبع أرقام الفترات جدول كل بيت؛ وتختلف الأوقات. تحقق من أوقات البيت قبل الاختيار.",
    invalidRange:
      "تحقق من التواريخ وعدد الضيوف. اختر نطاقًا لا يتجاوز 31 يومًا.",
    all: "الكل",
    unavailable: "تعذر تحميل خيارات البحث الآن.",
  },
  ckb: {
    title: "بۆ کۆتێجێکی بەردەست بگەڕێ",
    from: "لە بەرواری",
    to: "تا بەرواری",
    guests: "ژمارەی میوان",
    governorate: "پارێزگا (ئارەزوومەندانە)",
    area: "ناوچەی نزیکەیی (ئارەزوومەندانە)",
    shifts: "شیفتە داواکراوەکانی هەر ڕۆژ",
    shift: "شیفت",
    fullDay: "پاکێجی ڕۆژی تەواو",
    fullDayShort: "ڕۆژی تەواو",
    defaultsHint:
      "بۆ هەموو ڕۆژێکی خزمەت جێبەجێ دەبێت. بەروارەکانت هەڵبژێرە بۆ دیاریکردنیان ڕۆژ بە ڕۆژ.",
    amenities: "خزمەتگوزارییەکان",
    submit: "گەڕان بۆ کۆتێجی بەردەست",
    filters: "پاڵاوتەکانی ماوەی حجز (ئارەزوومەندانە)",
    timesHint:
      "ژمارەی شیفتەکان بە خشتەی هەر کۆتێجێکە؛ کاتەکان جیاوازن. پێش هەڵبژاردن کاتەکانی کۆتێجەکە بپشکنە.",
    invalidRange:
      "بەروارەکان و ژمارەی میوان بپشکنە. ماوەیەک هەڵبژێرە کە لە 31 ڕۆژ زیاتر نەبێت.",
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
    filters: "Booking Period filters (optional)",
    timesHint:
      "Shift numbers follow each cottage’s schedule; times vary. Check the cottage’s times before choosing.",
    invalidRange:
      "Check your dates and guest count. Choose a range of at most 31 days.",
    all: "All",
    unavailable: "Search choices could not be loaded right now.",
  },
} as const;

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
  while (cursor <= last && days.length < 31) {
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
  const [defaults, setDefaults] = useState<string[]>([]);
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [invalid, setInvalid] = useState(false);
  const syncDatesFromForm = useCallback((form: HTMLFormElement | null) => {
    if (!form) return;
    const data = new FormData(form);
    setFrom(String(data.get("from") ?? ""));
    setTo(String(data.get("to") ?? ""));
  }, []);
  const days = useMemo(() => serviceDays(from, to), [from, to]);
  const effectiveSelection = (day: string) => selections[day] ?? defaults;

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
      ref={syncDatesFromForm}
      className="retreat-search"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const from = String(data.get("from") ?? "");
        const to = String(data.get("to") ?? "");
        const guests = String(data.get("guests") ?? "");
        const governorate = String(data.get("governorate") ?? "");
        const area = String(data.get("area") ?? "");
        const amenities = data.getAll("amenity").map(String);
        const requested: CottageDiscoverySelection[] = serviceDays(
          from,
          to,
        ).flatMap((day) =>
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
        const queryString = serializeCottageDiscoveryQuery({
          from,
          to,
          selections: requested,
          guests: Number(guests),
          ...(governorate.trim() ? { governorate: governorate.trim() } : {}),
          ...(area.trim() ? { area: area.trim() } : {}),
          amenities,
        });
        const params = new URLSearchParams(queryString);
        const parsed = parseCottageDiscoveryQuery({
          from: params.get("from") ?? undefined,
          to: params.get("to") ?? undefined,
          guests: params.get("guests") ?? undefined,
          selection: params.getAll("selection"),
          governorate: params.get("governorate") ?? undefined,
          area: params.get("area") ?? undefined,
          amenity: params.getAll("amenity"),
        });
        setInvalid(parsed.status === "invalid");
        if (parsed.status === "invalid") return;
        router.push(
          `/${locale}/results?${serializeCottageDiscoveryQuery(parsed.query)}`,
        );
      }}
    >
      <div className="search-fields">
        <label>
          {messages.from}
          <FormControl
            kind="input"
            type="date"
            required
            min={marketplaceToday()}
            name="from"
            defaultValue=""
            onChange={(event) => setFrom(event.target.value)}
          />
        </label>
        <label>
          {messages.to}
          <FormControl
            kind="input"
            type="date"
            required
            min={from}
            name="to"
            defaultValue=""
            onChange={(event) => setTo(event.target.value)}
          />
        </label>
        <label>
          {messages.guests}
          <FormControl
            kind="input"
            type="number"
            min="1"
            max="100"
            required
            name="guests"
            defaultValue={4}
          />
        </label>
        <label>
          {messages.governorate}
          <FormControl kind="select" name="governorate" defaultValue="">
            <option value="">{messages.all}</option>
            {facets.governorates.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </FormControl>
        </label>
        <label>
          {messages.area}
          <FormControl kind="select" name="area" defaultValue="">
            <option value="">{messages.all}</option>
            {facets.areas.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </FormControl>
        </label>
      </div>
      <Disclosure summary={messages.filters}>
        <p>{messages.timesHint}</p>
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
      </Disclosure>
      <OptionGroup legend={messages.amenities} layout="wrap">
        {facets.amenities.map((amenity) => (
          <ChoiceControl
            key={amenity}
            kind="checkbox"
            name="amenity"
            value={amenity}
            defaultChecked={false}
          >
            {publicCottageAmenityName(locale, amenity)}
          </ChoiceControl>
        ))}
      </OptionGroup>
      {invalid ? <p role="alert">{messages.invalidRange}</p> : null}
      <ActionButton kind="primary" width="full" type="submit">
        {messages.submit}
      </ActionButton>
    </form>
  );
}
