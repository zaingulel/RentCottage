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
    {
      user_id: "81f35355-d3f7-4bfd-bfc4-e4a6887adfc3",
      role: "cottage_owner",
      owner_approval_state: "suspended",
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
