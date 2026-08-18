"use server";

import { revalidatePath } from "next/cache";

import { isLocale } from "@/i18n/routing";
import { createRequestCottageShiftSchedule } from "./request-cottage-shift-schedule";

export type CottageShiftScheduleActionState = {
  status:
    | "idle"
    | "saved"
    | "invalid"
    | "overlap"
    | "conflict"
    | "denied"
    | "unavailable";
  fields?: string[];
};

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function texts(formData: FormData, name: string): string[] {
  return formData
    .getAll(name)
    .map((value) => (typeof value === "string" ? value : ""));
}

export async function saveCottageShiftScheduleAction(
  _previous: CottageShiftScheduleActionState,
  formData: FormData,
): Promise<CottageShiftScheduleActionState> {
  const requestedLocale = text(formData, "locale");
  if (!isLocale(requestedLocale)) {
    return { status: "invalid", fields: ["schedule"] };
  }
  const profileId = text(formData, "profileId");
  const names = texts(formData, "shiftName");
  const starts = texts(formData, "shiftStartTime");
  const ends = texts(formData, "shiftEndTime");
  const shifts = Array.from(
    { length: Math.max(names.length, starts.length, ends.length) },
    (_, index) => ({
      name: names[index] ?? "",
      startTime: starts[index] ?? "",
      endTime: ends[index] ?? "",
    }),
  ).filter(
    (shift, index) =>
      index < 2 || Boolean(shift.name || shift.startTime || shift.endTime),
  );
  const schedule = await createRequestCottageShiftSchedule();
  const result = await schedule.save(
    profileId,
    Number(text(formData, "expectedRevision")),
    { shifts },
  );
  if (result.status === "saved") {
    revalidatePath(`/${requestedLocale}/owner/cottages/${profileId}`);
    return { status: "saved" };
  }
  return result;
}
