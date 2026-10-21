export type CottageInventoryUnitKind = "shift" | "full_day_bundle";

export interface CottageInventoryWeekdayPriceOverride {
  weekday: number;
  priceIqd: number;
}

export interface CottageInventoryDatePriceOverride {
  serviceDay: string;
  priceIqd: number;
}

export interface CottageInventoryPriceUnitInput {
  id: string;
  kind: CottageInventoryUnitKind;
  standardPriceIqd: number;
  weekdayOverrides?: CottageInventoryWeekdayPriceOverride[];
  dateOverrides?: CottageInventoryDatePriceOverride[];
}

export interface CottageInventoryPricingInput {
  units: CottageInventoryPriceUnitInput[];
}

export type CottageInventoryAvailabilityState =
  | "open"
  | "closed"
  | "private_blocked";

export interface CottageInventoryAvailabilityUnitInput {
  id: string;
  kind: CottageInventoryUnitKind;
  state: CottageInventoryAvailabilityState;
}

export interface CottageInventoryAvailabilityInput {
  units: CottageInventoryAvailabilityUnitInput[];
}

export interface CottageInventoryCoordinate {
  serviceDay: string;
  id: string;
  kind: CottageInventoryUnitKind;
}

export interface CottageInventoryReviewedCell extends CottageInventoryCoordinate {
  expectedOwnerState: CottageInventoryAvailabilityState;
}

export interface CottageInventoryAvailabilityBatchInput {
  from: string;
  to: string;
  unitKeys: Array<{ id: string; kind: CottageInventoryUnitKind }>;
  state: CottageInventoryAvailabilityState;
  mode: "range" | "reviewed";
  cells: CottageInventoryReviewedCell[];
  replacePrivateBlocks: CottageInventoryCoordinate[];
  reviewConfirmed: boolean;
}

export const cottageInventoryBatchConflictReasons = [
  "temporary_unavailable",
  "pending_hold",
  "confirmed_booking",
  "component_unavailable",
  "stale_state",
  "private_block_consent_required",
  "started",
  "publication_required",
  "bundle_components_unavailable",
  "open_bundle_dependency",
] as const;

export interface CottageInventoryBatchConflict extends CottageInventoryCoordinate {
  reason: (typeof cottageInventoryBatchConflictReasons)[number];
  commitmentReference: string | null;
}

export interface CottageInventoryBatchSaved {
  status: "saved";
  profileId: string;
  scheduleRevisionId: string;
  request: CottageInventoryAvailabilityBatchInput;
  changed: CottageInventoryCoordinate[];
  unchanged: CottageInventoryCoordinate[];
}

export interface CottageInventoryBatchRefused {
  status: "refused";
  profileId: string;
  scheduleRevisionId: string;
  request: CottageInventoryAvailabilityBatchInput;
  conflicts: CottageInventoryBatchConflict[];
  eligible: CottageInventoryReviewedCell[];
  calendar: CottageInventoryOwnerCalendarSpan;
}

export type CottageInventoryBatchReceipt =
  | CottageInventoryBatchSaved
  | CottageInventoryBatchRefused;
export type CottageInventoryBatchResult =
  | CottageInventoryBatchReceipt
  | { status: "invalid"; fields: string[] }
  | { status: "conflict" | "denied" | "unavailable" };

export interface CottageInventoryPublicAvailabilityUnit {
  id: string;
  kind: CottageInventoryUnitKind;
  available: boolean;
}

export interface CottageInventoryPublicAvailability {
  profileId: string;
  scheduleRevisionId: string;
  serviceDay: string;
  units: CottageInventoryPublicAvailabilityUnit[];
}

export type CottageInventoryOwnerCalendarState =
  | CottageInventoryAvailabilityState
  | "pending_hold"
  | "confirmed_booking"
  | "component_unavailable";

export interface CottageInventoryOwnerCalendarUnit {
  id: string;
  kind: CottageInventoryUnitKind;
  priceIqd: number | null;
  available: boolean;
  calendarState: CottageInventoryOwnerCalendarState;
  commitmentReference: string | null;
  editable: boolean;
}

export interface CottageInventoryOwnerCalendar {
  profileId: string;
  scheduleRevisionId: string;
  serviceDay: string;
  units: CottageInventoryOwnerCalendarUnit[];
}

