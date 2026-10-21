import type { SupabaseClient } from "@supabase/supabase-js";

import { cottageInventoryBatchConflictReasons } from "./cottage-inventory";

import type {
  CottageInventoryBatchReceipt,
  CottageInventoryCoordinate,
  CottageInventoryReviewedCell,
  CottageInventoryBatchConflict,
  CottageInventoryAvailabilityBatchInput,
  CottageInventoryRepository,
  CottageInventoryOwnerEditorState,
  CottageInventoryOwnerEditorUnit,
  CottageInventoryOwnerCalendar,
  CottageInventoryOwnerCalendarSpan,
  CottageInventoryOwnerCalendarSpanUnit,
  CottageInventoryUnitKind,
  CottageInventoryOwnerCalendarUnit,
  CottageInventoryPublicAvailability,
  CottageInventoryPublicAvailabilityUnit,
} from "./cottage-inventory";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const serviceDayPattern = /^\d{4}-\d{2}-\d{2}$/;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Cottage Inventory provider data is invalid");
  }
  return value as Record<string, unknown>;
}

function requiredUuid(value: unknown): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new Error("Cottage Inventory provider data is invalid");
  }
  return value;
}

function requiredServiceDay(value: unknown): string {
  if (
    typeof value !== "string" ||
    !serviceDayPattern.test(value) ||
    Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
  ) {
    throw new Error("Cottage Inventory provider data is invalid");
  }
  return value;
}

function optionalPrice(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const price = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(price) || price <= 0) {
    throw new Error("Cottage Inventory provider data is invalid");
  }
  return price;
}

function exactKeys(value: Record<string, unknown>, expected: string[]) {
  const expectedKeys = [...expected].sort();
  const actualKeys = Object.keys(value).sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error("Cottage Inventory provider data is invalid");
  }
}

function parsePublicUnit(
  value: unknown,
): CottageInventoryPublicAvailabilityUnit {
  const unit = record(value);
  exactKeys(unit, ["id", "kind", "available"]);
  const id = requiredUuid(unit.id);
  if (unit.kind !== "shift" && unit.kind !== "full_day_bundle") {
    throw new Error("Cottage Inventory provider data is invalid");
  }
  if (typeof unit.available !== "boolean") {
    throw new Error("Cottage Inventory provider data is invalid");
  }
  return { id, kind: unit.kind, available: unit.available };
}

function ownerState(value: unknown) {
  if (value !== "open" && value !== "closed" && value !== "private_blocked") {
    throw new Error("Cottage Inventory provider data is invalid");
  }
  return value;
}

function parseOwnerEditorUnit(
  value: unknown,
  serviceDay: string | undefined,
): CottageInventoryOwnerEditorUnit {
  const unit = record(value);
  const id = requiredUuid(unit.id);
  if (unit.kind !== "shift" && unit.kind !== "full_day_bundle") {
    throw new Error("Cottage Inventory provider data is invalid");
  }
  if (
    !Array.isArray(unit.weekdayOverrides) ||
    !Array.isArray(unit.dateOverrides)
  ) {
    throw new Error("Cottage Inventory provider data is invalid");
  }
  const weekdayOverrides = unit.weekdayOverrides.map((value) => {
    const override = record(value);
    const weekday = Number(override.weekday);
    const priceIqd = optionalPrice(override.priceIqd);
    if (
      !Number.isInteger(weekday) ||
      weekday < 0 ||
      weekday > 6 ||
      priceIqd === null
    ) {
      throw new Error("Cottage Inventory provider data is invalid");
    }
    return { weekday, priceIqd };
  });
  const dateOverrides = unit.dateOverrides.map((value) => {
    const override = record(value);
    const priceIqd = optionalPrice(override.priceIqd);
    if (priceIqd === null) {
      throw new Error("Cottage Inventory provider data is invalid");
    }
    return { serviceDay: requiredServiceDay(override.serviceDay), priceIqd };
  });
  if (serviceDay && unit.ownerState === undefined) {
    throw new Error("Cottage Inventory provider data is invalid");
  }
  if (!serviceDay && unit.ownerState !== undefined) {
    throw new Error("Cottage Inventory provider data is invalid");
  }
  return {
    id,
    kind: unit.kind,
    standardPriceIqd: optionalPrice(unit.standardPriceIqd),
    weekdayOverrides,
    dateOverrides,
    ...(serviceDay ? { ownerState: ownerState(unit.ownerState) } : {}),
  };
}

