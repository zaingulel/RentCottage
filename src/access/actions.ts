"use server";

import { recordPrivilegedSignInAttempt } from "./privileged-sign-in-audit";
import { createSupabaseAccountAccess } from "./supabase-account-access";
import { createRequestSupabaseClient } from "./supabase-server";

const iraqiPhone = /^\+964\d{10}$/;
const otp = /^\d{6}$/;

function recordInput(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

export async function requestPhoneAccess(phone: unknown) {
  if (typeof phone !== "string") {
    return { status: "invalid_phone" as const };
  }
  if (!iraqiPhone.test(phone)) return { status: "invalid_phone" as const };
  try {
    const access = createSupabaseAccountAccess(
      await createRequestSupabaseClient(),
    );
    return await access.requestPhoneAccess({ phone });
  } catch {
    return { status: "unavailable" as const };
  }
}

export async function verifyPhoneAccess(value: unknown) {
  const input = recordInput(value);
  if (
    !input ||
    typeof input.phone !== "string" ||
    typeof input.code !== "string" ||
    (input.role !== "customer" && input.role !== "cottage_owner") ||
    !iraqiPhone.test(input.phone) ||
    !otp.test(input.code)
  ) {
    return { status: "invalid_code" as const };
  }
  try {
    const access = createSupabaseAccountAccess(
      await createRequestSupabaseClient(),
    );
    return await access.verifyPhoneAccess({
      phone: input.phone,
      code: input.code,
      role: input.role,
    });
  } catch {
    return { status: "invalid_code" as const };
  }
}

export async function signInPlatformAdministrator(value: unknown) {
  const input = recordInput(value);
  const email =
    typeof input?.email === "string" ? input.email.trim().toLowerCase() : "";
  if (
    !email ||
    email.length > 320 ||
    typeof input?.password !== "string" ||
    !input.password
  ) {
    await recordPrivilegedSignInAttempt({
      email,
      stage: "primary",
      outcome: "failed",
    });
    return { status: "invalid_sign_in" as const };
  }
  let result;
  try {
    const access = createSupabaseAccountAccess(
      await createRequestSupabaseClient(),
    );
    result = await access.signInPlatformAdministrator({
      email,
      password: input.password,
    });
  } catch {
    await recordPrivilegedSignInAttempt({
      email,
      stage: "primary",
      outcome: "failed",
    });
    return { status: "invalid_sign_in" as const };
  }

  await recordPrivilegedSignInAttempt({
    email,
    stage: "primary",
    outcome:
      result.status === "challenge_required" ||
      result.status === "enrollment_required"
        ? "succeeded"
        : "failed",
  });
  return result;
}

export async function verifyPlatformAdministratorMfa(value: unknown) {
  const input = recordInput(value);
  const client = await createRequestSupabaseClient();
  const { data: userData, error: userError } = await client.auth.getUser();
  const email = userData.user?.email ?? "";
  if (
    userError ||
    !email ||
    typeof input?.factorId !== "string" ||
    !input.factorId ||
    typeof input.challengeId !== "string" ||
    !input.challengeId ||
    typeof input.code !== "string" ||
    !otp.test(input.code)
  ) {
    await recordPrivilegedSignInAttempt({
      email,
      stage: "mfa",
      outcome: "failed",
    });
    return { status: "invalid_code" as const };
  }
  let result;
  try {
    const access = createSupabaseAccountAccess(client);
    result = await access.verifyPlatformAdministratorMfa({
      factorId: input.factorId,
      challengeId: input.challengeId,
      code: input.code,
    });
  } catch {
    await recordPrivilegedSignInAttempt({
      email,
      stage: "mfa",
      outcome: "failed",
    });
    return { status: "invalid_code" as const };
  }

  await recordPrivilegedSignInAttempt({
    email,
    stage: "mfa",
    outcome: result.status === "authenticated" ? "succeeded" : "failed",
  });
  return result;
}
