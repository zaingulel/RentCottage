import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

if (!url || !publishableKey) {
  console.error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required");
  process.exitCode = 2;
} else {
  const phone = "+9647510000000";
  const password = "Local-test-password-2026";
  const owners = await Promise.all(
    [0, 1].map(async () => {
      const owner = createClient(url, publishableKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error } = await owner.auth.signInWithPassword({
        phone,
        password,
      });
      if (error) throw error;
      return owner;
    }),
  );
  const { data: profile, error: profileError } = await owners[0]
    .from("owner_application_cottage_profiles")
    .select("id, current_shift_schedule_id")
    .not("application_id", "is", null)
    .single();
  if (profileError) throw profileError;
  if (profile.current_shift_schedule_id) {
    throw new Error("Concurrency fixture already has a Shift Schedule");
  }

  const requestedShifts = [
    { name: "Morning", startTime: "08:00", endTime: "12:00" },
    { name: "Evening", startTime: "18:00", endTime: "23:00" },
  ];
  const saves = await Promise.all(
    owners.map((owner) =>
      owner.rpc("replace_cottage_shift_schedule", {
        target_profile_id: profile.id,
        target_expected_revision: 0,
        requested_shifts: requestedShifts,
      }),
    ),
  );
  const winners = saves.filter(({ error }) => !error);
  const conflicts = saves.filter(({ error }) => error?.code === "RC409");
  const { data: revisions, error: revisionError } = await owners[0]
    .from("cottage_shift_schedule_revisions")
    .select("id, revision")
    .eq("profile_id", profile.id);
  if (revisionError) throw revisionError;
  const { data: savedProfile, error: savedProfileError } = await owners[0]
    .from("owner_application_cottage_profiles")
    .select("current_shift_schedule_id")
    .eq("id", profile.id)
    .single();
  if (savedProfileError) throw savedProfileError;
  const { data: shifts, error: shiftsError } = await owners[0]
    .from("cottage_shifts")
    .select("id")
    .eq("schedule_revision_id", savedProfile.current_shift_schedule_id);
  if (shiftsError) throw shiftsError;

  if (
    winners.length !== 1 ||
    conflicts.length !== 1 ||
    revisions.length !== 1 ||
    revisions[0].revision !== 1 ||
    savedProfile.current_shift_schedule_id !== revisions[0].id ||
    shifts.length !== 2
  ) {
    throw new Error(
      "Concurrent revision-zero Shift Schedule saves did not produce exactly one complete winner",
    );
  }
  console.log(
    "Concurrent revision-zero Shift Schedule saves produced one complete winner and one conflict.",
  );
}