function parseOwnerEditorState(
  value: unknown,
  expected: {
    profileId: string;
    scheduleRevisionId: string;
    serviceDay?: string;
  },
): CottageInventoryOwnerEditorState {
  const state = record(value);
  const returnedServiceDay =
    state.serviceDay === null ? null : requiredServiceDay(state.serviceDay);
  if (
    requiredUuid(state.profileId) !== expected.profileId ||
    requiredUuid(state.scheduleRevisionId) !== expected.scheduleRevisionId ||
    returnedServiceDay !== (expected.serviceDay ?? null) ||
    !Array.isArray(state.units) ||
    state.units.length < 3 ||
    state.units.length > 4
  ) {
    throw new Error("Cottage Inventory provider data is invalid");
  }
  return {
    profileId: expected.profileId,
    scheduleRevisionId: expected.scheduleRevisionId,
    serviceDay: returnedServiceDay,
    units: state.units.map((unit) =>
      parseOwnerEditorUnit(unit, expected.serviceDay),
    ),
  };
}

function parseEnvelope(
  value: unknown,
  expected: {
    profileId: string;
    scheduleRevisionId: string;
    serviceDay: string;
  },
): Record<string, unknown> {
  const resolution = record(value);
  if (
    requiredUuid(resolution.profileId) !== expected.profileId ||
    requiredUuid(resolution.scheduleRevisionId) !==
      expected.scheduleRevisionId ||
    requiredServiceDay(resolution.serviceDay) !== expected.serviceDay ||
    !Array.isArray(resolution.units) ||
    resolution.units.length < 3 ||
    resolution.units.length > 4
  ) {
    throw new Error("Cottage Inventory provider data is invalid");
  }
  return resolution;
}

function parsePublicAvailability(
  value: unknown,
  expected: {
    profileId: string;
    scheduleRevisionId: string;
    serviceDay: string;
  },
): CottageInventoryPublicAvailability {
  const resolution = parseEnvelope(value, expected);
  exactKeys(resolution, [
    "profileId",
    "scheduleRevisionId",
    "serviceDay",
    "units",
  ]);
  return {
    ...expected,
    units: (resolution.units as unknown[]).map(parsePublicUnit),
  };
}

function calendarState(
  value: unknown,
): CottageInventoryOwnerCalendarUnit["calendarState"] {
  if (
    ![
      "open",
      "closed",
      "private_blocked",
      "pending_hold",
      "confirmed_booking",
      "component_unavailable",
    ].includes(String(value))
  ) {
    throw new Error("Cottage Inventory provider data is invalid");
  }
  return value as CottageInventoryOwnerCalendarUnit["calendarState"];
}

function parseOwnerCalendarUnit(
  value: unknown,
): CottageInventoryOwnerCalendarUnit {
  const unit = record(value);
  exactKeys(unit, [
    "id",
    "kind",
    "priceIqd",
    "available",
    "calendarState",
    "commitmentReference",
    "editable",
  ]);
  if (
    (unit.kind !== "shift" && unit.kind !== "full_day_bundle") ||
    typeof unit.available !== "boolean" ||
    typeof unit.editable !== "boolean" ||
    (unit.commitmentReference !== null &&
      typeof unit.commitmentReference !== "string")
  ) {
    throw new Error("Cottage Inventory provider data is invalid");
  }
  const state = calendarState(unit.calendarState);
  const committed = state === "pending_hold" || state === "confirmed_booking";
  const operational =
    state === "open" || state === "closed" || state === "private_blocked";
  const priceIqd = optionalPrice(unit.priceIqd);
  if (
    (committed &&
      (typeof unit.commitmentReference !== "string" ||
        unit.commitmentReference.trim() === "" ||
        priceIqd === null)) ||
    (!committed && unit.commitmentReference !== null) ||
    unit.editable !== operational ||
    (unit.available && state !== "open") ||
    (state === "component_unavailable" && unit.kind !== "full_day_bundle")
  ) {
    throw new Error("Cottage Inventory provider data is invalid");
  }
  return {
    id: requiredUuid(unit.id),
    kind: unit.kind,
    priceIqd,
    available: unit.available,
    calendarState: state,
    commitmentReference: unit.commitmentReference,
    editable: unit.editable,
  };
}

