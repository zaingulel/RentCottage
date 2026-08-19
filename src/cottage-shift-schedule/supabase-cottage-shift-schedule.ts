import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  CottageShift,
  CottageShiftScheduleRepository,
} from "./cottage-shift-schedule";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;
const databaseTimePattern = /^([01]\d|2[0-3]):([0-5]\d)(?::00)?$/;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Shift Schedule provider data is invalid");
  }
  return value as Record<string, unknown>;
}

function databaseTime(value: unknown): string {
  if (typeof value !== "string" || !databaseTimePattern.test(value)) {
    throw new Error("Shift Schedule provider data is invalid");
  }
  return value.slice(0, 5);
}

function minutes(time: string): number {
  const [, hours, minute] = time.match(timePattern)!;
  return Number(hours) * 60 + Number(minute);
}

function parseSchedule(value: unknown, expectedProfileId: string) {
  const schedule = record(value);
  const profileId = schedule.profileId;
  const scheduleRevisionId = schedule.scheduleRevisionId;
  const fullDayBundleId = schedule.fullDayBundleId;
  const revision = schedule.revision;
  if (
    typeof profileId !== "string" ||
    !uuidPattern.test(profileId) ||
    profileId !== expectedProfileId ||
    (scheduleRevisionId !== undefined &&
      (typeof scheduleRevisionId !== "string" ||
        !uuidPattern.test(scheduleRevisionId))) ||
    typeof fullDayBundleId !== "string" ||
    !uuidPattern.test(fullDayBundleId) ||
    !Number.isInteger(revision) ||
    Number(revision) < 1 ||
    !Array.isArray(schedule.shifts) ||
    ![2, 3].includes(schedule.shifts.length)
  ) {
    throw new Error("Shift Schedule provider data is invalid");
  }
  const shifts = schedule.shifts.map((value, index): CottageShift => {
    const shift = record(value);
    if (
      typeof shift.id !== "string" ||
      !uuidPattern.test(shift.id) ||
      typeof shift.name !== "string" ||
      !shift.name.trim() ||
      typeof shift.startTime !== "string" ||
      !timePattern.test(shift.startTime) ||
      typeof shift.endTime !== "string" ||
      !timePattern.test(shift.endTime) ||
      shift.startTime === shift.endTime ||
      shift.position !== index + 1 ||
      typeof shift.crossesMidnight !== "boolean" ||
      shift.crossesMidnight !== shift.endTime < shift.startTime
    ) {
      throw new Error("Shift Schedule provider data is invalid");
    }
    return {
      id: shift.id,
      name: shift.name.trim(),
      startTime: shift.startTime,
      endTime: shift.endTime,
      position: shift.position,
      crossesMidnight: shift.crossesMidnight,
    };
  });
  if (
    shifts.some(
      (shift, index) =>
        index > 0 && shifts[index - 1].startTime > shift.startTime,
    )
  ) {
    throw new Error("Shift Schedule provider data is invalid");
  }
  const intervals = shifts.map((shift) => {
    const start = minutes(shift.startTime);
    const end = minutes(shift.endTime);
    return { start, end: end < start ? end + 1440 : end };
  });
  for (let left = 0; left < intervals.length; left += 1) {
    for (let right = left + 1; right < intervals.length; right += 1) {
      for (const offset of [-1440, 0, 1440]) {
        const candidateStart = intervals[right].start + offset;
        const candidateEnd = intervals[right].end + offset;
        if (
          intervals[left].start < candidateEnd &&
          candidateStart < intervals[left].end
        ) {
          throw new Error("Shift Schedule provider data is invalid");
        }
      }
    }
  }
  return {
    profileId,
    ...(typeof scheduleRevisionId === "string" ? { scheduleRevisionId } : {}),
    revision: revision as number,
    fullDayBundleId,
    shifts,
  };
}

function assertSuccess(error: unknown): void {
  if (error) {
    throw new Error("Shift Schedule provider is unavailable", { cause: error });
  }
}

export class SupabaseCottageShiftScheduleRepository implements CottageShiftScheduleRepository {
  constructor(private readonly client: SupabaseClient) {}

  async loadCurrent(profileId: string) {
    const profileResult = await this.client
      .from("owner_application_cottage_profiles")
      .select("current_shift_schedule_id")
      .eq("id", profileId)
      .maybeSingle();
    assertSuccess(profileResult.error);
    const pointer = profileResult.data?.current_shift_schedule_id;
    if (!pointer) return null;

    const [revisionResult, shiftsResult] = await Promise.all([
      this.client
        .from("cottage_shift_schedule_revisions")
        .select("id, profile_id, revision, full_day_bundle_id")
        .eq("id", pointer)
        .maybeSingle(),
      this.client
        .from("cottage_shifts")
        .select(
          "id, schedule_revision_id, position, name, start_time, end_time",
        )
        .eq("schedule_revision_id", pointer)
        .order("position"),
    ]);
    assertSuccess(revisionResult.error);
    assertSuccess(shiftsResult.error);
    const revision = revisionResult.data;
    if (!revision || revision.id !== pointer) {
      throw new Error("Shift Schedule provider data is invalid");
    }
    return parseSchedule(
      {
        profileId: revision.profile_id,
        scheduleRevisionId: revision.id,
        revision: revision.revision,
        fullDayBundleId: revision.full_day_bundle_id,
        shifts: (shiftsResult.data ?? []).map((shift) => {
          if (shift.schedule_revision_id !== revision.id) {
            throw new Error("Shift Schedule provider data is invalid");
          }
          const startTime = databaseTime(shift.start_time);
          const endTime = databaseTime(shift.end_time);
          return {
            id: shift.id,
            name: shift.name,
            startTime,
            endTime,
            position: shift.position,
            crossesMidnight: endTime < startTime,
          };
        }),
      },
      profileId,
    );
  }

  async save(input: Parameters<CottageShiftScheduleRepository["save"]>[0]) {
    const { data, error } = await this.client.rpc(
      "replace_cottage_shift_schedule",
      {
        target_profile_id: input.profileId,
        target_expected_revision: input.expectedRevision,
        requested_shifts: input.shifts.map(({ name, startTime, endTime }) => ({
          name,
          startTime,
          endTime,
        })),
      },
    );
    assertSuccess(error);
    return parseSchedule(data, input.profileId);
  }
}
