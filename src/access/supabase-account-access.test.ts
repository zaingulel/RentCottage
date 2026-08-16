import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  parseAccountContext,
  SupabaseAccountContextStore,
  SupabaseIdentityProvider,
} from "./supabase-account-access";

describe("Supabase account context boundary", () => {
  it("accepts every UUID layout PostgreSQL accepts", () => {
    expect(
      parseAccountContext({
        user_id: "00000000-0000-0000-0000-000000000001",
        role: "customer",
        owner_approval_state: null,
      }),
    ).toEqual({
      userId: "00000000-0000-0000-0000-000000000001",
      role: "customer",
    });
  });

  it("accepts an explicit valid Cottage Owner state", () => {
    expect(
      parseAccountContext({
        user_id: "81f35355-d3f7-4bfd-bfc4-e4a6887adfc3",
        role: "cottage_owner",
        owner_approval_state: "prospective",
      }),
    ).toEqual({
      userId: "81f35355-d3f7-4bfd-bfc4-e4a6887adfc3",
      role: "cottage_owner",
      approvalState: "prospective",
    });
  });

  it.each(["expired", "suspended"] as const)(
    "accepts the servicing-only Cottage Owner state %s",
    (approvalState) => {
      expect(
        parseAccountContext({
          user_id: "81f35355-d3f7-4bfd-bfc4-e4a6887adfc3",
          role: "cottage_owner",
          owner_approval_state: approvalState,
        }),
      ).toEqual({
        userId: "81f35355-d3f7-4bfd-bfc4-e4a6887adfc3",
        role: "cottage_owner",
        approvalState,
      });
    },
  );

  it.each([
    undefined,
    { user_id: "not-a-uuid", role: "customer", owner_approval_state: null },
    {
      user_id: "81f35355-d3f7-4bfd-bfc4-e4a6887adfc3",
      role: "unexpected",
      owner_approval_state: null,
    },
    {
      user_id: "81f35355-d3f7-4bfd-bfc4-e4a6887adfc3",
      role: "customer",
      owner_approval_state: "approved",
    },
    {
      user_id: "81f35355-d3f7-4bfd-bfc4-e4a6887adfc3",
      role: "cottage_owner",
    },
    {
      user_id: "81f35355-d3f7-4bfd-bfc4-e4a6887adfc3",
      role: "cottage_owner",
      owner_approval_state: null,
    },
  ])("rejects invalid provider data %#", (value) => {
    expect(() => parseAccountContext(value)).toThrow(/Account context/);
  });
});

describe("Supabase administrator MFA adapter", () => {
  it("removes interrupted TOTP enrollment before starting again", async () => {
    const unenroll = vi.fn().mockResolvedValue({ data: {}, error: null });
    const enroll = vi.fn().mockResolvedValue({
      data: {
        id: "new-factor",
        totp: { qr_code: "data:image/svg+xml,test", secret: "SECRET" },
      },
      error: null,
    });
    const client = {
      auth: {
        mfa: {
          listFactors: vi.fn().mockResolvedValue({
            data: {
              all: [
                {
                  id: "stale-factor",
                  factor_type: "totp",
                  status: "unverified",
                },
              ],
              totp: [],
            },
            error: null,
          }),
          unenroll,
          enroll,
          challenge: vi.fn().mockResolvedValue({
            data: { id: "new-challenge" },
            error: null,
          }),
        },
      },
    } as unknown as SupabaseClient;

    const provider = new SupabaseIdentityProvider(client);

    await expect(
      provider.beginPlatformAdministratorMfa(),
    ).resolves.toMatchObject({
      status: "enrollment_required",
      factorId: "new-factor",
      challengeId: "new-challenge",
    });
    expect(unenroll).toHaveBeenCalledWith({ factorId: "stale-factor" });
    expect(unenroll.mock.invocationCallOrder[0]).toBeLessThan(
      enroll.mock.invocationCallOrder[0],
    );
  });

  it("challenges a verified TOTP factor without replacing it", async () => {
    const unenroll = vi.fn();
    const enroll = vi.fn();
    const challenge = vi.fn().mockResolvedValue({
      data: { id: "verified-challenge" },
      error: null,
    });
    const client = {
      auth: {
        mfa: {
          listFactors: vi.fn().mockResolvedValue({
            data: {
              all: [],
              totp: [
                {
                  id: "verified-factor",
                  factor_type: "totp",
                  status: "verified",
                },
              ],
            },
            error: null,
          }),
          unenroll,
          enroll,
          challenge,
        },
      },
    } as unknown as SupabaseClient;

    await expect(
      new SupabaseIdentityProvider(client).beginPlatformAdministratorMfa(),
    ).resolves.toEqual({
      status: "challenge_required",
      factorId: "verified-factor",
      challengeId: "verified-challenge",
    });
    expect(unenroll).not.toHaveBeenCalled();
    expect(enroll).not.toHaveBeenCalled();
  });

  it.each([["mfa_verification_failed"], ["mfa_verification_rejected"]])(
    "maps %s to an invalid authenticator code",
    async (code) => {
      const client = {
        auth: {
          mfa: {
            verify: vi.fn().mockResolvedValue({ error: { code } }),
          },
        },
      } as unknown as SupabaseClient;

      await expect(
        new SupabaseIdentityProvider(client).verifyPlatformAdministratorMfa(
          "factor-1",
          "challenge-1",
          "123456",
        ),
      ).resolves.toEqual({ status: "invalid_code" });
    },
  );

  it("maps an expired MFA challenge to a restart result", async () => {
    const client = {
      auth: {
        mfa: {
          verify: vi.fn().mockResolvedValue({
            error: { code: "mfa_challenge_expired" },
          }),
        },
      },
    } as unknown as SupabaseClient;

    await expect(
      new SupabaseIdentityProvider(client).verifyPlatformAdministratorMfa(
        "factor-1",
        "challenge-1",
        "123456",
      ),
    ).resolves.toEqual({ status: "challenge_expired" });
  });
});

describe("Supabase administrator primary adapter", () => {
  it("maps rejected credentials without hiding provider outages", async () => {
    const client = {
      auth: {
        signInWithPassword: vi.fn().mockResolvedValue({
          data: { user: null },
          error: { code: "invalid_credentials" },
        }),
      },
    } as unknown as SupabaseClient;

    await expect(
      new SupabaseIdentityProvider(client).signInPlatformAdministrator(
        "admin@example.com",
        "wrong-password",
      ),
    ).resolves.toEqual({ status: "invalid_sign_in" });
  });
});

describe("Supabase phone verification adapter", () => {
  it("maps an expired one-time code to the public invalid-code result", async () => {
    const client = {
      auth: {
        verifyOtp: vi.fn().mockResolvedValue({
          data: { user: null },
          error: { code: "otp_expired" },
        }),
      },
    } as unknown as SupabaseClient;

    await expect(
      new SupabaseIdentityProvider(client).verifyPhoneCode(
        "+9647500000000",
        "123456",
      ),
    ).resolves.toEqual({ status: "invalid_code" });
  });
});

describe("Supabase marketplace role adapter", () => {
  it("maps the role conflict SQL state without parsing provider prose", async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: "RC001", message: "provider wording may change" },
      }),
    } as unknown as SupabaseClient;

    await expect(
      new SupabaseAccountContextStore(client).claimMarketplaceRole("customer"),
    ).resolves.toEqual({ status: "role_conflict" });
  });
});