function parseOwnerCalendar(
  value: unknown,
  expected: {
    profileId: string;
    scheduleRevisionId: string;
    serviceDay: string;
  },
): CottageInventoryOwnerCalendar {
  const calendar = parseEnvelope(value, expected);
  exactKeys(calendar, [
    "profileId",
    "scheduleRevisionId",
    "serviceDay",
    "units",
  ]);
  return {
    ...expected,
    units: (calendar.units as unknown[]).map(parseOwnerCalendarUnit),
  };
}

function parseOwnerCalendarSpan(
  value: unknown,
  expected: Parameters<
    CottageInventoryRepository["resolveOwnerCalendarSpan"]
  >[0],
): CottageInventoryOwnerCalendarSpan {
  const span = record(value);
  exactKeys(span, [
    "profileId",
    "scheduleRevisionId",
    "from",
    "to",
    "asOf",
    "unitKeys",
    "days",
  ]);
  if (
    requiredUuid(span.profileId) !== expected.profileId ||
    requiredUuid(span.scheduleRevisionId) !== expected.scheduleRevisionId ||
    requiredServiceDay(span.from) !== expected.from ||
    requiredServiceDay(span.to) !== expected.to ||
    typeof span.asOf !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      span.asOf,
    ) ||
    !Number.isFinite(Date.parse(span.asOf)) ||
    !Array.isArray(span.unitKeys) ||
    !Array.isArray(span.days)
  )
    throw new Error("Cottage Inventory provider data is invalid");
  const unitKeys = span.unitKeys.map(
    (value): { id: string; kind: CottageInventoryUnitKind } => {
      const unit = record(value);
      exactKeys(unit, ["id", "kind"]);
      if (unit.kind !== "shift" && unit.kind !== "full_day_bundle") {
        throw new Error("Cottage Inventory provider data is invalid");
      }
      return { id: requiredUuid(unit.id), kind: unit.kind };
    },
  );
  const ids = new Set(unitKeys.map((unit) => unit.id));
  if (
    unitKeys.length < 3 ||
    unitKeys.length > 4 ||
    ids.size !== unitKeys.length ||
    unitKeys.filter((unit) => unit.kind === "full_day_bundle").length !== 1
  )
    throw new Error("Cottage Inventory provider data is invalid");
  const keys = new Set(unitKeys.map((unit) => `${unit.kind}:${unit.id}`));
  const count =
    (Date.parse(expected.to) - Date.parse(expected.from)) / 86_400_000 + 1;
  if (count < 1 || count > 31 || span.days.length !== count) {
    throw new Error("Cottage Inventory provider data is invalid");
  }
  const days = span.days.map((value, index) => {
    const day = record(value);
    exactKeys(day, ["serviceDay", "units"]);
    const serviceDay = requiredServiceDay(day.serviceDay);
    if (
      serviceDay !==
        new Date(Date.parse(expected.from) + index * 86_400_000)
          .toISOString()
          .slice(0, 10) ||
      !Array.isArray(day.units) ||
      day.units.length !== keys.size
    )
      throw new Error("Cottage Inventory provider data is invalid");
    const seen = new Set<string>();
    const units = day.units.map(
      (value): CottageInventoryOwnerCalendarSpanUnit => {
        const unit = record(value);
        exactKeys(unit, [
          "id",
          "kind",
          "priceIqd",
          "available",
          "calendarState",
          "commitmentReference",
          "editable",
          "ownerState",
          "temporarilyUnavailable",
        ]);
        const id = requiredUuid(unit.id);
        const key = `${unit.kind}:${id}`;
        if (
          !keys.has(key) ||
          seen.has(key) ||
          typeof unit.temporarilyUnavailable !== "boolean" ||
          (unit.priceIqd !== null && typeof unit.priceIqd !== "number") ||
          (unit.available === true && unit.priceIqd === null)
        )
          throw new Error("Cottage Inventory provider data is invalid");
        seen.add(key);
        const rawState = ownerState(unit.ownerState);
        const calendarUnit = { ...unit };
        delete calendarUnit.ownerState;
        delete calendarUnit.temporarilyUnavailable;
        const temporarilyUnavailable = unit.temporarilyUnavailable;
        if (temporarilyUnavailable) {
          if (
            unit.calendarState !== null ||
            unit.commitmentReference !== null ||
            unit.available !== false ||
            unit.editable !== false ||
            (unit.kind !== "shift" && unit.kind !== "full_day_bundle")
          )
            throw new Error("Cottage Inventory provider data is invalid");
          return {
            id,
            kind: unit.kind,
            ownerState: rawState,
            temporarilyUnavailable,
            priceIqd: optionalPrice(unit.priceIqd),
            calendarState: null,
            commitmentReference: null,
            available: false,
            editable: false,
          };
        }
        const parsed = parseOwnerCalendarUnit(calendarUnit);
        if (
          ["open", "closed", "private_blocked"].includes(
            parsed.calendarState,
          ) &&
          parsed.calendarState !== rawState
        ) {
          throw new Error("Cottage Inventory provider data is invalid");
        }
        return { ...parsed, ownerState: rawState, temporarilyUnavailable };
      },
    );
    return { serviceDay, units };
  });
  return { ...expected, asOf: span.asOf, unitKeys, days };
}

