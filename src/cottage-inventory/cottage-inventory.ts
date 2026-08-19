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

export interface CottageInventoryResolvedUnit {
  id: string;
  kind: CottageInventoryUnitKind;
  priceIqd: number | null;
  available: boolean;
  committed?: boolean;
  ownerState?: CottageInventoryAvailabilityState;
  commitmentReference?: string | null;
}

export interface CottageInventoryResolution {
  profileId: string;
  scheduleRevisionId: string;
  serviceDay: string;
  units: CottageInventoryResolvedUnit[];
}

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
  setAvailability(input: {
    profileId: string;
    scheduleRevisionId: string;
    serviceDay: string;
    availability: CottageInventoryAvailabilityInput;
  }): Promise<unknown>;
  resolve(input: {
    profileId: string;
    scheduleRevisionId: string;
    serviceDay: string;
  }): Promise<CottageInventoryResolution>;
}

export type CottageInventoryPricingSaveResult =
  | { status: "saved"; value: unknown }
  | { status: "invalid"; fields: string[] }
  | { status: "conflict" | "denied" | "unavailable" };

export type CottageInventoryResolutionResult =
  | { status: "resolved"; resolution: CottageInventoryResolution }
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

    async resolve(
      profileId: string,
      scheduleRevisionId: string,
      serviceDay: string,
    ): Promise<CottageInventoryResolutionResult> {
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
          resolution: await repository.resolve({
            profileId,
            scheduleRevisionId,
            serviceDay,
          }),
        };
      } catch (error) {
        return { status: mapFailure(error) };
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
