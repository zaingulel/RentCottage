export type MarketplaceRole = "customer" | "cottage_owner";

export type AccountContext =
  | { userId: string; role: "customer" }
  | {
      userId: string;
      role: "cottage_owner";
      approvalState: "prospective" | "approved";
    }
  | { userId: string; role: "platform_administrator" };

export interface IdentityProvider {
  requestPhoneCode(phone: string): Promise<{ status: "code_sent" }>;
  verifyPhoneCode(phone: string, code: string): Promise<{ userId: string }>;
  signInPlatformAdministrator(
    email: string,
    password: string,
  ): Promise<{ userId: string }>;
  beginPlatformAdministratorMfa(): Promise<
    | {
        status: "challenge_required";
        factorId: string;
        challengeId: string;
      }
    | {
        status: "enrollment_required";
        factorId: string;
        challengeId: string;
        qrCode: string;
        secret: string;
      }
  >;
  verifyPlatformAdministratorMfa(
    factorId: string,
    challengeId: string,
    code: string,
  ): Promise<{ userId: string; assurance: "aal1" | "aal2" }>;
  signOut(): Promise<void>;
}

export interface AccountContextStore {
  claimMarketplaceRole(
    role: MarketplaceRole,
  ): Promise<
    { status: "claimed"; context: AccountContext } | { status: "role_conflict" }
  >;
  resolve(): Promise<AccountContext | undefined>;
}

export function createAccountAccess({
  identityProvider,
  accountContexts,
}: {
  identityProvider: IdentityProvider;
  accountContexts: AccountContextStore;
}) {
  return {
    requestPhoneAccess({ phone }: { phone: string }) {
      return identityProvider.requestPhoneCode(phone);
    },
    async verifyPhoneAccess({
      phone,
      code,
      role,
    }: {
      phone: string;
      code: string;
      role: MarketplaceRole;
    }) {
      const identity = await identityProvider.verifyPhoneCode(phone, code);
      const result = await accountContexts.claimMarketplaceRole(role);
      if (result.status === "role_conflict") {
        await identityProvider.signOut();
        return result;
      }
      if (result.context.userId !== identity.userId) {
        await identityProvider.signOut();
        return { status: "not_authorized" as const };
      }

      return { status: "authenticated" as const, context: result.context };
    },
    async signInPlatformAdministrator({
      email,
      password,
    }: {
      email: string;
      password: string;
    }) {
      const identity = await identityProvider.signInPlatformAdministrator(
        email,
        password,
      );
      const context = await accountContexts.resolve();
      if (
        context?.role !== "platform_administrator" ||
        context.userId !== identity.userId
      ) {
        await identityProvider.signOut();
        return { status: "not_authorized" as const };
      }

      try {
        return await identityProvider.beginPlatformAdministratorMfa();
      } catch (error) {
        await identityProvider.signOut();
        throw error;
      }
    },
    async verifyPlatformAdministratorMfa({
      factorId,
      challengeId,
      code,
    }: {
      factorId: string;
      challengeId: string;
      code: string;
    }) {
      let identity;
      try {
        identity = await identityProvider.verifyPlatformAdministratorMfa(
          factorId,
          challengeId,
          code,
        );
      } catch (error) {
        await identityProvider.signOut();
        throw error;
      }
      const context = await accountContexts.resolve();
      if (
        identity.assurance !== "aal2" ||
        context?.role !== "platform_administrator" ||
        context.userId !== identity.userId
      ) {
        await identityProvider.signOut();
        return { status: "not_authorized" as const };
      }

      return { status: "authenticated" as const, context };
    },
  };
}
