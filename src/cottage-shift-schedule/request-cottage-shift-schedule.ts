import "server-only";

import { createRequestSupabaseClient } from "@/access/supabase-server";
import { createCottageShiftSchedule } from "./cottage-shift-schedule";
import { SupabaseCottageShiftScheduleRepository } from "./supabase-cottage-shift-schedule";

export async function createRequestCottageShiftSchedule() {
  const client = await createRequestSupabaseClient();
  return createCottageShiftSchedule(
    new SupabaseCottageShiftScheduleRepository(client),
  );
}
