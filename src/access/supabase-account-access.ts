import type { SupabaseClient } from "@supabase/supabase-js";

import {
  createAccountAccess,
  type AccountContext,
  type AccountContextStore,
  type IdentityProvider,
  type MarketplaceRole,
} from "./account-access";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseAccountContext(value: unknown): AccountContext {
  if (!value || typeof value !== "object") {
    throw new Error("Account context is invalid");
  }
  const row = value as Record<string, unknown>;
  if (typeof row.user_id !== "string" || !uuid.test(row.user_id)) {
    throw new Error("Account context has an invalid user identity");
  }
  if (row.role === "cottage_owner") {
    if (
      row.owner_approval_state !== "prospective" &&
      row.owner_approval_state !== "approved"
    ) {
      throw new Error("Account context has an invalid owner approval state");
    }
    return {
      userId: row.user_id,
      role: row.role,
      approvalState: row.owner_approval_state,
    };
  }

  if (
    (row.role !== "customer" && row.role !== "platform_administrator") ||
    row.owner_approval_state !== null
  ) {
    throw new Error("Account context has an invalid role state");
  }
  return { userId: row.user_id, role: row.role };
}

export class SupabaseIdentityProvider implements IdentityProvider {
  constructor(private readonly client: SupabaseClient) {}

  async requestPhoneCode(phone: string) {
    const { error } = await this.client.auth.signInWithOtp({ phone });
    if (error) throw error;
    return { status: "code_sent" as const };
  }

  async verifyPhoneCode(phone: string, code: string) {
    const { data, error } = await this.client.auth.verifyOtp({
      phone,
      token: code,
      type: "sms",
    });
    if (error?.code === "otp_expired") {
      return { status: "invalid_code" as const };
    }
    if (error) throw error;
    if (!data.user) throw new Error("Phone verification returned no identity");
    return { status: "verified" as const, userId: data.user.id };
  }

  async signInPlatformAdministrator(email: string, password: string) {
    const { data, error } = await this.client.auth.signInWithPassword({
      email,
      password,
    });
    if (error?.code === "invalid_credentials") {
      return { status: "invalid_sign_in" as const };
    }
    if (error) throw error;
    if (!data.user)
      throw new Error("Administrator sign-in returned no identity");
    return { status: "authenticated" as const, userId: data.user.id };
  }

  async beginPlatformAdministratorMfa() {
    const { data: factors, error: factorsError } =
      await this.client.auth.mfa.listFactors();
    if (factorsError) throw factorsError;
    const factor = factors.totp.find(
      (candidate) => candidate.status === "verified",
    );

    if (factor) {
      const { data, error } = await this.client.auth.mfa.challenge({
        factorId: factor.id,
      });
      if (error) throw error;
      return {
        status: "challenge_required" as const,
        factorId: factor.id,
        challengeId: data.id,
      };
    }

    for (const candidate of factors.all) {
      if (
        candidate.factor_type === "totp" &&
        candidate.status === "unverified"
      ) {
        const { error } = await this.client.auth.mfa.unenroll({
          factorId: candidate.id,
        });
        if (error) throw error;
      }
    }

    const { data: enrollment, error: enrollmentError } =
      await this.client.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "RentCottage administrator",
      });
    if (enrollmentError) throw enrollmentError;
    const { data: challenge, error: challengeError } =
      await this.client.auth.mfa.challenge({ factorId: enrollment.id });
    if (challengeError) throw challengeError;
    return {
      status: "enrollment_required" as const,
      factorId: enrollment.id,
      challengeId: challenge.id,
      qrCode: enrollment.totp.qr_code,
      secret: enrollment.totp.secret,
    };
  }

  async verifyPlatformAdministratorMfa(
    factorId: string,
    challengeId: string,
    code: string,
  ) {
    const { error } = await this.client.auth.mfa.verify({
      factorId,
      challengeId,
      code,
    });
    if (error?.code === "mfa_challenge_expired") {
      return { status: "challenge_expired" as const };
    }
    if (
      error?.code === "mfa_verification_failed" ||
      error?.code === "mfa_verification_rejected"
    ) {
      return { status: "invalid_code" as const };
    }
    if (error) throw error;
    const { data, error: assuranceError } =
      await this.client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assuranceError) throw assuranceError;
    const { data: claims, error: claimsError } =
      await this.client.auth.getClaims();
    if (claimsError) throw claimsError;
    if (!claims?.claims.sub) throw new Error("MFA returned no identity");
    const assurance: "aal1" | "aal2" =
      data.currentLevel === "aal2" ? "aal2" : "aal1";
    return {
      status: "verified" as const,
      userId: claims.claims.sub,
      assurance,
    };
  }

  async signOut() {
    const { error } = await this.client.auth.signOut();
    if (error) throw error;
  }
}

export class SupabaseAccountContextStore implements AccountContextStore {
  constructor(private readonly client: SupabaseClient) {}

  async claimMarketplaceRole(role: MarketplaceRole) {
    const { data, error } = await this.client.rpc("claim_marketplace_role", {
      requested_role: role,
    });
    if (error?.code === "RC001") {
      return { status: "role_conflict" as const };
    }
    if (error) throw error;
    return {
      status: "claimed" as const,
      context: parseAccountContext(data),
    };
  }

  async resolve() {
    const { data: claims, error: claimsError } =
      await this.client.auth.getClaims();
    if (claimsError) throw claimsError;
    const userId = claims?.claims.sub;
    if (!userId) return undefined;
    const { data, error } = await this.client
      .from("account_contexts")
      .select("user_id, role, owner_approval_state")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return data ? parseAccountContext(data) : undefined;
  }
}

export function createSupabaseAccountAccess(client: SupabaseClient) {
  return createAccountAccess({
    identityProvider: new SupabaseIdentityProvider(client),
    accountContexts: new SupabaseAccountContextStore(client),
  });
}