function batchCoordinate(
  value: unknown,
  extra: string[] = [],
): CottageInventoryCoordinate {
  const coordinate = record(value);
  exactKeys(coordinate, ["serviceDay", "id", "kind", ...extra]);
  if (coordinate.kind !== "shift" && coordinate.kind !== "full_day_bundle") {
    throw new Error("Cottage Inventory provider data is invalid");
  }
  return {
    serviceDay: requiredServiceDay(coordinate.serviceDay),
    id: requiredUuid(coordinate.id),
    kind: coordinate.kind,
  };
}

function batchCoordinateKey(value: CottageInventoryCoordinate) {
  return `${value.serviceDay}|${value.kind}|${value.id}`;
}

function canonicalCoordinates(values: CottageInventoryCoordinate[]) {
  const keys = values.map(batchCoordinateKey);
  if (keys.some((key, index) => index > 0 && keys[index - 1]! >= key)) {
    throw new Error("Cottage Inventory provider data is invalid");
  }
}

function assertEchoedBatch(
  value: unknown,
  expected: CottageInventoryAvailabilityBatchInput,
) {
  const request = record(value);
  exactKeys(request, [
    "from",
    "to",
    "unitKeys",
    "state",
    "mode",
    "cells",
    "replacePrivateBlocks",
    "reviewConfirmed",
  ]);
  for (const key of [
    "from",
    "to",
    "state",
    "mode",
    "reviewConfirmed",
  ] as const) {
    if (request[key] !== expected[key])
      throw new Error("Cottage Inventory provider data is invalid");
  }
  for (const key of ["unitKeys", "cells", "replacePrivateBlocks"] as const) {
    const actual = request[key];
    const sent = expected[key];
    if (!Array.isArray(actual) || actual.length !== sent.length)
      throw new Error("Cottage Inventory provider data is invalid");
    for (const [index, value] of actual.entries()) {
      const entry = record(value);
      const original = sent[index]!;
      exactKeys(entry, Object.keys(original));
      if (
        Object.entries(original).some(
          ([field, value]) => entry[field] !== value,
        )
      ) {
        throw new Error("Cottage Inventory provider data is invalid");
      }
    }
  }
}

