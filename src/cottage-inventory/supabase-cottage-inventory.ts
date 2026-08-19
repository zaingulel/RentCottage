import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  CottageInventoryRepository,
  CottageInventoryOwnerEditorState,
  CottageInventoryOwnerEditorUnit,
  CottageInventoryResolution,
  CottageInventoryResolvedUnit,
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

function parseUnit(value: unknown): CottageInventoryResolvedUnit {
  const unit = record(value);
  const id = requiredUuid(unit.id);
  if (unit.kind !== "shift" && unit.kind !== "full_day_bundle") {
    throw new Error("Cottage Inventory provider data is invalid");
  }
  if (typeof unit.available !== "boolean") {
    throw new Error("Cottage Inventory provider data is invalid");
  }
  const hasPrivilegedState =
    unit.ownerState !== undefined ||
    unit.committed !== undefined ||
    unit.commitmentReference !== undefined;
  if (
    hasPrivilegedState &&
    (typeof unit.committed !== "boolean" ||
      (unit.commitmentReference !== null &&
        typeof unit.commitmentReference !== "string") ||
      (unit.committed && !unit.commitmentReference) ||
      (!unit.committed && unit.commitmentReference !== null))
  ) {
    throw new Error("Cottage Inventory provider data is invalid");
  }
  return {
    id,
    kind: unit.kind,
    priceIqd: optionalPrice(unit.priceIqd),
    available: unit.available,
    ...(hasPrivilegedState
      ? {
          ownerState: ownerState(unit.ownerState),
          committed: unit.committed as boolean,
          commitmentReference: unit.commitmentReference as string | null,
        }
      : {}),
  };
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

function parseResolution(
  value: unknown,
  expected: {
    profileId: string;
    scheduleRevisionId: string;
    serviceDay: string;
  },
): CottageInventoryResolution {
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
  return {
    profileId: expected.profileId,
    scheduleRevisionId: expected.scheduleRevisionId,
    serviceDay: expected.serviceDay,
    units: resolution.units.map(parseUnit),
  };
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

  async resolve(
    input: Parameters<CottageInventoryRepository["resolve"]>[0],
  ): Promise<CottageInventoryResolution> {
    const { data, error } = await this.client.rpc("resolve_cottage_inventory", {
      target_profile_id: input.profileId,
      target_schedule_revision_id: input.scheduleRevisionId,
      target_service_day: input.serviceDay,
    });
    assertSuccess(error);
    return parseResolution(data, input);
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