export type CottageInventoryOwnerCalendarSpanUnit = Omit<
  CottageInventoryOwnerCalendarUnit,
  "calendarState"
> & {
  ownerState: CottageInventoryAvailabilityState;
  calendarState: CottageInventoryOwnerCalendarState | null;
  temporarilyUnavailable: boolean;
};

export interface CottageInventoryOwnerCalendarSpan {
  profileId: string;
  scheduleRevisionId: string;
  from: string;
  to: string;
  asOf: string;
  unitKeys: Array<{ id: string; kind: CottageInventoryUnitKind }>;
  days: Array<{
    serviceDay: string;
    units: CottageInventoryOwnerCalendarSpanUnit[];
  }>;
}

export type CottageInventoryOwnerCalendarSpanResult =
  | { status: "resolved"; calendar: CottageInventoryOwnerCalendarSpan }
  | { status: "invalid"; fields: string[] }
  | { status: "conflict" | "denied" | "unavailable" };

export interface CottageInventoryOwnerEditorUnit {
  id: string;
  kind: CottageInventoryUnitKind;
  standardPriceIqd: number | null;
  weekdayOverrides: CottageInventoryWeekdayPriceOverride[];
  dateOverrides: CottageInventoryDatePriceOverride[];
  ownerState?: CottageInventoryAvailabilityState;
}

export interface CottageInventoryOwnerEditorState {
  profileId: string;
  scheduleRevisionId: string;
  serviceDay: string | null;
  units: CottageInventoryOwnerEditorUnit[];
}

export interface CottageInventoryRepository {
  loadOwnerEditorState(input: {
    profileId: string;
    scheduleRevisionId: string;
    serviceDay?: string;
  }): Promise<CottageInventoryOwnerEditorState>;
  savePricing(input: {
    profileId: string;
    scheduleRevisionId: string;
    pricing: CottageInventoryPricingInput;
  }): Promise<unknown>;
  setAvailabilityBatch(input: {
    profileId: string;
    scheduleRevisionId: string;
    batch: CottageInventoryAvailabilityBatchInput;
  }): Promise<CottageInventoryBatchReceipt>;
  setAvailability(input: {
    profileId: string;
    scheduleRevisionId: string;
    serviceDay: string;
    availability: CottageInventoryAvailabilityInput;
  }): Promise<unknown>;
  resolvePublicAvailability(input: {
    profileId: string;
    scheduleRevisionId: string;
    serviceDay: string;
  }): Promise<CottageInventoryPublicAvailability>;
  resolveOwnerCalendarSpan(input: {
    profileId: string;
    scheduleRevisionId: string;
    from: string;
    to: string;
  }): Promise<CottageInventoryOwnerCalendarSpan>;
  resolveOwnerCalendar(input: {
    profileId: string;
    scheduleRevisionId: string;
    serviceDay: string;
  }): Promise<CottageInventoryOwnerCalendar>;
}

export type CottageInventoryPricingSaveResult =
  | { status: "saved"; value: unknown }
  | { status: "invalid"; fields: string[] }
  | { status: "conflict" | "denied" | "unavailable" };

export type CottageInventoryPublicAvailabilityResult =
  | { status: "resolved"; resolution: CottageInventoryPublicAvailability }
  | { status: "invalid"; fields: string[] }
  | { status: "conflict" | "denied" | "unavailable" };

export type CottageInventoryOwnerCalendarResult =
  | { status: "resolved"; calendar: CottageInventoryOwnerCalendar }
  | { status: "invalid"; fields: string[] }
  | { status: "conflict" | "denied" | "unavailable" };

export type CottageInventoryAvailabilitySaveResult =
  | { status: "saved"; value: unknown }
  | { status: "invalid"; fields: string[] }
  | { status: "conflict" | "denied" | "unavailable" };

export type CottageInventoryOwnerEditorLoadResult =
  | { status: "loaded"; state: CottageInventoryOwnerEditorState }
  | { status: "invalid"; fields: string[] }
  | { status: "conflict" | "denied" | "unavailable" };

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const serviceDayPattern = /^\d{4}-\d{2}-\d{2}$/;