function parseBatchReceipt(
  value: unknown,
  input: Parameters<CottageInventoryRepository["setAvailabilityBatch"]>[0],
): CottageInventoryBatchReceipt {
  const receipt = record(value);
  if (receipt.status !== "saved" && receipt.status !== "refused")
    throw new Error("Cottage Inventory provider data is invalid");
  exactKeys(
    receipt,
    receipt.status === "saved"
      ? [
          "status",
          "profileId",
          "scheduleRevisionId",
          "request",
          "changed",
          "unchanged",
        ]
      : [
          "status",
          "profileId",
          "scheduleRevisionId",
          "request",
          "conflicts",
          "eligible",
          "calendar",
        ],
  );
  if (
    requiredUuid(receipt.profileId) !== input.profileId ||
    requiredUuid(receipt.scheduleRevisionId) !== input.scheduleRevisionId
  ) {
    throw new Error("Cottage Inventory provider data is invalid");
  }
  assertEchoedBatch(receipt.request, input.batch);
  const submitted = new Map(
    input.batch.cells.map((cell) => [batchCoordinateKey(cell), cell]),
  );
  const covered = new Set<string>();
  const include = (cell: CottageInventoryCoordinate) => {
    const key = batchCoordinateKey(cell);
    const original = submitted.get(key);
    if (!original || covered.has(key))
      throw new Error("Cottage Inventory provider data is invalid");
    covered.add(key);
    return original;
  };
  const envelope = {
    profileId: input.profileId,
    scheduleRevisionId: input.scheduleRevisionId,
    request: input.batch,
  };
  if (receipt.status === "saved") {
    if (!Array.isArray(receipt.changed) || !Array.isArray(receipt.unchanged))
      throw new Error("Cottage Inventory provider data is invalid");
    const changed = receipt.changed.map((value) => batchCoordinate(value));
    const unchanged = receipt.unchanged.map((value) => batchCoordinate(value));
    canonicalCoordinates(changed);
    canonicalCoordinates(unchanged);
    for (const [values, isChanged] of [
      [changed, true],
      [unchanged, false],
    ] as const) {
      for (const cell of values) {
        if (
          (include(cell).expectedOwnerState !== input.batch.state) !==
          isChanged
        )
          throw new Error("Cottage Inventory provider data is invalid");
      }
    }
    if (covered.size !== submitted.size)
      throw new Error("Cottage Inventory provider data is invalid");
    return { status: "saved", ...envelope, changed, unchanged };
  }
  if (
    !Array.isArray(receipt.conflicts) ||
    receipt.conflicts.length === 0 ||
    !Array.isArray(receipt.eligible)
  ) {
    throw new Error("Cottage Inventory provider data is invalid");
  }
  const calendar = parseOwnerCalendarSpan(receipt.calendar, {
    profileId: input.profileId,
    scheduleRevisionId: input.scheduleRevisionId,
    from: input.batch.from,
    to: input.batch.to,
  });
  const conflicts = receipt.conflicts.map(
    (value): CottageInventoryBatchConflict => {
      const cell = batchCoordinate(value, ["reason", "commitmentReference"]);
      include(cell);
      const conflict = record(value);
      if (
        !cottageInventoryBatchConflictReasons.some(
          (reason) => reason === conflict.reason,
        )
      )
        throw new Error("Cottage Inventory provider data is invalid");
      const reason = conflict.reason as CottageInventoryBatchConflict["reason"];
      const unit = calendar.days
        .find((day) => day.serviceDay === cell.serviceDay)
        ?.units.find((unit) => unit.id === cell.id && unit.kind === cell.kind);
      if (!unit) throw new Error("Cottage Inventory provider data is invalid");
      if (reason === "pending_hold" || reason === "confirmed_booking") {
        if (
          unit.calendarState !== reason ||
          typeof conflict.commitmentReference !== "string" ||
          conflict.commitmentReference.trim() === "" ||
          conflict.commitmentReference !== unit.commitmentReference
        ) {
          throw new Error("Cottage Inventory provider data is invalid");
        }
      } else if (conflict.commitmentReference !== null)
        throw new Error("Cottage Inventory provider data is invalid");
      return {
        ...cell,
        reason,
        commitmentReference: conflict.commitmentReference as string | null,
      };
    },
  );
  const eligible = receipt.eligible.map(
    (value): CottageInventoryReviewedCell => {
      const cell = batchCoordinate(value, ["expectedOwnerState"]);
      const original = include(cell);
      if (record(value).expectedOwnerState !== original.expectedOwnerState)
        throw new Error("Cottage Inventory provider data is invalid");
      return { ...cell, expectedOwnerState: original.expectedOwnerState };
    },
  );
  canonicalCoordinates(conflicts);
  canonicalCoordinates(eligible);
  if (covered.size !== submitted.size)
    throw new Error("Cottage Inventory provider data is invalid");
  return { status: "refused", ...envelope, conflicts, eligible, calendar };
}

function assertSuccess(error: unknown): void {
  if (error) {
    throw new Error("Cottage Inventory provider is unavailable", {
      cause: error,
    });
  }
}

export class SupabaseCottageInventoryRepository implements CottageInventoryRepository {
  constructor(private readonly client: SupabaseClient) {}

  async loadOwnerEditorState(
    input: Parameters<CottageInventoryRepository["loadOwnerEditorState"]>[0],
  ): Promise<CottageInventoryOwnerEditorState> {
    const { data, error } = await this.client.rpc(
      "load_cottage_inventory_owner_editor_state",
      {
        target_profile_id: input.profileId,
        target_schedule_revision_id: input.scheduleRevisionId,
        target_service_day: input.serviceDay ?? null,
      },
    );
    assertSuccess(error);
    return parseOwnerEditorState(data, input);
  }

