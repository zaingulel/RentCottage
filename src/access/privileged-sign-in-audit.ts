import { createClient } from "@supabase/supabase-js";

import { getServerEnvironment } from "@/config/server-runtime";

export type PrivilegedSignInStage = "primary" | "mfa";
export type PrivilegedSignInOutcome = "succeeded" | "failed";

export async function recordPrivilegedSignInAttempt(input: {
  email: string;
  stage: PrivilegedSignInStage;
  outcome: PrivilegedSignInOutcome;
}) {
  const { supabase } = getServerEnvironment();
  const client = createClient(supabase.url, supabase.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.rpc("record_privileged_sign_in_attempt", {
    attempted_email: input.email,
    attempt_stage: input.stage,
    attempt_outcome: input.outcome,
  });
  if (error) throw error;
}