function isValidServiceDay(value: unknown): value is string {
  if (typeof value !== "string" || !serviceDayPattern.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function ownerCalendarSpanLength(from: string, to: string): number {
  if (from < "0001-01-01" || from > to) return 0;
  const length = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
  return length <= 31 ? length : 0;
}

function parsePricing(
  value: unknown,
):
  | { status: "valid"; pricing: CottageInventoryPricingInput }
  | { status: "invalid"; fields: string[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { status: "invalid", fields: ["pricing"] };
  }
  const units = (value as Record<string, unknown>).units;
  if (!Array.isArray(units) || units.length === 0) {
    return { status: "invalid", fields: ["units"] };
  }
  const invalid: string[] = [];
  const parsed: CottageInventoryPriceUnitInput[] = units.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      invalid.push(`units.${index}`);
      return {
        id: "",
        kind: "shift" as const,
        standardPriceIqd: 0,
      };
    }
    const unit = value as Record<string, unknown>;
    const id = typeof unit.id === "string" ? unit.id : "";
    const kind = unit.kind;
    const standardPriceIqd = unit.standardPriceIqd;
    if (!uuidPattern.test(id)) invalid.push(`units.${index}.id`);
    if (kind !== "shift" && kind !== "full_day_bundle") {
      invalid.push(`units.${index}.kind`);
    }
    if (
      typeof standardPriceIqd !== "number" ||
      !Number.isSafeInteger(standardPriceIqd) ||
      standardPriceIqd <= 0
    ) {
      invalid.push(`units.${index}.standardPriceIqd`);
    }
    const weekdayOverrides = unit.weekdayOverrides;
    const dateOverrides = unit.dateOverrides;
    const parsedWeekdayOverrides: CottageInventoryWeekdayPriceOverride[] = [];
    const parsedDateOverrides: CottageInventoryDatePriceOverride[] = [];
    if (weekdayOverrides !== undefined) {
      if (!Array.isArray(weekdayOverrides)) {
        invalid.push(`units.${index}.weekdayOverrides`);
      } else {
        weekdayOverrides.forEach((override, overrideIndex) => {
          const candidate =
            override && typeof override === "object" && !Array.isArray(override)
              ? (override as Record<string, unknown>)
              : undefined;
          if (
            !candidate ||
            !Number.isInteger(candidate.weekday) ||
            Number(candidate.weekday) < 0 ||
            Number(candidate.weekday) > 6 ||
            !Number.isSafeInteger(candidate.priceIqd) ||
            Number(candidate.priceIqd) <= 0
          ) {
            invalid.push(`units.${index}.weekdayOverrides.${overrideIndex}`);
            return;
          }
          parsedWeekdayOverrides.push({
            weekday: candidate.weekday as number,
            priceIqd: candidate.priceIqd as number,
          });
        });
      }
    }
    if (dateOverrides !== undefined) {
      if (!Array.isArray(dateOverrides)) {
        invalid.push(`units.${index}.dateOverrides`);
      } else {
        dateOverrides.forEach((override, overrideIndex) => {
          const candidate =
            override && typeof override === "object" && !Array.isArray(override)
              ? (override as Record<string, unknown>)
              : undefined;
          if (
            !candidate ||
            !isValidServiceDay(candidate.serviceDay) ||
            !Number.isSafeInteger(candidate.priceIqd) ||
            Number(candidate.priceIqd) <= 0
          ) {
            invalid.push(`units.${index}.dateOverrides.${overrideIndex}`);
            return;
          }
          parsedDateOverrides.push({
            serviceDay: candidate.serviceDay as string,
            priceIqd: candidate.priceIqd as number,
          });
        });
      }
    }
    return {
      id,
      kind:
        kind === "full_day_bundle"
          ? ("full_day_bundle" as const)
          : ("shift" as const),
      standardPriceIqd:
        typeof standardPriceIqd === "number" ? standardPriceIqd : 0,
      ...(parsedWeekdayOverrides.length > 0
        ? { weekdayOverrides: parsedWeekdayOverrides }
        : {}),
      ...(parsedDateOverrides.length > 0
        ? { dateOverrides: parsedDateOverrides }
        : {}),
    };
  });
  if (invalid.length > 0) return { status: "invalid", fields: invalid };
  return { status: "valid", pricing: { units: parsed } };
}