  async savePricing(
    input: Parameters<CottageInventoryRepository["savePricing"]>[0],
  ) {
    const { data, error } = await this.client.rpc(
      "save_cottage_inventory_pricing",
      {
        target_profile_id: input.profileId,
        target_schedule_revision_id: input.scheduleRevisionId,
        requested_prices: {
          units: input.pricing.units.map((unit) => ({
            unitId: unit.id,
            unitKind: unit.kind,
            standardPriceIqd: unit.standardPriceIqd,
            ...(unit.weekdayOverrides
              ? { weekdayOverrides: unit.weekdayOverrides }
              : {}),
            ...(unit.dateOverrides
              ? { dateOverrides: unit.dateOverrides }
              : {}),
          })),
        },
      },
    );
    assertSuccess(error);
    const result = record(data);
    const profileId = requiredUuid(result.profileId);
    const scheduleRevisionId = requiredUuid(result.scheduleRevisionId);
    if (
      profileId !== input.profileId ||
      scheduleRevisionId !== input.scheduleRevisionId
    ) {
      throw new Error("Cottage Inventory provider data is invalid");
    }
    return { profileId, scheduleRevisionId };
  }

  async resolvePublicAvailability(
    input: Parameters<
      CottageInventoryRepository["resolvePublicAvailability"]
    >[0],
  ): Promise<CottageInventoryPublicAvailability> {
    const { data, error } = await this.client.rpc(
      "resolve_cottage_inventory_public_availability",
      {
        target_profile_id: input.profileId,
        target_schedule_revision_id: input.scheduleRevisionId,
        target_service_day: input.serviceDay,
      },
    );
    assertSuccess(error);
    return parsePublicAvailability(data, input);
  }

  async resolveOwnerCalendarSpan(
    input: Parameters<
      CottageInventoryRepository["resolveOwnerCalendarSpan"]
    >[0],
  ): Promise<CottageInventoryOwnerCalendarSpan> {
    const { data, error } = await this.client.rpc(
      "resolve_cottage_inventory_owner_calendar_span",
      {
        target_profile_id: input.profileId,
        target_schedule_revision_id: input.scheduleRevisionId,
        target_from: input.from,
        target_to: input.to,
      },
    );
    assertSuccess(error);
    return parseOwnerCalendarSpan(data, input);
  }

  async resolveOwnerCalendar(
    input: Parameters<CottageInventoryRepository["resolveOwnerCalendar"]>[0],
  ): Promise<CottageInventoryOwnerCalendar> {
    const { data, error } = await this.client.rpc(
      "resolve_cottage_inventory_owner_calendar",
      {
        target_profile_id: input.profileId,
        target_schedule_revision_id: input.scheduleRevisionId,
        target_service_day: input.serviceDay,
      },
    );
    assertSuccess(error);
    return parseOwnerCalendar(data, input);
  }

  async setAvailabilityBatch(
    input: Parameters<CottageInventoryRepository["setAvailabilityBatch"]>[0],
  ): Promise<CottageInventoryBatchReceipt> {
    const { data, error } = await this.client.rpc(
      "set_cottage_inventory_availability_batch",
      {
        target_profile_id: input.profileId,
        target_schedule_revision_id: input.scheduleRevisionId,
        requested_batch: input.batch,
      },
    );
    assertSuccess(error);
    return parseBatchReceipt(data, input);
  }

  async setAvailability(
    input: Parameters<CottageInventoryRepository["setAvailability"]>[0],
  ) {
    const { data, error } = await this.client.rpc(
      "set_cottage_inventory_availability",
      {
        target_profile_id: input.profileId,
        target_schedule_revision_id: input.scheduleRevisionId,
        target_service_day: input.serviceDay,
        requested_states: input.availability.units.map((unit) => ({
          unitId: unit.id,
          unitKind: unit.kind,
          state: unit.state,
        })),
      },
    );
    assertSuccess(error);
    const result = record(data);
    const profileId = requiredUuid(result.profileId);
    const scheduleRevisionId = requiredUuid(result.scheduleRevisionId);
    const serviceDay = requiredServiceDay(result.serviceDay);
    if (
      profileId !== input.profileId ||
      scheduleRevisionId !== input.scheduleRevisionId ||
      serviceDay !== input.serviceDay
    ) {
      throw new Error("Cottage Inventory provider data is invalid");
    }
    return { profileId, scheduleRevisionId, serviceDay };
  }
}
