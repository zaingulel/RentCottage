"use client";

import { startTransition, useEffect, useId, useRef, useState } from "react";

import {
  loadCottageInventoryCalendarSpanAction,
  type CottageInventoryCalendarSpanLoadActionState,
} from "@/cottage-inventory/actions";
import type {
  CottageInventoryOwnerCalendarState,
  CottageInventoryUnitKind,
} from "@/cottage-inventory/cottage-inventory";
import { cottagePricingAvailabilityMessages } from "@/i18n/cottage-pricing-availability-messages";
import { cottageShiftScheduleMessages } from "@/i18n/cottage-shift-schedule-messages";
import { directionFor, type Locale } from "@/i18n/routing";

import { CottageAccessRange } from "./cottage-access-range";
import {
  ActionButton,
  ActionFeedback,
  ActionFocusTarget,
  FormControl,
} from "./interaction-controls";

export type CottageAvailabilityCalendarUnit = {
  id: string;
  kind: CottageInventoryUnitKind;
  label: string;
  identity: string;
  localName?: string;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
};

function baghdadDate(instant: Date) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Baghdad",
    calendar: "gregory",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const part = (name: Intl.DateTimeFormatPartTypes) =>
    parts.find((value) => value.type === name)!.value;
  return {
    day: `${part("year").padStart(4, "0")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}:${part("second")}`,
  };
}

function monthEnd(month: string) {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1, 0);
  return date.toISOString().slice(0, 10);
}