function parseAvailability(
  value: unknown,
):
  | { status: "valid"; availability: CottageInventoryAvailabilityInput }
  | { status: "invalid"; fields: string[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { status: "invalid", fields: ["availability"] };
  }
  const units = (value as Record<string, unknown>).units;
  if (!Array.isArray(units) || units.length === 0) {
    return { status: "invalid", fields: ["units"] };
  }
  const invalid: string[] = [];
  const parsed: CottageInventoryAvailabilityUnitInput[] = units.map(
    (value, index) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        invalid.push(`units.${index}`);
        return {
          id: "",
          kind: "shift" as const,
          state: "closed" as const,
        };
      }
      const unit = value as Record<string, unknown>;
      const id = typeof unit.id === "string" ? unit.id : "";
      const kind = unit.kind;
      const state = unit.state;
      if (!uuidPattern.test(id)) invalid.push(`units.${index}.id`);
      if (kind !== "shift" && kind !== "full_day_bundle") {
        invalid.push(`units.${index}.kind`);
      }
      if (
        state !== "open" &&
        state !== "closed" &&
        state !== "private_blocked"
      ) {
        invalid.push(`units.${index}.state`);
      }
      return {
        id,
        kind:
          kind === "full_day_bundle"
            ? ("full_day_bundle" as const)
            : ("shift" as const),
        state:
          state === "open"
            ? ("open" as const)
            : state === "private_blocked"
              ? ("private_blocked" as const)
              : ("closed" as const),
      };
    },
  );
  if (invalid.length > 0) return { status: "invalid", fields: invalid };
  return { status: "valid", availability: { units: parsed } };
}

