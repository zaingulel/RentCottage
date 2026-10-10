"use server";

import { revalidatePath } from "next/cache";

import { cottageShiftScheduleMessages } from "@/i18n/cottage-shift-schedule-messages";
import { isLocale } from "@/i18n/routing";
import {
  readCottageShiftSchedule,
  type CottageShiftSchedule,
} from "./cottage-shift-schedule";
import { createRequestCottageShiftSchedule } from "./request-cottage-shift-schedule";

export type CottageShiftScheduleActionState =
  | { status: "saved"; schedule: CottageShiftSchedule }
  | {
      status:
        | "idle"
        | "invalid"
        | "overlap"
        | "conflict"
        | "committed"
        | "denied"
        | "unavailable";
      fields?: string[];
    };

export async function saveCottageShiftScheduleAction(
  _previous: CottageShiftScheduleActionState,
  formData: FormData,
): Promise<CottageShiftScheduleActionState> {
  const requestedLocale = formData.get("locale");
  if (typeof requestedLocale !== "string" || !isLocale(requestedLocale)) {
    return { status: "invalid", fields: ["locale"] };
  }
  const confirmation = formData.getAll("confirmedTimes");
  if (confirmation.length !== 1 || confirmation[0] !== "on") {
    return { status: "invalid", fields: ["confirmedTimes"] };
  }
  const revision = formData.get("expectedRevision");
  if (
    typeof revision !== "string" ||
    !/^\d+$/.test(revision) ||
    !Number.isSafeInteger(Number(revision))
  ) {
    return { status: "invalid", fields: ["expectedRevision"] };
  }
  const profileId = formData.get("profileId");
  if (typeof profileId !== "string") {
    return { status: "invalid", fields: ["profileId"] };
  }
  const entries = {
    shiftName: formData.getAll("shiftName"),
    shiftStartTime: formData.getAll("shiftStartTime"),
    shiftEndTime: formData.getAll("shiftEndTime"),
  };
  const fields = Object.entries(entries).flatMap(([field, values]) =>
    values.length !== 2
      ? [field]
      : values.flatMap((value, index) =>
          typeof value === "string" ? [] : [`${field}.${index}`],
        ),
  );
  if (fields.length > 0) return { status: "invalid", fields };

  const copy = cottageShiftScheduleMessages[requestedLocale];
  const formFields: Record<string, string> = {
    name: "shiftName",
    startTime: "shiftStartTime",
    endTime: "shiftEndTime",
  };
  // Reject malformed forms before constructing the cookie-bound service, which also validates independent callers.
  const parsed = readCottageShiftSchedule({
    shifts: entries.shiftName.map((name, index) => ({
      name:
        (name as string).trim() || (index === 0 ? copy.morning : copy.evening),
      startTime: entries.shiftStartTime[index],
      endTime: entries.shiftEndTime[index],
    })),
  });
  if (parsed.status === "invalid") {
    return {
      status: "invalid",
      fields: parsed.fields.map((field) =>
        field.replace(
          /^shifts\.(\d+)\.(name|startTime|endTime)$/,
          (_, index: string, name: string) => `${formFields[name]}.${index}`,
        ),
      ),
    };
  }
  if (parsed.status === "overlap") return parsed;

  const schedule = await createRequestCottageShiftSchedule();
  const result = await schedule.save(profileId, Number(revision), {
    shifts: parsed.shifts,
  });
  if (result.status === "saved") {
    revalidatePath(`/${requestedLocale}/owner/cottages/${profileId}`);
    return result;
  }
  return result;
}
