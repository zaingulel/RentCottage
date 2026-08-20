"use client";

import { useActionState } from "react";

import {
  loadCottageInventoryAvailabilityAction,
  saveCottageInventoryPricingAction,
  setCottageInventoryAvailabilityAction,
  type CottageInventoryAvailabilityLoadActionState,
  type CottageInventoryActionState,
} from "@/cottage-inventory/actions";
import type {
  CottageInventoryOwnerEditorState,
  CottageInventoryOwnerCalendarState,
  CottageInventoryUnitKind,
} from "@/cottage-inventory/cottage-inventory";
import type { CottageShiftSchedule } from "@/cottage-shift-schedule/cottage-shift-schedule";
import { cottagePricingAvailabilityMessages } from "@/i18n/cottage-pricing-availability-messages";
import { directionFor, type Locale } from "@/i18n/routing";

const idle: CottageInventoryActionState = { status: "idle" };
const availabilityLoadIdle: CottageInventoryAvailabilityLoadActionState = {
  status: "idle",
};

function unreachableCalendarState(value: never): never {
  throw new Error(`Unsupported Cottage Inventory calendar state: ${value}`);
}

type InventoryUnit = {
  id: string;
  kind: CottageInventoryUnitKind;
  label: string;
};

function unitsFor(
  schedule: CottageShiftSchedule | null,
  shiftLabel: string,
  bundleLabel: string,
): InventoryUnit[] {
  if (!schedule) return [];
  return [
    ...schedule.shifts.map((shift, index) => ({
      id: shift.id,
      kind: "shift" as const,
      label: `${shiftLabel} ${index + 1}`,
    })),
    {
      id: schedule.fullDayBundleId,
      kind: "full_day_bundle" as const,
      label: bundleLabel,
    },
  ];
}

function feedback(
  state: CottageInventoryActionState,
  copy: typeof cottagePricingAvailabilityMessages.en,
) {
  if (state.status === "idle") return null;
  if (state.status === "saved") return copy.saved;
  if (state.status === "invalid") return copy.invalid;
  if (state.status === "conflict") return copy.conflict;
  if (state.status === "denied") return copy.denied;
  return copy.unavailable;
}

