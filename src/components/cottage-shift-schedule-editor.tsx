"use client";

import { useActionState } from "react";

import {
  saveCottageShiftScheduleAction,
  type CottageShiftScheduleActionState,
} from "@/cottage-shift-schedule/actions";
import type { CottageShiftSchedule } from "@/cottage-shift-schedule/cottage-shift-schedule";
import { cottageShiftScheduleMessages } from "@/i18n/cottage-shift-schedule-messages";
import type { Locale } from "@/i18n/routing";

const idle: CottageShiftScheduleActionState = { status: "idle" };

export function CottageShiftScheduleEditor({
  locale,
  profileId,
  schedule,
  editable,
}: {
  locale: Locale;
  profileId: string;
  schedule: CottageShiftSchedule | null;
  editable: boolean;
}) {
  const copy = cottageShiftScheduleMessages[locale];
  const [state, action] = useActionState(saveCottageShiftScheduleAction, idle);
  const rows = Array.from({ length: 3 }, (_, index) => schedule?.shifts[index]);
  const feedback =
    state.status === "idle"
      ? null
      : state.status === "saved"
        ? copy.saved
        : state.status === "invalid"
          ? copy.invalid
          : state.status === "overlap"
            ? copy.overlap
            : state.status === "conflict"
              ? copy.conflict
              : state.status === "denied"
                ? copy.denied
                : copy.unavailable;

  return (
    <section className="cottage-shift-schedule-editor">
      <div className="application-section-heading">
        <span>02</span>
        <div>
          <h2>{copy.title}</h2>
          <p>{copy.intro}</p>
        </div>
      </div>
      {!editable ? (
        <p className="private-location-warning">{copy.readOnly}</p>
      ) : null}
      <form action={action} className="cottage-shift-schedule-form">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="profileId" value={profileId} />
        <input
          type="hidden"
          name="expectedRevision"
          value={schedule?.revision ?? 0}
        />
        <fieldset disabled={!editable}>
          <legend className="visually-hidden">{copy.title}</legend>
          <div className="cottage-shift-grid">
            {rows.map((shift, index) => {
              const number = index + 1;
              return (
                <fieldset className="cottage-shift-row" key={number}>
                  <legend>
                    {copy.shift} {number} ·{" "}
                    {index < 2 ? copy.required : copy.optional}
                  </legend>
                  <label>
                    {copy.shift} {number} {copy.name}
                    <input
                      name="shiftName"
                      defaultValue={shift?.name ?? ""}
                      required={index < 2}
                    />
                  </label>
                  <label>
                    {copy.shift} {number} {copy.startTime}
                    <input
                      name="shiftStartTime"
                      type="time"
                      defaultValue={shift?.startTime ?? ""}
                      required={index < 2}
                    />
                  </label>
                  <label>
                    {copy.shift} {number} {copy.endTime}
                    <input
                      name="shiftEndTime"
                      type="time"
                      defaultValue={shift?.endTime ?? ""}
                      required={index < 2}
                    />
                  </label>
                </fieldset>
              );
            })}
          </div>
        </fieldset>
        <p className="cottage-shift-guidance">{copy.crossMidnight}</p>
        <div className="cottage-full-day-summary">
          <strong>{copy.fullDay}</strong>
          <span>
            {schedule
              ? `${schedule.fullDayStartTime} → ${schedule.fullDayEndTime}${schedule.fullDayCrossesMidnight ? ` (${copy.nextDay})` : ""}`
              : copy.fullDayEmpty}
          </span>
        </div>
        {editable ? (
          <button className="action action-primary" type="submit">
            {copy.save}
          </button>
        ) : null}
        {feedback ? (
          <p role={state.status === "saved" ? "status" : "alert"}>{feedback}</p>
        ) : null}
      </form>
    </section>
  );
}