function weekStart(serviceDay: string) {
  const date = new Date(`${serviceDay}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 1) % 7));
  return date.toISOString().slice(0, 10);
}

export function CottageAvailabilityCalendar({
  locale,
  profileId,
  scheduleRevisionId,
  units,
  refreshKey,
}: {
  locale: Locale;
  profileId: string;
  scheduleRevisionId: string;
  units: readonly CottageAvailabilityCalendarUnit[];
  refreshKey: number;
}) {
  const copy = cottagePricingAvailabilityMessages[locale];
  const scheduleCopy = cottageShiftScheduleMessages[locale];
  const calendarHeadingId = useId();
  const scope = JSON.stringify([profileId, scheduleRevisionId]);
  const [view, setView] = useState<{
    scope: string;
    date: string;
    provisionalMonth: string;
    navigated: boolean;
    server: ReturnType<typeof baghdadDate> | null;
    initiator: "previous" | "next" | "retry" | null;
  } | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [outcome, setOutcome] = useState<{
    key: string;
    result: CottageInventoryCalendarSpanLoadActionState;
  } | null>(null);
  const generation = useRef(0);
  const navigationIntent = useRef(false);
  const currentView = view?.scope === scope ? view : null;
  const month = currentView?.date.slice(0, 7) ?? null;
  const unitIdentity = units
    .map((unit) => `${unit.kind}:${unit.id}`)
    .sort()
    .join("|");
  const requestKey = JSON.stringify([
    scope,
    month,
    refreshKey,
    unitIdentity,
    retryKey,
  ]);
  useEffect(() => {
    navigationIntent.current = false;
    const provisionalMonth = baghdadDate(new Date()).day.slice(0, 7);
    // The browser clock is read after hydration; a scope reset must not wait for another pending action.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setView({
      scope,
      provisionalMonth,
      date: `${provisionalMonth}-01`,
      navigated: false,
      server: null,
      initiator: null,
    });
  }, [scope]);
  useEffect(() => {
    if (!month) return;
    let active = true;
    const requestGeneration = ++generation.current;
    const from = `${month}-01`;
    const to = monthEnd(month);
    const formData = new FormData();
    for (const [name, value] of Object.entries({
      profileId,
      scheduleRevisionId,
      from,
      to,
    }))
      formData.set(name, value);
    startTransition(async () => {
      try {
        let response = await loadCottageInventoryCalendarSpanAction(
          { status: "idle" },
          formData,
        );
        if (!active || requestGeneration !== generation.current) return;
        if (response.status === "loaded") {
          const calendar = response.calendar;
          const returnedIdentity = calendar.unitKeys
            .map((unit) => `${unit.kind}:${unit.id}`)
            .sort()
            .join("|");
          if (
            calendar.profileId !== profileId ||
            calendar.scheduleRevisionId !== scheduleRevisionId ||
            calendar.from !== from ||
            calendar.to !== to ||
            returnedIdentity !== unitIdentity
          ) {
            response = { status: "unavailable" };
          } else {
            const server = baghdadDate(new Date(calendar.asOf));
            const serverMonth = server.day.slice(0, 7);
            // A browser date is only a starting hint; the accepted server snapshot owns the lower bound.
            setView((current) =>
              current?.scope === scope
                ? {
                    ...current,
                    server,
                    date:
                      !current.navigated ||
                      current.date.slice(0, 7) < serverMonth
                        ? `${serverMonth}-01`
                        : current.date,
                  }
                : current,
            );
            if (
              month < serverMonth ||
              (!navigationIntent.current && month !== serverMonth)
            )
              return;
          }
        }
        setView((current) =>
          current?.scope === scope ? { ...current, initiator: null } : current,
        );
        setOutcome({ key: requestKey, result: response });
      } catch {
        if (active && requestGeneration === generation.current) {
          setView((current) =>
            current?.scope === scope
              ? { ...current, initiator: null }
              : current,
          );
          setOutcome({ key: requestKey, result: { status: "unavailable" } });
        }
      }
    });
    return () => {
      active = false;
    };
  }, [
    month,
    profileId,
    scheduleRevisionId,
    scope,
    refreshKey,
    unitIdentity,
    requestKey,
  ]);
  const result = outcome?.key === requestKey ? outcome.result : null;
  const pending = result === null;
  const lowerMonth =
    currentView?.server?.day.slice(0, 7) ?? currentView?.provisionalMonth;
  function navigate(date: string, initiator: "previous" | "next" | null) {
    if (!date || !currentView || !lowerMonth) return;
    const nextDate = date.slice(0, 7) < lowerMonth ? `${lowerMonth}-01` : date;
    navigationIntent.current = true;
    setView({ ...currentView, date: nextDate, navigated: true, initiator });
  }
  function adjacentMonth(offset: number) {
    const date = new Date(`${month}-01T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + offset);
    return date.toISOString().slice(0, 10);
  }
  const labels: Record<
    CottageInventoryOwnerCalendarState,
    string | readonly string[]
  > = {
    closed: copy.closed,
    open: copy.open,
    private_blocked: copy.privateBlocked,
    pending_hold: copy.pendingHold,
    confirmed_booking: copy.confirmedBooking,
    component_unavailable: copy.componentUnavailable,
  };
  const failureCopy =
    result?.status === "invalid"
      ? copy.calendarInvalid
      : result?.status === "conflict"
        ? copy.calendarConflict
        : result?.status === "denied"
          ? copy.calendarDenied
          : copy.calendarUnavailable;
  const showRetry =
    (!pending && result?.status !== "loaded") ||
    (pending && currentView?.initiator === "retry");
  const calendar = result?.status === "loaded" ? result.calendar : null;
  const weeks = calendar
    ? calendar.days.reduce<(typeof calendar.days)[]>((all, day) => {
        if (
          !all.length ||
          new Date(`${day.serviceDay}T00:00:00Z`).getUTCDay() === 6
        )
          all.push([]);
        all[all.length - 1]!.push(day);
        return all;
      }, [])
    : [];
  return (
    <section className="cottage-calendar" dir={directionFor(locale)}>
      <h3
        id={calendarHeadingId}
        tabIndex={-1}
        className="section-title action-focus-target"
      >
        {copy.calendarHeading}
      </h3>
      <div className="cottage-calendar-navigation">
        <ActionButton
          kind="secondary"
          size="regular"
          type="button"
          focusSuccessorId={calendarHeadingId}
          pending={pending && currentView?.initiator === "previous"}
          disabled={!month || month === lowerMonth}
          onClick={() => navigate(adjacentMonth(-1), "previous")}
        >
          {copy.calendarPrevious}
        </ActionButton>
        <label>
          {copy.calendarShowDate}
          <FormControl
            kind="input"
            type="date"
            value={currentView?.date ?? ""}
            min={lowerMonth ? `${lowerMonth}-01` : undefined}
            max="9999-12-31"
            onChange={(event) => {
              if (!event.currentTarget.validity.rangeOverflow)
                navigate(event.currentTarget.value, null);
            }}
          />
        </label>
        <ActionButton
          kind="secondary"
          size="regular"
          type="button"
          focusSuccessorId={calendarHeadingId}
          pending={pending && currentView?.initiator === "next"}
          disabled={!month || month === "9999-12"}
          onClick={() => navigate(adjacentMonth(1), "next")}
        >
          {copy.calendarNext}
        </ActionButton>
      </div>
      {showRetry ? (
        <ActionButton
          kind="secondary"
          size="regular"
          type="button"
          focusSuccessorId={calendarHeadingId}
          pending={pending && currentView?.initiator === "retry"}
          onClick={() => {
            if (!currentView) return;
            setView({ ...currentView, initiator: "retry" });
            setRetryKey((key) => key + 1);
          }}
        >
          {copy.calendarRetry}
        </ActionButton>
      ) : null}
      {!pending && <ActionFocusTarget targetId={calendarHeadingId} />}
      {!calendar ? (
        pending ? (
          <p role="status">{copy.calendarLoading}</p>
        ) : (
          <ActionFeedback kind="error">{failureCopy}</ActionFeedback>
        )
      ) : (
        <>
          <ActionFeedback kind="success">
            {copy.calendarLoaded}: <bdi dir="ltr">{month}</bdi>
          </ActionFeedback>
          <p>
            {copy.calendarSnapshot}:{" "}
            <bdi dir="ltr">
              {currentView?.server?.day} {currentView?.server?.time}
            </bdi>
          </p>
          <ol className="cottage-calendar-weeks">
            {weeks.map((week) => (
              <li className="cottage-calendar-week" key={week[0]!.serviceDay}>
                <h4>
                  {copy.calendarWeek}{" "}
                  <bdi dir="ltr">{weekStart(week[0]!.serviceDay)}</bdi>
                </h4>
                <ol className="cottage-calendar-days">
                  {week.map((day) => (
                    <li
                      className="cottage-calendar-day"
                      key={day.serviceDay}
                      style={{
                        gridColumnStart:
                          ((new Date(
                            `${day.serviceDay}T00:00:00Z`,
                          ).getUTCDay() +
                            1) %
                            7) +
                          1,
                      }}
                    >
                      <h5>
                        <time dateTime={day.serviceDay} dir="ltr">
                          {day.serviceDay}
                        </time>
                      </h5>
                      {currentView?.server &&
                      day.serviceDay < currentView.server.day ? (
                        <p>{copy.calendarPast}</p>
                      ) : null}
                      <ul
                        className="cottage-calendar-units"
                        aria-label={day.serviceDay}
                      >
                        {units.map((unit) => {
                          const cell = day.units.find(
                            (value) =>
                              value.kind === unit.kind && value.id === unit.id,
                          )!;
                          return (
                            <li key={`${unit.kind}:${unit.id}`}>
                              <strong>
                                {unit.identity}
                                {unit.localName !== undefined ? (
                                  <>
                                    : <bdi dir="auto">{unit.localName}</bdi>
                                  </>
                                ) : null}
                              </strong>
                              <span>
                                <CottageAccessRange
                                  template={scheduleCopy.accessRange}
                                  start={unit.startTime}
                                  end={unit.endTime}
                                />{" "}
                                (
                                {unit.crossesMidnight
                                  ? scheduleCopy.nextDay
                                  : scheduleCopy.sameDay}
                                )
                              </span>
                              <span>
                                {cell.temporarilyUnavailable
                                  ? copy.calendarTemporary
                                  : labels[cell.calendarState!]}
                              </span>
                              {cell.calendarState === "open" &&
                              !cell.available ? (
                                <span>{copy.calendarNotBookable}</span>
                              ) : null}
                              {currentView?.server &&
                              day.serviceDay === currentView.server.day &&
                              unit.startTime <=
                                currentView.server.time.slice(0, 5) ? (
                                <span>{copy.calendarStarted}</span>
                              ) : !cell.editable ? (
                                <span>{copy.calendarProtected}</span>
                              ) : null}
                              {cell.commitmentReference ? (
                                <span>
                                  {copy.bookingReference}:{" "}
                                  <bdi dir="auto">
                                    {cell.commitmentReference}
                                  </bdi>
                                </span>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