export function CottagePricingAvailabilityEditor({
  locale,
  profileId,
  schedule,
  pricing,
  editable,
  canOpen,
}: {
  locale: Locale;
  profileId: string;
  schedule: CottageShiftSchedule | null;
  pricing: CottageInventoryOwnerEditorState | null;
  editable: boolean;
  canOpen: boolean;
}) {
  const copy = cottagePricingAvailabilityMessages[locale];
  const [pricingState, pricingAction] = useActionState(
    saveCottageInventoryPricingAction,
    idle,
  );
  const [availabilityState, availabilityAction] = useActionState(
    setCottageInventoryAvailabilityAction,
    idle,
  );
  const [availabilityLoadState, availabilityLoadAction, availabilityPending] =
    useActionState(
      loadCottageInventoryAvailabilityAction,
      availabilityLoadIdle,
    );
  const units = unitsFor(
    schedule,
    locale === "en" ? "Shift" : locale === "ar" ? "المناوبة" : "شیفت",
    locale === "en"
      ? "Full-Day Bundle"
      : locale === "ar"
        ? "باقة اليوم الكامل"
        : "پاکێجی ڕۆژی تەواو",
  );
  const direction = directionFor(locale);
  const priceFeedback = feedback(pricingState, copy);
  const availabilityFeedback = feedback(availabilityState, copy);
  const dayNames = copy.dayNames as readonly string[];
  const pricingByUnit = new Map(
    (pricing?.units ?? []).map((unit) => [`${unit.kind}:${unit.id}`, unit]),
  );
  const pricingHydrated = Boolean(
    pricing &&
    pricingByUnit.size === units.length &&
    units.every((unit) => pricingByUnit.has(`${unit.kind}:${unit.id}`)),
  );
  const availabilityByUnit =
    availabilityLoadState.status === "loaded"
      ? new Map(
          availabilityLoadState.units.map((unit) => [
            `${unit.kind}:${unit.id}`,
            unit,
          ]),
        )
      : null;
  const availabilityHydrated = Boolean(
    availabilityByUnit &&
    availabilityByUnit.size === units.length &&
    units.every((unit) => availabilityByUnit.has(`${unit.kind}:${unit.id}`)),
  );
  const stateLabel = (state: CottageInventoryOwnerCalendarState) => {
    switch (state) {
      case "closed":
        return copy.closed;
      case "open":
        return copy.open;
      case "private_blocked":
        return copy.privateBlocked;
      case "pending_hold":
        return copy.pendingHold;
      case "confirmed_booking":
        return copy.confirmedBooking;
      case "component_unavailable":
        return copy.componentUnavailable;
      default:
        return unreachableCalendarState(state);
    }
  };

  return (
    <section
      className="cottage-pricing-availability-editor"
      dir={direction}
      aria-labelledby="cottage-pricing-availability-title"
    >
      <div className="application-section-heading">
        <span>03</span>
        <div>
          <h2 id="cottage-pricing-availability-title">{copy.title}</h2>
          <p>{copy.intro}</p>
        </div>
      </div>
      {!editable ? (
        <p className="private-location-warning">{copy.readOnly}</p>
      ) : null}
      {!schedule?.scheduleRevisionId ? (
        <p className="cottage-pricing-availability-notice">{copy.noSchedule}</p>
      ) : (
        <>
          {!pricingHydrated ? (
            <p className="cottage-pricing-availability-notice" role="alert">
              {copy.unavailable}
            </p>
          ) : (
            <form action={pricingAction} className="cottage-inventory-form">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="profileId" value={profileId} />
              <input
                type="hidden"
                name="scheduleRevisionId"
                value={schedule.scheduleRevisionId}
              />
              <fieldset
                aria-label={copy.title as string}
                className="cottage-inventory-pricing-group"
                disabled={!editable}
              >
                <div className="cottage-inventory-unit-grid">
                  {units.map((unit) => {
                    const persisted = pricingByUnit.get(
                      `${unit.kind}:${unit.id}`,
                    )!;
                    const standardLabel =
                      locale === "ar"
                        ? `سعر ${unit.label} ${copy.standard}`
                        : locale === "ckb"
                          ? `نرخی ${unit.label} ${copy.standard}`
                          : `${unit.label} ${copy.standard}`;
                    const addWeekdayLabel =
                      locale === "ar"
                        ? `${copy.addWeekday} لـ ${unit.label}`
                        : locale === "ckb"
                          ? `${copy.addWeekday} بۆ ${unit.label}`
                          : `${copy.addWeekday} for ${unit.label}`;
                    const addDateLabel =
                      locale === "ar"
                        ? `${copy.addDate} لـ ${unit.label}`
                        : locale === "ckb"
                          ? `${copy.addDate} بۆ ${unit.label}`
                          : `${copy.addDate} for ${unit.label}`;
                    const unitTitleId = `cottage-inventory-unit-${unit.kind}-${unit.id}`;
                    return (
                      <fieldset
                        aria-labelledby={unitTitleId}
                        className="cottage-inventory-unit"
                        key={`${unit.kind}:${unit.id}`}
                      >
                        <h3
                          className="cottage-inventory-unit-title"
                          id={unitTitleId}
                        >
                          {unit.label}
                        </h3>
                        <input type="hidden" name="unitId" value={unit.id} />
                        <input
                          type="hidden"
                          name="unitKind"
                          value={unit.kind}
                        />
                        <label>
                          {copy.standardVisible}
                          <input
                            name="standardPriceIqd"
                            type="number"
                            min="1"
                            step="1"
                            inputMode="numeric"
                            required
                            aria-label={standardLabel}
                            defaultValue={persisted.standardPriceIqd ?? ""}
                          />
                        </label>
                        {persisted.weekdayOverrides.map((override, index) => (
                          <div
                            className="cottage-inventory-override"
                            key={`weekday:${override.weekday}:${override.priceIqd}`}
                          >
                            <strong>{copy.weekday}</strong>
                            <input
                              type="hidden"
                              name="weekdayUnitId"
                              value={unit.id}
                            />
                            <input
                              type="hidden"
                              name="weekdayUnitKind"
                              value={unit.kind}
                            />
                            <label>
                              <span className="visually-hidden">
                                {copy.weekday}
                              </span>
                              <select
                                name="weekday"
                                defaultValue={override.weekday}
                                aria-label={`${unit.label} ${copy.weekday}${index > 0 ? ` ${index + 1}` : ""}`}
                              >
                                <option value="">{copy.noWeekday}</option>
                                {dayNames.map((day, weekday) => (
                                  <option key={day} value={weekday}>
                                    {day}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              <span className="visually-hidden">
                                {copy.weekday} {copy.standard}
                              </span>
                              <input
                                name="weekdayPriceIqd"
                                type="number"
                                min="1"
                                step="1"
                                inputMode="numeric"
                                defaultValue={override.priceIqd}
                                aria-label={`${unit.label} ${copy.weekday} ${copy.standard}${index > 0 ? ` ${index + 1}` : ""}`}
                              />
                            </label>
                          </div>
                        ))}
                        <details
                          className="cottage-inventory-add-override"
                          key={`weekday:add:${persisted.weekdayOverrides.length}`}
                        >
                          <summary aria-label={addWeekdayLabel}>
                            {copy.addWeekday}
                          </summary>
                          <div className="cottage-inventory-override">
                            <input
                              type="hidden"
                              name="weekdayUnitId"
                              value={unit.id}
                            />
                            <input
                              type="hidden"
                              name="weekdayUnitKind"
                              value={unit.kind}
                            />
                            <label>
                              <span className="visually-hidden">
                                {copy.newWeekday}
                              </span>
                              <select
                                name="weekday"
                                defaultValue=""
                                aria-label={`${unit.label} ${copy.newWeekday}`}
                              >
                                <option value="">{copy.noWeekday}</option>
                                {dayNames.map((day, weekday) => (
                                  <option key={day} value={weekday}>
                                    {day}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              <span className="visually-hidden">
                                {copy.newWeekday} {copy.standard}
                              </span>
                              <input
                                name="weekdayPriceIqd"
                                type="number"
                                min="1"
                                step="1"
                                inputMode="numeric"
                                aria-label={`${unit.label} ${copy.newWeekday} ${copy.standard}`}
                              />
                            </label>
                          </div>
                        </details>
                        {persisted.dateOverrides.map((override, index) => (
                          <div
                            className="cottage-inventory-override"
                            key={`date:${override.serviceDay}:${override.priceIqd}`}
                          >
                            <strong>{copy.date}</strong>
                            <input
                              type="hidden"
                              name="dateUnitId"
                              value={unit.id}
                            />
                            <input
                              type="hidden"
                              name="dateUnitKind"
                              value={unit.kind}
                            />
                            <label>
                              <span className="visually-hidden">
                                {copy.date}
                              </span>
                              <input
                                name="serviceDay"
                                type="date"
                                defaultValue={override.serviceDay}
                                aria-label={`${unit.label} ${copy.date}${index > 0 ? ` ${index + 1}` : ""}`}
                              />
                            </label>
                            <label>
                              <span className="visually-hidden">
                                {copy.date} {copy.standard}
                              </span>
                              <input
                                name="datePriceIqd"
                                type="number"
                                min="1"
                                step="1"
                                inputMode="numeric"
                                defaultValue={override.priceIqd}
                                aria-label={`${unit.label} ${copy.date} ${copy.standard}${index > 0 ? ` ${index + 1}` : ""}`}
                              />
                            </label>
                          </div>
                        ))}
                        <details
                          className="cottage-inventory-add-override"
                          key={`date:add:${persisted.dateOverrides.length}`}
                        >
                          <summary aria-label={addDateLabel}>
                            {copy.addDate}
                          </summary>
                          <div className="cottage-inventory-override">
                            <input
                              type="hidden"
                              name="dateUnitId"
                              value={unit.id}
                            />
                            <input
                              type="hidden"
                              name="dateUnitKind"
                              value={unit.kind}
                            />
                            <label>
                              <span className="visually-hidden">
                                {copy.newDate}
                              </span>
                              <input
                                name="serviceDay"
                                type="date"
                                aria-label={`${unit.label} ${copy.newDate}`}
                              />
                            </label>
                            <label>
                              <span className="visually-hidden">
                                {copy.newDate} {copy.standard}
                              </span>
                              <input
                                name="datePriceIqd"
                                type="number"
                                min="1"
                                step="1"
                                inputMode="numeric"
                                aria-label={`${unit.label} ${copy.newDate} ${copy.standard}`}
                              />
                            </label>
                          </div>
                        </details>
                      </fieldset>
                    );
                  })}
                </div>
              </fieldset>
              {editable ? (
                <button className="action action-primary" type="submit">
                  {copy.savePrices}
                </button>
              ) : null}
              {priceFeedback ? (
                <p role={pricingState.status === "saved" ? "status" : "alert"}>
                  {priceFeedback}
                </p>
              ) : null}
            </form>
          )}

          <form
            action={availabilityLoadAction}
            className="cottage-inventory-form"
          >
            <input type="hidden" name="profileId" value={profileId} />
            <input
              type="hidden"
              name="scheduleRevisionId"
              value={schedule.scheduleRevisionId}
            />
            <fieldset
              aria-labelledby="cottage-inventory-service-day-title"
              className="cottage-inventory-availability-group"
              disabled={availabilityPending}
            >
              <h3
                className="cottage-inventory-group-title"
                id="cottage-inventory-service-day-title"
              >
                {copy.availability}
              </h3>
              <label className="cottage-inventory-service-day">
                {copy.serviceDay}{" "}
                <span aria-hidden="true">({copy.required})</span>
                <input name="serviceDay" type="date" required />
              </label>
            </fieldset>
            <button
              className="action action-secondary"
              type="submit"
              disabled={availabilityPending}
            >
              {copy.loadAvailability}
            </button>
            {availabilityPending ? (
              <p role="status">{copy.loadingAvailability}</p>
            ) : null}
            {availabilityLoadState.status !== "idle" &&
            availabilityLoadState.status !== "loaded" &&
            !availabilityPending ? (
              <p role="alert">{copy.availabilityLoadError}</p>
            ) : null}
          </form>
          {!canOpen ? (
            <p className="cottage-pricing-availability-notice">
              {copy.publicationRequired}
            </p>
          ) : null}
          {availabilityLoadState.status === "loaded" &&
          !availabilityHydrated ? (
            <p role="alert">{copy.availabilityLoadError}</p>
          ) : null}
          {availabilityLoadState.status === "loaded" &&
          availabilityHydrated &&
          !availabilityPending ? (
            editable ? (
              <form
                action={availabilityAction}
                className="cottage-inventory-form"
              >
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="profileId" value={profileId} />
                <input
                  type="hidden"
                  name="scheduleRevisionId"
                  value={schedule.scheduleRevisionId}
                />
                <input
                  type="hidden"
                  name="serviceDay"
                  value={availabilityLoadState.serviceDay}
                />
                <fieldset
                  aria-labelledby="cottage-inventory-loaded-availability-title"
                  className="cottage-inventory-availability-group"
                >
                  <h3
                    className="cottage-inventory-group-title"
                    id="cottage-inventory-loaded-availability-title"
                  >
                    {copy.availability}:{" "}
                    <bdi dir="ltr" style={{ whiteSpace: "nowrap" }}>
                      {availabilityLoadState.serviceDay}
                    </bdi>
                  </h3>
                  <div className="cottage-inventory-availability-grid">
                    {units.map((unit) => {
                      const state = availabilityByUnit!.get(
                        `${unit.kind}:${unit.id}`,
                      )!;
                      return (
                        <div
                          className="cottage-inventory-state"
                          key={`${unit.kind}:${unit.id}`}
                        >
                          <span>
                            {unit.label} {copy.state}
                          </span>
                          {state.editable ? (
                            <>
                              <input
                                type="hidden"
                                name="availabilityUnitId"
                                value={unit.id}
                              />
                              <input
                                type="hidden"
                                name="availabilityUnitKind"
                                value={unit.kind}
                              />
                              <select
                                name="availabilityState"
                                defaultValue={state.calendarState}
                                aria-label={`${unit.label} ${copy.state}`}
                              >
                                <option value="closed">{copy.closed}</option>
                                <option value="open" disabled={!canOpen}>
                                  {copy.open}
                                </option>
                                <option value="private_blocked">
                                  {copy.privateBlocked}
                                </option>
                              </select>
                            </>
                          ) : (
                            <>
                              <output
                                aria-label={`${unit.label} ${copy.state}`}
                              >
                                {stateLabel(state.calendarState)}
                              </output>
                              {state.commitmentReference ? (
                                <span>
                                  {copy.bookingReference}:{" "}
                                  <bdi dir="auto">
                                    {state.commitmentReference}
                                  </bdi>
                                </span>
                              ) : null}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </fieldset>
                <button className="action action-primary" type="submit">
                  {copy.saveAvailability}
                </button>
                {availabilityFeedback ? (
                  <p
                    role={
                      availabilityState.status === "saved" ? "status" : "alert"
                    }
                  >
                    {availabilityFeedback}
                  </p>
                ) : null}
              </form>
            ) : (
              <section className="cottage-inventory-form">
                <h3>
                  {copy.availability}:{" "}
                  <bdi dir="ltr" style={{ whiteSpace: "nowrap" }}>
                    {availabilityLoadState.serviceDay}
                  </bdi>
                </h3>
                <div className="cottage-inventory-availability-grid">
                  {units.map((unit) => {
                    const state = availabilityByUnit!.get(
                      `${unit.kind}:${unit.id}`,
                    )!;
                    return (
                      <div
                        className="cottage-inventory-state"
                        key={`${unit.kind}:${unit.id}`}
                      >
                        <span>
                          {unit.label} {copy.state}
                        </span>
                        <output aria-label={`${unit.label} ${copy.state}`}>
                          {stateLabel(state.calendarState)}
                        </output>
                        {state.commitmentReference ? (
                          <span>
                            {copy.bookingReference}:{" "}
                            <bdi dir="auto">{state.commitmentReference}</bdi>
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </section>
            )
          ) : null}
        </>
      )}
    </section>
  );
}
