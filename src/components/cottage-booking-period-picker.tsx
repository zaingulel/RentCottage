"use client";

import {
  BookingPeriodIdentity,
  BookingPeriodEndpoints,
  BookingPeriodAccessSummary,
} from "./booking-period-details";
import { bookingPeriodMessages } from "@/i18n/booking-period-messages";
import {
  inventoryAccessBounds,
  inventoryDayPresentation,
} from "@/booking-quote/booking-period-presentation";
import type { BookingQuoteItem } from "@/booking-quote/booking-quote";
import { useRouter } from "next/navigation";
import { useId, useTransition } from "react";

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
  ActionFocusTarget,
  ActionLink,
} from "./interaction-controls";

const copy = {
  en: {
    title: "Choose your Booking Period",
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
  const headingId = useId();
  const [pending, startTransition] = useTransition();
  const messages = copy[locale];
  const periodCopy = bookingPeriodMessages[locale];
  const complete = hasCompleteCottageBookingSelection(query);
  const available = query.selections.every((selection) =>
    inventory.some((unit) => matches(selection, unit) && unit.available),
  );
  const queryString = serializeCottageDiscoveryQuery(query);
  const days = [...new Set(inventory.map((unit) => unit.serviceDay))];

  const selectedItems = inventory
    .filter(
      (unit) =>
        unit.available &&
        query.selections.some((selection) => matches(selection, unit)),
    )
    .map(
      (unit): BookingQuoteItem => ({
        serviceDay: unit.serviceDay,
        displayName: unit.name,
        ...inventoryAccessBounds(unit),
        priceIqd: unit.priceIqd!,
        ...(unit.kind === "full-day"
          ? { kind: "full-day" }
          : { kind: "shift", position: unit.position as 1 | 2 | 3 }),
      }),
    );

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
      <h2 id={headingId} tabIndex={-1} className="action-focus-target">
        {messages.title}
      </h2>
      {!pending && <ActionFocusTarget targetId={headingId} />}
      <p>{messages.prices}</p>
      <p>{periodCopy.choose}</p>
      <p>{periodCopy.fullDaySchedule}</p>
      <p>{periodCopy.fullDayPrice}</p>
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
                focusSuccessorId={headingId}
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
          <ul className="booking-period-list">
            {inventory
              .filter((unit) => unit.serviceDay === day)
              .map((unit) => {
                const selected = query.selections.some((selection) =>
                  matches(selection, unit),
                );
                const optionId = `${headingId}-${day}-${unit.kind}-${unit.position ?? "full"}`;
                return (
                  <li key={`${unit.kind}-${unit.position ?? "full"}`}>
                    <ActionButton
                      kind="toggle"
                      size="regular"
                      type="button"
                      pressed={selected}
                      disabled={pending || (!unit.available && !selected)}
                      focusSuccessorId={headingId}
                      aria-labelledby={`${optionId}-name`}
                      aria-describedby={`${optionId}-time ${optionId}-price${selected ? ` ${optionId}-selected` : ""}${unit.available ? "" : ` ${optionId}-unavailable`}`}
                      onClick={() => toggle(unit)}
                    >
                      <span className="booking-period-label">
                        <span id={`${optionId}-name`}>
                          <BookingPeriodIdentity
                            locale={locale}
                            kind={unit.kind}
                            position={unit.position}
                            originalName={unit.name}
                            presentation={inventoryDayPresentation(
                              inventory.filter(
                                (option) => option.serviceDay === day,
                              ),
                            )}
                          />
                        </span>
                        <b id={`${optionId}-price`}>
                          <bdi dir="auto">
                            {unit.priceIqd === null
                              ? messages.noPrice
                              : formatIqd(unit.priceIqd, locale)}
                          </bdi>
                        </b>
                        <span
                          className="booking-period-time"
                          id={`${optionId}-time`}
                        >
                          <BookingPeriodEndpoints
                            locale={locale}
                            {...inventoryAccessBounds(unit)}
                          />
                          {unit.kind === "full-day" &&
                          inventoryDayPresentation(
                            inventory.filter(
                              (option) => option.serviceDay === day,
                            ),
                          ) === "morning-evening-v1" ? (
                            <span className="booking-period-explanation">
                              {periodCopy.fullDayIncludes}
                            </span>
                          ) : null}
                        </span>
                        {selected ? (
                          <span id={`${optionId}-selected`}>
                            {periodCopy.selected}
                          </span>
                        ) : null}
                      </span>
                    </ActionButton>
                    {!unit.available && (
                      <span
                        className="booking-period-unavailable"
                        id={`${optionId}-unavailable`}
                      >
                        {messages.unavailable}
                      </span>
                    )}
                  </li>
                );
              })}
          </ul>
        </fieldset>
      ))}
      {available && !pending ? (
        <BookingPeriodAccessSummary locale={locale} items={selectedItems} />
      ) : null}
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
