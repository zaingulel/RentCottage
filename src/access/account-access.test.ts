import { describe, expect, it } from "vitest";

import {
  createAccountAccess,
  type AccountContext,
  type AccountContextStore,
  type IdentityProvider,
} from "./account-access";

function identityProvider(userId = "customer-user"): IdentityProvider {
  return {
    requestPhoneCode: async () => ({ status: "code_sent" }),
    verifyPhoneCode: async () => ({ userId }),
    signInPlatformAdministrator: async () => ({ userId }),
    beginPlatformAdministratorMfa: async () => ({
      status: "challenge_required",
      factorId: "factor-1",
      challengeId: "challenge-1",
    }),
    verifyPlatformAdministratorMfa: async () => ({ userId, assurance: "aal2" }),
    signOut: async () => undefined,
  };
}

function accountContexts(
  initial?: AccountContext,
): AccountContextStore & { current: AccountContext | undefined } {
  return {
    current: initial,
    async claimMarketplaceRole(role) {
      if (this.current && this.current.role !== role) {
        return { status: "role_conflict" };
      }

      this.current ??=
        role === "customer"
          ? { userId: "customer-user", role }
          : {
              userId: "owner-user",
              role,
              approvalState: "prospective",
            };
      return { status: "claimed", context: this.current };
    },
    async resolve() {
      return this.current;
    },
  };
}

describe("account access", () => {
  it("starts phone verification without assigning a role", async () => {
    const contexts = accountContexts();
    const access = createAccountAccess({
      identityProvider: identityProvider(),
      accountContexts: contexts,
    });

    await expect(
      access.requestPhoneAccess({ phone: "+9647500000000" }),
    ).resolves.toEqual({ status: "code_sent" });
    expect(contexts.current).toBeUndefined();
  });

  it("gives a verified customer only a customer context", async () => {
    const contexts = accountContexts();
    const access = createAccountAccess({
      identityProvider: identityProvider(),
      accountContexts: contexts,
    });

    await expect(
      access.verifyPhoneAccess({
        phone: "+9647500000000",
        code: "123456",
        role: "customer",
      }),
    ).resolves.toEqual({
      status: "authenticated",
      context: { userId: "customer-user", role: "customer" },
    });
  });

  it("gives a verified Cottage Owner only prospective owner access", async () => {
    const contexts = accountContexts();
    const access = createAccountAccess({
      identityProvider: identityProvider("owner-user"),
      accountContexts: contexts,
    });

    await expect(
      access.verifyPhoneAccess({
        phone: "+9647500000001",
        code: "123456",
        role: "cottage_owner",
      }),
    ).resolves.toEqual({
      status: "authenticated",
      context: {
        userId: "owner-user",
        role: "cottage_owner",
        approvalState: "prospective",
      },
    });
  });

  it("signs out when a verified identity tries to claim a second role", async () => {
    let signedOut = false;
    const provider = identityProvider();
    provider.signOut = async () => {
      signedOut = true;
    };
    const access = createAccountAccess({
      identityProvider: provider,
      accountContexts: accountContexts({
        userId: "customer-user",
        role: "customer",
      }),
    });

    await expect(
      access.verifyPhoneAccess({
        phone: "+9647500000",
        code: "123456",
        role: "cottage_owner",
      }),
    ).resolves.toEqual({ status: "role_conflict" });
    expect(signedOut).toBe(true);
  });

  it("signs out when phone verification returns another identity's context", async () => {
    let signedOut = false;
    const provider = identityProvider("different-user");
    provider.signOut = async () => {
      signedOut = true;
    };
    const access = createAccountAccess({
      identityProvider: provider,
      accountContexts: accountContexts(),
    });

    await expect(
      access.verifyPhoneAccess({
        phone: "+9647500000000",
        code: "123456",
        role: "customer",
      }),
    ).resolves.toEqual({ status: "not_authorized" });
    expect(signedOut).toBe(true);
  });

  it("requires assurance level 2 before returning Platform Administrator access", async () => {
    const access = createAccountAccess({
      identityProvider: identityProvider("admin-user"),
      accountContexts: accountContexts({
        userId: "admin-user",
        role: "platform_administrator",
      }),
    });

    await expect(
      access.signInPlatformAdministrator({
        email: "admin@example.com",
        password: "a-secure-password",
      }),
    ).resolves.toEqual({
      status: "challenge_required",
      factorId: "factor-1",
      challengeId: "challenge-1",
    });

    await expect(
      access.verifyPlatformAdministratorMfa({
        factorId: "factor-1",
        challengeId: "challenge-1",
        code: "654321",
      }),
    ).resolves.toEqual({
      status: "authenticated",
      context: { userId: "admin-user", role: "platform_administrator" },
    });
  });

  it("signs out when administrator verification remains at assurance level 1", async () => {
    let signedOut = false;
    const provider = identityProvider("admin-user");
    provider.verifyPlatformAdministratorMfa = async () => ({
      userId: "admin-user",
      assurance: "aal1",
    });
    provider.signOut = async () => {
      signedOut = true;
    };
    const access = createAccountAccess({
      identityProvider: provider,
      accountContexts: accountContexts({
        userId: "admin-user",
        role: "platform_administrator",
      }),
    });

    await expect(
      access.verifyPlatformAdministratorMfa({
        factorId: "factor-1",
        challengeId: "challenge-1",
        code: "invalid",
      }),
    ).resolves.toEqual({ status: "not_authorized" });
    expect(signedOut).toBe(true);
  });

  it("signs out when administrator primary authentication resolves another identity", async () => {
    let signedOut = false;
    const provider = identityProvider("different-admin");
    provider.signOut = async () => {
      signedOut = true;
    };
    const access = createAccountAccess({
      identityProvider: provider,
      accountContexts: accountContexts({
        userId: "admin-user",
        role: "platform_administrator",
      }),
    });

    await expect(
      access.signInPlatformAdministrator({
        email: "admin@example.com",
        password: "a-secure-password",
      }),
    ).resolves.toEqual({ status: "not_authorized" });
    expect(signedOut).toBe(true);
  });

  it.each(["begin", "verify"] as const)(
    "signs out when administrator MFA %s throws",
    async (stage) => {
      let signedOut = false;
      const provider = identityProvider("admin-user");
      provider.signOut = async () => {
        signedOut = true;
      };
      if (stage === "begin") {
        provider.beginPlatformAdministratorMfa = async () => {
          throw new Error("MFA unavailable");
        };
      } else {
        provider.verifyPlatformAdministratorMfa = async () => {
          throw new Error("MFA unavailable");
        };
      }
      const access = createAccountAccess({
        identityProvider: provider,
        accountContexts: accountContexts({
          userId: "admin-user",
          role: "platform_administrator",
        }),
      });

      const operation =
        stage === "begin"
          ? access.signInPlatformAdministrator({
              email: "admin@example.com",
              password: "a-secure-password",
            })
          : access.verifyPlatformAdministratorMfa({
              factorId: "factor-1",
              challengeId: "challenge-1",
              code: "654321",
            });

      await expect(operation).rejects.toThrow("MFA unavailable");
      expect(signedOut).toBe(true);
    },
  );
});
