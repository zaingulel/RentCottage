import { Fragment } from "react";
import {
  continuousFullDayAccess,
  type BookingQuoteItem,
} from "@/booking-quote/booking-quote";
import {
  bookingPeriodAccessGaps,
  type BookingPeriodPresentation,
} from "@/booking-quote/booking-period-presentation";
import { bookingPeriodMessages } from "@/i18n/booking-period-messages";
import { formatIraqDateTime } from "@/i18n/format";
import type { Locale } from "@/i18n/routing";

export function BookingPeriodIdentity({
  locale,
  kind,
  position,
  originalName,
  presentation,
}: {
  locale: Locale;
  kind: "shift" | "full-day";
  position?: number;
  originalName: string;
  presentation?: BookingPeriodPresentation;
}) {
  const copy = bookingPeriodMessages[locale];
  const knownFullDay =
    presentation === "morning-evening-v1" && kind === "full-day";
  const identity =
    presentation === "morning-evening-v1"
      ? kind === "full-day"
        ? copy.fullDay
        : position === 1
          ? copy.morning
          : copy.evening
      : originalName;
  return (
    <span className="booking-period-identity">
      <strong>
        {!knownFullDay && identity === originalName ? (
          <bdi dir="auto">{originalName}</bdi>
        ) : (
          identity
        )}
      </strong>
      {!knownFullDay ? " " : null}
      {!knownFullDay && identity !== originalName ? (
        <bdi dir="auto">{originalName}</bdi>
      ) : null}
    </span>
  );
}

function EndpointTime({ value, locale }: { value: string; locale: Locale }) {
  return (
    <bdi className="booking-period-timestamp" dir="auto">
      <time dateTime={value}>
        {formatIraqDateTime(value, locale, { hourCycle: "h23" })}
      </time>
    </bdi>
  );
}

export function BookingPeriodEndpoints({
  locale,
  startsAt,
  endsAt,
  crossesMidnight,
}: {
  locale: Locale;
  startsAt: string;
  endsAt: string;
  crossesMidnight: boolean;
}) {
  const copy = bookingPeriodMessages[locale];
  return (
    <span className="booking-period-endpoints">
      <span>
        {copy.arrival}: <EndpointTime value={startsAt} locale={locale} />
      </span>{" "}
      <span>
        {copy.departure}: <EndpointTime value={endsAt} locale={locale} />
        {crossesMidnight ? <> ({copy.nextDay})</> : null}
      </span>{" "}
      <span className="booking-period-explanation">{copy.iraqTimeZone}</span>
    </span>
  );
}

export function BookingPeriodAccessSummary({
  locale,
  items,
}: {
  locale: Locale;
  items: readonly BookingQuoteItem[];
}) {
  const copy = bookingPeriodMessages[locale];
  const bundles = continuousFullDayAccess([...items]);
  const ranges = [
    ...bundles,
    ...items.filter((item) => item.kind === "shift"),
  ].sort((left, right) => left.startsAt.localeCompare(right.startsAt));
  const gaps = bookingPeriodAccessGaps(items);
  if (items.length === 0) return null;
  return (
    <div className="booking-period-access-summary quote-access">
      <h3>{copy.selectedAccess}</h3>
      {bundles.length > 0 ? (
        <>
          <p>{copy.fullDaySchedule}</p>
          <p>{copy.fullDayPrice}</p>
        </>
      ) : null}
      {bundles.some((range) => range.fromServiceDay !== range.toServiceDay) ? (
        <p>{copy.consecutive}</p>
      ) : null}
      <ul>
        {ranges.map((range, index) => (
          <li key={`${range.startsAt}-${index}`}>
            <BookingPeriodEndpoints
              locale={locale}
              startsAt={range.startsAt}
              endsAt={range.endsAt}
              crossesMidnight={
                "crossesMidnight" in range
                  ? range.crossesMidnight
                  : range.fromServiceDay === range.toServiceDay &&
                    range.endsAt.slice(0, 10) > range.startsAt.slice(0, 10)
              }
            />
          </li>
        ))}
      </ul>
      {gaps.map((gap) => (
        <p className="booking-period-gap" key={gap.startsAt}>
          {copy.gap.split(/(\{departure\}|\{arrival\})/).map((part, index) => (
            <Fragment key={index}>
              {part === "{departure}" ? (
                <EndpointTime value={gap.startsAt} locale={locale} />
              ) : part === "{arrival}" ? (
                <EndpointTime value={gap.endsAt} locale={locale} />
              ) : (
                part
              )}
            </Fragment>
          ))}
        </p>
      ))}
    </div>
  );
}