function parseAvailabilityBatch(
  value: unknown,
): CottageInventoryAvailabilityBatchInput | undefined {
  const object = (value: unknown): Record<string, unknown> | undefined =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  const exact = (value: Record<string, unknown>, keys: string[]) =>
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
  const state = (value: unknown): value is CottageInventoryAvailabilityState =>
    value === "open" || value === "closed" || value === "private_blocked";
  const key = (value: { id: string; kind: string; serviceDay?: string }) =>
    `${value.serviceDay ?? ""}|${value.kind}|${value.id}`;
  const order = <T extends { id: string; kind: string; serviceDay?: string }>(
    values: T[],
  ) => values.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  const input = object(value);
  if (
    !input ||
    !exact(input, [
      "from",
      "to",
      "unitKeys",
      "state",
      "mode",
      "cells",
      "replacePrivateBlocks",
      "reviewConfirmed",
    ]) ||
    !isValidServiceDay(input.from) ||
    !isValidServiceDay(input.to)
  )
    return;
  const spanLength = ownerCalendarSpanLength(input.from, input.to);
  if (
    spanLength === 0 ||
    !state(input.state) ||
    (input.mode !== "range" && input.mode !== "reviewed") ||
    typeof input.reviewConfirmed !== "boolean" ||
    input.reviewConfirmed !== (input.mode === "reviewed") ||
    !Array.isArray(input.unitKeys) ||
    input.unitKeys.length < 1 ||
    input.unitKeys.length > 4 ||
    !Array.isArray(input.cells) ||
    input.cells.length < 1 ||
    input.cells.length > 124 ||
    !Array.isArray(input.replacePrivateBlocks)
  )
    return;
  const unitKeys: CottageInventoryAvailabilityBatchInput["unitKeys"] = [];
  for (const value of input.unitKeys) {
    const unit = object(value);
    if (
      !unit ||
      !exact(unit, ["id", "kind"]) ||
      typeof unit.id !== "string" ||
      !uuidPattern.test(unit.id) ||
      (unit.kind !== "shift" && unit.kind !== "full_day_bundle")
    )
      return;
    unitKeys.push({ id: unit.id.toLowerCase(), kind: unit.kind });
  }
  const selected = new Set(unitKeys.map(key));
  if (selected.size !== unitKeys.length) return;
  const cells: CottageInventoryReviewedCell[] = [];
  const seen = new Set<string>();
  for (const value of input.cells) {
    const cell = object(value);
    if (
      !cell ||
      !exact(cell, ["serviceDay", "id", "kind", "expectedOwnerState"]) ||
      typeof cell.id !== "string" ||
      !uuidPattern.test(cell.id) ||
      (cell.kind !== "shift" && cell.kind !== "full_day_bundle") ||
      !state(cell.expectedOwnerState) ||
      !isValidServiceDay(cell.serviceDay) ||
      cell.serviceDay < input.from ||
      cell.serviceDay > input.to
    )
      return;
    const parsed: CottageInventoryReviewedCell = {
      serviceDay: cell.serviceDay,
      id: cell.id.toLowerCase(),
      kind: cell.kind,
      expectedOwnerState: cell.expectedOwnerState,
    };
    if (
      !selected.has(key({ id: parsed.id, kind: parsed.kind })) ||
      seen.has(key(parsed))
    )
      return;
    seen.add(key(parsed));
    cells.push(parsed);
  }
  const fullCount = spanLength * unitKeys.length;
  if (
    input.mode === "range"
      ? cells.length !== fullCount
      : cells.length >= fullCount
  )
    return;
  const replacePrivateBlocks: CottageInventoryCoordinate[] = [];
  const consentKeys = new Set<string>();
  for (const value of input.replacePrivateBlocks) {
    const consent = object(value);
    if (
      !consent ||
      !exact(consent, ["serviceDay", "id", "kind"]) ||
      typeof consent.id !== "string" ||
      !uuidPattern.test(consent.id) ||
      (consent.kind !== "shift" && consent.kind !== "full_day_bundle") ||
      !isValidServiceDay(consent.serviceDay)
    )
      return;
    const parsed: CottageInventoryCoordinate = {
      serviceDay: consent.serviceDay,
      id: consent.id.toLowerCase(),
      kind: consent.kind,
    };
    if (
      consentKeys.has(key(parsed)) ||
      input.state === "private_blocked" ||
      !cells.some(
        (cell) =>
          key(cell) === key(parsed) &&
          cell.expectedOwnerState === "private_blocked",
      )
    )
      return;
    consentKeys.add(key(parsed));
    replacePrivateBlocks.push(parsed);
  }
  return {
    from: input.from,
    to: input.to,
    unitKeys: order(unitKeys),
    state: input.state,
    mode: input.mode,
    cells: order(cells),
    replacePrivateBlocks: order(replacePrivateBlocks),
    reviewConfirmed: input.reviewConfirmed,
  };
}

function providerCode(error: unknown): string | undefined {
  let candidate = error;
  for (let depth = 0; depth < 8; depth += 1) {
    if (!candidate || typeof candidate !== "object") return undefined;
    const value = candidate as { code?: unknown; cause?: unknown };
    if (typeof value.code === "string") return value.code;
    candidate = value.cause;
  }
  return undefined;
}

function mapFailure(error: unknown): "conflict" | "denied" | "unavailable" {
  const code = providerCode(error);
  if (code === "RC409") return "conflict";
  if (code === "42501" || code === "RC202") return "denied";
  return "unavailable";
}

