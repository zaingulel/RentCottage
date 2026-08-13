import { createClient } from "@supabase/supabase-js";

import { getServerEnvironment } from "@/config/server-runtime";

export type PrivilegedSignInStage = "primary" | "mfa";
export type PrivilegedSignInOutcome = "succeeded" | "failed";

async function keyedEmailDigest(email: string, secretKey: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secretKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(email.trim().toLowerCase()),
  );
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function recordPrivilegedSignInAttempt(input: {
  email: string;
  stage: PrivilegedSignInStage;
  outcome: PrivilegedSignInOutcome;
}) {
  const { supabase, privilegedAuditHmacKey } = getServerEnvironment();
  const client = createClient(supabase.url, supabase.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const emailDigest = await keyedEmailDigest(
    input.email,
    privilegedAuditHmacKey,
  );
  const { error } = await client.rpc("record_privileged_sign_in_attempt", {
    attempted_email: input.email,
    attempted_email_digest: emailDigest,
    attempt_stage: input.stage,
    attempt_outcome: input.outcome,
  });
  if (error) throw error;
}
