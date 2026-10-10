"use client";

import { useActionState, useId, useState } from "react";

import {
  saveCottageShiftScheduleAction,
  type CottageShiftScheduleActionState,
} from "@/cottage-shift-schedule/actions";
import {
  readCottageShiftSchedule,
  type CottageShiftSchedule,
} from "@/cottage-shift-schedule/cottage-shift-schedule";
import { cottageShiftScheduleMessages } from "@/i18n/cottage-shift-schedule-messages";
import type { Locale } from "@/i18n/routing";

import {
  ActionButton,
  ActionFeedback,
  ChoiceControl,
  FormControl,
} from "./interaction-controls";

const idle: CottageShiftScheduleActionState = { status: "idle" };

function AccessRange({
  template,
  start,
  end,
}: {
  template: string;
  start: string;
  end: string;
}) {
  return template.split(/(\{start\}|\{end\})/).map((part, index) =>
    part === "{start}" || part === "{end}" ? (
      <bdi dir="ltr" key={index}>
        {part === "{start}" ? start : end}
      </bdi>
    ) : (
      part
    ),
  );
}

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
  const checkId = useId();
  const [draft, setDraft] = useState(
    schedule?.shifts.map(({ name, startTime, endTime }) => ({
      name,
      startTime,
      endTime,
    })) ?? [
      { name: "", startTime: "", endTime: "" },
      { name: "", startTime: "", endTime: "" },
    ],
  );
  const [baseline, setBaseline] = useState(schedule);
  const [confirmed, setConfirmed] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [state, action, pending] = useActionState(
    async (previous: CottageShiftScheduleActionState, formData: FormData) => {
      const result = await saveCottageShiftScheduleAction(previous, formData);
      setConfirmed(false);
      if (result.status === "saved") {
        setBaseline(result.schedule);
        setDraft(
          result.schedule.shifts.map(({ name, startTime, endTime }) => ({
            name,
            startTime,
            endTime,
          })),
        );
        setAttempted(false);
      }
      setShowFeedback(true);
      return result;
    },
    idle,
  );
  const legacy = baseline?.shifts.length === 3;
  const canEdit = editable && !legacy;
  const blocked = pending || state.status === "conflict";
  const reading = readCottageShiftSchedule({
    shifts: draft.map((shift, index) => ({
      ...shift,
      name: shift.name.trim() || (index === 0 ? copy.morning : copy.evening),
    })),
  });
  const hasTimes = draft.some((shift) => shift.startTime || shift.endTime);
  const invalidFields =
    reading.status === "invalid"
      ? reading.fields
      : reading.status === "overlap"
        ? draft.flatMap((_, index) => [
            `shifts.${index}.startTime`,
            `shifts.${index}.endTime`,
          ])
        : [];
  const draftError =
    reading.status === "overlap"
      ? copy.overlap
      : reading.status === "invalid" && (hasTimes || attempted)
        ? copy.invalid
        : attempted && !confirmed
          ? copy.requiredConfirmation
          : null;
  const coverage = legacy
    ? baseline
    : reading.status === "valid"
      ? reading
      : null;
  const feedback = state.status === "idle" ? null : copy[state.status];

  function edit(
    index: number,
    field: keyof (typeof draft)[number],
    value: string,
  ) {
    setDraft(
      draft.map((shift, row) =>
        row === index ? { ...shift, [field]: value } : shift,
      ),
    );
    setConfirmed(false);
    setAttempted(false);
    setShowFeedback(false);
  }

  return (
    <section className="cottage-shift-schedule-editor">
      <h2 className="section-title">{copy.title}</h2>
      <p>{copy.intro}</p>
      {!canEdit ? <p>{legacy ? copy.legacyRead : copy.readOnly}</p> : null}
      <form
        action={action}
        className="cottage-shift-schedule-form"
        noValidate
        onSubmit={(event) => {
          if (reading.status === "valid" && confirmed) return;
          event.preventDefault();
          setAttempted(true);
          const firstInvalid = invalidFields[0];
          const field = firstInvalid
            ? event.currentTarget.querySelector<HTMLInputElement>(
                `[id="${checkId}-${firstInvalid}"]`,
              )
            : event.currentTarget.querySelector<HTMLInputElement>(
                '[name="confirmedTimes"]',
              );
          field?.focus();
        }}
      >
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="profileId" value={profileId} />
        <input
          type="hidden"
          name="expectedRevision"
          value={baseline?.revision ?? 0}
        />
        <p className="cottage-shift-guidance">
          {copy.iraqTimeZone.split("UTC+3").map((part, index) => (
            <span key={index}>
              {index > 0 ? <bdi dir="ltr">UTC+3</bdi> : null}
              {part}
            </span>
          ))}
        </p>
        <p className="cottage-shift-guidance">{copy.clockFormat}</p>
        <div className="cottage-shift-grid">
          {draft.map((shift, index) => {
            const identity = index === 0 ? copy.morning : copy.evening;
            const fields = [
              { field: "name", name: "shiftName", label: copy.localName },
              {
                field: "startTime",
                name: "shiftStartTime",
                label: copy.startTime,
              },
              { field: "endTime", name: "shiftEndTime", label: copy.endTime },
            ] as const;
            return (
              <fieldset
                className="cottage-shift-row"
                key={index}
                disabled={!canEdit || blocked}
              >
                <legend>
                  {legacy ? <bdi dir="auto">{shift.name}</bdi> : identity}
                </legend>
                {fields.map(({ field, name, label }) => {
                  const invalid =
                    !legacy &&
                    invalidFields.includes(`shifts.${index}.${field}`) &&
                    (hasTimes || attempted);
                  return (
                    <label key={field}>
                      {label}
                      <FormControl
                        kind="input"
                        id={`${checkId}-shifts.${index}.${field}`}
                        name={name}
                        type={field === "name" ? "text" : "time"}
                        dir={field === "name" ? "auto" : "ltr"}
                        required={field !== "name"}
                        value={shift[field]}
                        aria-invalid={invalid || undefined}
                        aria-describedby={checkId}
                        onChange={(event) =>
                          edit(index, field, event.target.value)
                        }
                      />
                    </label>
                  );
                })}
                {!legacy && shift.name.trim() ? (
                  <p className="cottage-shift-guidance">
                    <bdi dir="auto">{shift.name}</bdi>
                  </p>
                ) : null}
                {legacy || reading.status === "valid" ? (
                  <p className="cottage-shift-guidance">
                    {legacy ? (
                      <bdi dir="auto">{shift.name}</bdi>
                    ) : index === 0 ? (
                      copy.morningAccess
                    ) : (
                      copy.eveningAccess
                    )}
                    {": "}
                    <AccessRange
                      template={copy.accessRange}
                      start={shift.startTime}
                      end={shift.endTime}
                    />{" "}
                    {shift.endTime < shift.startTime
                      ? copy.nextDay
                      : copy.sameDay}
                  </p>
                ) : null}
              </fieldset>
            );
          })}
        </div>
        <p className="cottage-shift-guidance">{copy.crossMidnight}</p>
        <div
          id={checkId}
          role="status"
          aria-label={copy.fullDayAccess}
          className="cottage-full-day-summary"
        >
          {coverage ? (
            <>
              {!legacy ? <p>{copy.fullDayIncludes}</p> : null}
              <dl className="fact-list">
                <div>
                  <dt>{copy.fullDayAccess}</dt>
                  <dd>
                    <strong>
                      <AccessRange
                        template={copy.accessRange}
                        start={coverage.fullDayStartTime}
                        end={coverage.fullDayEndTime}
                      />{" "}
                      {coverage.fullDayCrossesMidnight
                        ? copy.nextDay
                        : copy.sameDay}
                    </strong>
                    {!legacy && draft[0].endTime !== draft[1].startTime ? (
                      <span>
                        <AccessRange
                          template={copy.includingGap}
                          start={draft[0].endTime}
                          end={draft[1].startTime}
                        />
                      </span>
                    ) : null}
                  </dd>
                </div>
                {!legacy ? (
                  <div>
                    <dt>{copy.betweenShifts}</dt>
                    <dd>{copy.fullDayBetweenShifts}</dd>
                  </div>
                ) : null}
              </dl>
            </>
          ) : (
            <p>{copy.fullDayEmpty}</p>
          )}
          {canEdit && draftError ? (
            <p className="field-error">{draftError}</p>
          ) : null}
        </div>
        {!legacy ? (
          <div className="cottage-shift-guidance">
            <p>
              <strong>{copy.cleaningTitle}</strong>
            </p>
            <p>{copy.cleaning}</p>
            <p>{copy.independentPrices}</p>
            <p>{copy.reset}</p>
          </div>
        ) : null}
        {canEdit && reading.status === "valid" ? (
          <ChoiceControl
            kind="checkbox"
            name="confirmedTimes"
            required
            checked={confirmed}
            disabled={blocked}
            aria-invalid={(attempted && !confirmed) || undefined}
            aria-describedby={checkId}
            onChange={(event) => setConfirmed(event.target.checked)}
          >
            {copy.confirmedTimes}
          </ChoiceControl>
        ) : null}
        {canEdit ? (
          <ActionButton
            kind="primary"
            width="content"
            type="submit"
            pending={pending}
            disabled={blocked}
          >
            {copy.save}
          </ActionButton>
        ) : null}
        {showFeedback && feedback ? (
          <ActionFeedback kind={state.status === "saved" ? "success" : "error"}>
            {feedback}
          </ActionFeedback>
        ) : null}
      </form>
    </section>
  );
}