export function createCottageInventory(repository: CottageInventoryRepository) {
  return {
    async loadOwnerEditorState(
      profileId: string,
      scheduleRevisionId: string,
      serviceDay?: string,
    ): Promise<CottageInventoryOwnerEditorLoadResult> {
      if (
        !uuidPattern.test(profileId) ||
        !uuidPattern.test(scheduleRevisionId)
      ) {
        return { status: "invalid", fields: ["inventory"] };
      }
      if (serviceDay !== undefined && !isValidServiceDay(serviceDay)) {
        return { status: "invalid", fields: ["serviceDay"] };
      }
      try {
        return {
          status: "loaded",
          state: await repository.loadOwnerEditorState({
            profileId,
            scheduleRevisionId,
            ...(serviceDay ? { serviceDay } : {}),
          }),
        };
      } catch (error) {
        return { status: mapFailure(error) };
      }
    },

    async savePricing(
      profileId: string,
      scheduleRevisionId: string,
      input: unknown,
    ): Promise<CottageInventoryPricingSaveResult> {
      if (
        !uuidPattern.test(profileId) ||
        !uuidPattern.test(scheduleRevisionId)
      ) {
        return { status: "invalid", fields: ["pricing"] };
      }
      const parsed = parsePricing(input);
      if (parsed.status !== "valid") return parsed;
      try {
        const value = await repository.savePricing({
          profileId,
          scheduleRevisionId,
          pricing: parsed.pricing,
        });
        return { status: "saved", value };
      } catch (error) {
        return { status: mapFailure(error) };
      }
    },

    async resolvePublicAvailability(
      profileId: string,
      scheduleRevisionId: string,
      serviceDay: string,
    ): Promise<CottageInventoryPublicAvailabilityResult> {
      if (
        !uuidPattern.test(profileId) ||
        !uuidPattern.test(scheduleRevisionId) ||
        !isValidServiceDay(serviceDay)
      ) {
        return { status: "invalid", fields: ["resolution"] };
      }
      try {
        return {
          status: "resolved",
          resolution: await repository.resolvePublicAvailability({
            profileId,
            scheduleRevisionId,
            serviceDay,
          }),
        };
      } catch (error) {
        return { status: mapFailure(error) };
      }
    },

    async resolveOwnerCalendarSpan(
      profileId: string,
      scheduleRevisionId: string,
      from: string,
      to: string,
    ): Promise<CottageInventoryOwnerCalendarSpanResult> {
      if (
        !uuidPattern.test(profileId) ||
        !uuidPattern.test(scheduleRevisionId) ||
        !isValidServiceDay(from) ||
        !isValidServiceDay(to) ||
        ownerCalendarSpanLength(from, to) === 0
      ) {
        return { status: "invalid", fields: ["calendar"] };
      }
      try {
        return {
          status: "resolved",
          calendar: await repository.resolveOwnerCalendarSpan({
            profileId,
            scheduleRevisionId,
            from,
            to,
          }),
        };
      } catch (error) {
        return { status: mapFailure(error) };
      }
    },

    async resolveOwnerCalendar(
      profileId: string,
      scheduleRevisionId: string,
      serviceDay: string,
    ): Promise<CottageInventoryOwnerCalendarResult> {
      if (
        !uuidPattern.test(profileId) ||
        !uuidPattern.test(scheduleRevisionId) ||
        !isValidServiceDay(serviceDay)
      ) {
        return { status: "invalid", fields: ["calendar"] };
      }
      try {
        return {
          status: "resolved",
          calendar: await repository.resolveOwnerCalendar({
            profileId,
            scheduleRevisionId,
            serviceDay,
          }),
        };
      } catch (error) {
        return { status: mapFailure(error) };
      }
    },

    async setAvailabilityBatch(
      profileId: string,
      scheduleRevisionId: string,
      input: unknown,
    ): Promise<CottageInventoryBatchResult> {
      const batch = parseAvailabilityBatch(input);
      if (
        !uuidPattern.test(profileId) ||
        !uuidPattern.test(scheduleRevisionId) ||
        !batch
      ) {
        return { status: "invalid", fields: ["batch"] };
      }
      try {
        return await repository.setAvailabilityBatch({
          profileId: profileId.toLowerCase(),
          scheduleRevisionId: scheduleRevisionId.toLowerCase(),
          batch,
        });
      } catch (error) {
        return providerCode(error) === "22023"
          ? { status: "invalid", fields: ["batch"] }
          : { status: mapFailure(error) };
      }
    },

    async setAvailability(
      profileId: string,
      scheduleRevisionId: string,
      serviceDay: string,
      input: unknown,
    ): Promise<CottageInventoryAvailabilitySaveResult> {
      if (
        !uuidPattern.test(profileId) ||
        !uuidPattern.test(scheduleRevisionId) ||
        !isValidServiceDay(serviceDay)
      ) {
        return { status: "invalid", fields: ["availability"] };
      }
      const parsed = parseAvailability(input);
      if (parsed.status !== "valid") return parsed;
      try {
        const value = await repository.setAvailability({
          profileId,
          scheduleRevisionId,
          serviceDay,
          availability: parsed.availability,
        });
        return { status: "saved", value };
      } catch (error) {
        return { status: mapFailure(error) };
      }
    },
  };
}
