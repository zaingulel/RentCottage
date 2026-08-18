export interface CottageShift {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  position: number;
  crossesMidnight: boolean;
}

export interface CottageShiftSchedule {
  profileId: string;
  revision: number;
  fullDayBundleId: string;
  fullDayShiftIds: string[];
  fullDayStartTime: string;
  fullDayEndTime: string;
  fullDayCrossesMidnight: boolean;
  shifts: CottageShift[];
}

interface StoredCottageShiftSchedule {
  profileId: string;
  revision: number;
  fullDayBundleId: string;
  shifts: CottageShift[];
}

export interface CottageShiftScheduleRepository {
  loadCurrent(profileId: string): Promise<StoredCottageShiftSchedule | null>;
  save(input: {
    profileId: string;
    expectedRevision: number;
    shifts: Array<Omit<CottageShift, "id">>;
  }): Promise<StoredCottageShiftSchedule>;
}

export type CottageShiftScheduleLoadResult =
  | { status: "loaded"; schedule: CottageShiftSchedule | null }
  | { status: "denied" | "unavailable" };

export type CottageShiftScheduleSaveResult =
  | { status: "saved"; schedule: CottageShiftSchedule }
  | { status: "invalid"; fields: string[] }
  | { status: "overlap" }
  | { status: "conflict" | "denied" | "unavailable" };

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;

function minutes(time: string): number {
  const [, hours, minute] = time.match(timePattern)!;
  return Number(hours) * 60 + Number(minute);
}

function withFullDay(
  schedule: StoredCottageShiftSchedule,
): CottageShiftSchedule {
  const first = schedule.shifts[0];
  const greatestEnd = Math.max(
    ...schedule.shifts.map((shift) => {
      const start = minutes(shift.startTime);
      const end = minutes(shift.endTime);
      return end < start ? end + 1440 : end;
    }),
  );
  return {
    ...schedule,
    fullDayShiftIds: schedule.shifts.map(({ id }) => id),
    fullDayStartTime: first.startTime,
    fullDayEndTime: `${String(Math.floor((greatestEnd % 1440) / 60)).padStart(2, "0")}:${String(greatestEnd % 60).padStart(2, "0")}`,
    fullDayCrossesMidnight: greatestEnd >= 1440,
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

function parseInput(
  value: unknown,
):
  | { status: "valid"; shifts: Array<Omit<CottageShift, "id">> }
  | { status: "invalid"; fields: string[] }
  | { status: "overlap" } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { status: "invalid", fields: ["schedule"] };
  }
  const rawShifts = (value as Record<string, unknown>).shifts;
  if (!Array.isArray(rawShifts) || ![2, 3].includes(rawShifts.length)) {
    return { status: "invalid", fields: ["shifts"] };
  }
  const parsed = rawShifts.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { index, name: "", startTime: "", endTime: "" };
    }
    const shift = value as Record<string, unknown>;
    return {
      index,
      name: typeof shift.name === "string" ? shift.name.trim() : "",
      startTime: typeof shift.startTime === "string" ? shift.startTime : "",
      endTime: typeof shift.endTime === "string" ? shift.endTime : "",
    };
  });
  const invalid = parsed.flatMap((shift) => {
    const fields: string[] = [];
    if (!shift.name) fields.push(`shifts.${shift.index}.name`);
    if (!timePattern.test(shift.startTime)) {
      fields.push(`shifts.${shift.index}.startTime`);
    }
    if (!timePattern.test(shift.endTime)) {
      fields.push(`shifts.${shift.index}.endTime`);
    } else if (shift.startTime === shift.endTime) {
      fields.push(`shifts.${shift.index}.endTime`);
    }
    return fields;
  });
  if (invalid.length > 0) return { status: "invalid", fields: invalid };

  const shifts = parsed
    .sort((left, right) => left.startTime.localeCompare(right.startTime))
    .map((shift, index) => ({
      name: shift.name,
      startTime: shift.startTime,
      endTime: shift.endTime,
      position: index + 1,
      crossesMidnight: minutes(shift.endTime) < minutes(shift.startTime),
    }));
  const intervals = shifts.map((shift) => {
    const start = minutes(shift.startTime);
    const end = minutes(shift.endTime);
    return { start, end: end < start ? end + 1440 : end };
  });
  for (let left = 0; left < intervals.length; left += 1) {
    for (let right = left + 1; right < intervals.length; right += 1) {
      for (const offset of [-1440, 0, 1440]) {
        const candidate = {
          start: intervals[right].start + offset,
          end: intervals[right].end + offset,
        };
        if (
          intervals[left].start < candidate.end &&
          candidate.start < intervals[left].end
        ) {
          return { status: "overlap" };
        }
      }
    }
  }
  return { status: "valid", shifts };
}

export function createCottageShiftSchedule(
  repository: CottageShiftScheduleRepository,
) {
  return {
    async loadCurrent(
      profileId: string,
    ): Promise<CottageShiftScheduleLoadResult> {
      if (!uuidPattern.test(profileId)) return { status: "denied" };
      try {
        const schedule = await repository.loadCurrent(profileId);
        return {
          status: "loaded",
          schedule: schedule ? withFullDay(schedule) : null,
        };
      } catch (error) {
        return {
          status: mapFailure(error) === "denied" ? "denied" : "unavailable",
        };
      }
    },

    async save(
      profileId: string,
      expectedRevision: number,
      input: unknown,
    ): Promise<CottageShiftScheduleSaveResult> {
      if (
        !uuidPattern.test(profileId) ||
        !Number.isInteger(expectedRevision) ||
        expectedRevision < 0
      ) {
        return { status: "invalid", fields: ["schedule"] };
      }
      const parsed = parseInput(input);
      if (parsed.status !== "valid") return parsed;
      try {
        const schedule = await repository.save({
          profileId,
          expectedRevision,
          shifts: parsed.shifts,
        });
        return { status: "saved", schedule: withFullDay(schedule) };
      } catch (error) {
        return { status: mapFailure(error) };
      }
    },
  };
}
