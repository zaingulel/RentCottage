"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import {
  hasCompleteCottageBookingSelection,
  serializeCottageDiscoveryQuery,
  type CottageDiscoveryQuery,
  type CottageDiscoverySelection,
} from "@/cottage-discovery/discovery-query";
import type { PublicCottageInventoryUnit } from "@/cottage-discovery/supabase-cottage-discovery";
import { formatIqd, formatServiceDay } from "@/i18n/format";
import { messagingMessages } from "@/i18n/messaging-messages";
import type { Locale } from "@/i18n/routing";
import {
  ActionButton,
  ActionFeedback,
  ActionLink,
} from "./interaction-controls";

const copy = {
  en: {
    title: "Choose your Booking Period",
    fullDay: "Full-day bundle",
    available: "Available",
    unavailable: "Unavailable",
    noPrice: "Price unavailable",
    prices:
      "Prices are per option. The exact quote includes the Booking Service Fee.",
    choose: "Choose at least one available option for every Service Day.",
    quote: "Get exact quote",
    changed:
      "A selected option is no longer available. Remove it and choose again.",
    missing:
      "A selected period is no longer offered. Clear that day's selection and choose again.",
    clear: "Clear selection",
  },
  ar: {
    title: "اختر فترة الحجز",
    fullDay: "اليوم الكامل",
    available: "متاح",
    unavailable: "غير متاح",
    noPrice: "السعر غير متاح",
    prices: "الأسعار لكل خيار. يشمل عرض السعر الدقيق رسوم خدمة الحجز.",
    choose: "اختر خيارًا متاحًا واحدًا على الأقل لكل يوم خدمة.",
    quote: "عرض السعر الدقيق",
    changed: "لم يعد أحد الخيارات المحددة متاحًا. أزله واختر من جديد.",
    missing:
      "لم تعد إحدى الفترات المحددة معروضة. امسح اختيار ذلك اليوم واختر من جديد.",
    clear: "مسح الاختيار",
  },
  ckb: {
    title: "ماوەی حجزەکەت هەڵبژێرە",
    fullDay: "پاکێجی ڕۆژی تەواو",
    available: "بەردەستە",
    unavailable: "بەردەست نییە",
    noPrice: "نرخ بەردەست نییە",
    prices:
      "نرخەکان بۆ هەر هەڵبژاردەیەکن. پێشنیاری نرخی ورد کرێی خزمەتگوزاریی حجز لەخۆ دەگرێت.",
    choose: "بۆ هەر ڕۆژێکی خزمەت لانیکەم یەک هەڵبژاردەی بەردەست هەڵبژێرە.",
    quote: "پێشنیاری نرخی ورد",
    changed:
      "هەڵبژاردەیەکی دیاریکراو ئیتر بەردەست نییە. لایببە و دووبارە هەڵبژێرە.",
    missing:
      "ماوەیەکی دیاریکراو ئیتر پێشکەش ناکرێت. هەڵبژاردنی ئەو ڕۆژە بسڕەوە و دووبارە هەڵبژێرە.",
    clear: "سڕینەوەی هەڵبژاردن",
  },
} as const;

function matches(
  selection: CottageDiscoverySelection,
  unit: PublicCottageInventoryUnit,
) {
  return (
    selection.serviceDay === unit.serviceDay &&
    selection.kind === unit.kind &&
    (selection.kind === "full-day" || selection.position === unit.position)
  );
}

export function CottageBookingPeriodPicker({
  locale,
  slug,
  query,
  inventory,
}: {
  locale: Locale;
  slug: string;
  query: CottageDiscoveryQuery;
  inventory: PublicCottageInventoryUnit[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const messages = copy[locale];
  const complete = hasCompleteCottageBookingSelection(query);
  const available = query.selections.every((selection) =>
    inventory.some((unit) => matches(selection, unit) && unit.available),
  );
  const queryString = serializeCottageDiscoveryQuery(query);
  const days = [...new Set(inventory.map((unit) => unit.serviceDay))];

  function replaceSelection(selections: CottageDiscoverySelection[]) {
    startTransition(() =>
      router.replace(
        `/${locale}/cottages/${slug}?${serializeCottageDiscoveryQuery({ ...query, selections })}`,
        { scroll: false },
      ),
    );
  }

  function toggle(unit: PublicCottageInventoryUnit) {
    const selected = query.selections.some((selection) =>
      matches(selection, unit),
    );
    const selection: CottageDiscoverySelection =
      unit.kind === "full-day"
        ? { serviceDay: unit.serviceDay, kind: "full-day" }
        : {
            serviceDay: unit.serviceDay,
            kind: "shift",
            position: unit.position as 1 | 2 | 3,
          };
    const selections = selected
      ? query.selections.filter((item) => !matches(item, unit))
      : [
          ...query.selections.filter(
            (item) =>
              item.serviceDay !== unit.serviceDay ||
              (unit.kind === "shift" && item.kind === "shift"),
          ),
          selection,
        ];
    selections.sort(
      (left, right) =>
        left.serviceDay.localeCompare(right.serviceDay) ||
        (left.kind === "shift" && right.kind === "shift"
          ? left.position - right.position
          : 0),
    );
    replaceSelection(selections);
  }

  return (
    <>
      <h2>{messages.title}</h2>
      <p>{messages.prices}</p>
      {!available && (
        <ActionFeedback kind="error">{messages.changed}</ActionFeedback>
      )}
      {days.map((day) => (
        <fieldset
          className="booking-period-options"
          key={day}
          disabled={pending}
        >
          <legend>{formatServiceDay(day, locale, { weekday: true })}</legend>
          {query.selections.some(
            (selection) =>
              selection.serviceDay === day &&
              !inventory.some((unit) => matches(selection, unit)),
          ) && (
            <>
              <p className="field-error">{messages.missing}</p>
              <ActionButton
                kind="secondary"
                size="regular"
                type="button"
                disabled={pending}
                onClick={() =>
                  replaceSelection(
                    query.selections.filter(
                      (selection) => selection.serviceDay !== day,
                    ),
                  )
                }
              >
                {messages.clear}
              </ActionButton>
            </>
          )}
          <ul className="result-shifts">
            {inventory
              .filter((unit) => unit.serviceDay === day)
              .map((unit) => {
                const selected = query.selections.some((selection) =>
                  matches(selection, unit),
                );
                return (
                  <li key={`${unit.kind}-${unit.position ?? "full"}`}>
                    <ActionButton
                      kind="toggle"
                      size="regular"
                      type="button"
                      pressed={selected}
                      disabled={pending || (!unit.available && !selected)}
                      onClick={() => toggle(unit)}
                    >
                      {unit.kind === "full-day" ? messages.fullDay : unit.name}
                    </ActionButton>
                    <bdi dir="ltr">
                      {unit.startTime}–{unit.endTime}
                    </bdi>
                    <b>
                      {unit.priceIqd === null
                        ? messages.noPrice
                        : formatIqd(unit.priceIqd, locale)}
                    </b>
                    <span>
                      {unit.available
                        ? messages.available
                        : messages.unavailable}
                    </span>
                  </li>
                );
              })}
          </ul>
        </fieldset>
      ))}
      {!complete && <p>{messages.choose}</p>}
      {complete && available && !pending ? (
        <ActionLink
          kind="primary"
          width="full"
          href={`/${locale}/request/${slug}?${queryString}`}
        >
          {messages.quote}
        </ActionLink>
      ) : (
        <ActionButton
          kind="primary"
          width="full"
          type="button"
          disabled
          pending={pending}
        >
          {messages.quote}
        </ActionButton>
      )}
      {complete && !pending ? (
        <ActionLink
          kind="secondary"
          width="full"
          href={`/${locale}/messages?cottage=${slug}&${queryString}`}
        >
          {messagingMessages[locale].messageCottage}
        </ActionLink>
      ) : (
        <ActionButton
          kind="secondary"
          width="full"
          size="regular"
          type="button"
          disabled
          pending={pending}
        >
          {messagingMessages[locale].messageCottage}
        </ActionButton>
      )}
    </>
  );
}
