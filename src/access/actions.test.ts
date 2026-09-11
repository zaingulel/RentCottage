import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  recordAudit,
  createClient,
  clearSession,
  createAccess,
  redirect,
  revalidatePath,
} = vi.hoisted(() => ({
  recordAudit: vi.fn(),
  redirect: vi.fn(),
  revalidatePath: vi.fn(),
  createClient: vi.fn(),
  clearSession: vi.fn(),
  createAccess: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("./privileged-sign-in-audit", () => ({
  recordPrivilegedSignInAttempt: recordAudit,
}));
vi.mock("./supabase-server", () => ({
  createRequestSupabaseClient: createClient,
  clearRequestSupabaseSession: clearSession,
}));
vi.mock("./supabase-account-access", () => ({
  createSupabaseAccountAccess: createAccess,
}));

import {
  enrollOwner,
  signOutAccount,
  requestPhoneAccess,
  signInPlatformAdministrator,
  verifyPhoneAccess,
  verifyPlatformAdministratorMfa,
} from "./actions";

describe("account action HTTP boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recordAudit.mockResolvedValue(undefined);
    clearSession.mockResolvedValue(undefined);
  });

  it("rejects malformed public phone inputs before reaching Supabase", async () => {
    await expect(requestPhoneAccess(undefined)).resolves.toEqual({
      status: "invalid_phone",
    });
    await expect(
      verifyPhoneAccess({
        phone: "+9647500000000",
        code: "123456",
        role: "platform_administrator",
      }),
    ).resolves.toEqual({ status: "invalid_code" });
    expect(createClient).not.toHaveBeenCalled();
  });

  it.each([
    "/en/owner/booking-requests/RC-REQ-0123456789ABCDEF",
    "/en/owner/cottages/10000000-0000-4000-8000-000000000001",
  ])(
    "refuses enrollment from the participant-only destination %s before contacting Supabase",
    async (returnTo) => {
      await expect(enrollOwner({ locale: "en", returnTo })).resolves.toEqual({
        status: "not_authorized",
      });
      expect(createClient).not.toHaveBeenCalled();
      expect(createAccess).not.toHaveBeenCalled();
    },
  );

  it.each(["/ar/owner/application", "/ar/owner/cottages"])(
    "enrolls from the supported owner-onboarding destination %s",
    async (returnTo) => {
      const enrollment = vi.fn().mockResolvedValue({ status: "enrolled" });
      createClient.mockResolvedValue({});
      createAccess.mockReturnValue({ enrollOwner: enrollment });

      await expect(enrollOwner({ locale: "ar", returnTo })).resolves.toEqual({
        status: "enrolled",
        destination: returnTo,
      });
      expect(enrollment).toHaveBeenCalledOnce();
      expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    },
  );

  it("reports role assignment infrastructure failure as unavailable", async () => {
    const signOut = vi.fn().mockResolvedValue({
      error: new Error("provider unavailable"),
    });
    createClient.mockResolvedValue({ auth: { signOut } });
    createAccess.mockReturnValue({
      verifyPhoneAccess: vi
        .fn()
        .mockRejectedValue(new Error("role store unavailable")),
    });

    await expect(
      verifyPhoneAccess({
        phone: "+9647500000000",
        code: "123456",
      }),
    ).resolves.toEqual({ status: "unavailable" });
    expect(clearSession).toHaveBeenCalledOnce();
  });

  it.each(["primary", "mfa"] as const)(
    "reports administrator %s infrastructure failure as unavailable and clears a failed sign-out",
    async (stage) => {
      const signOut = vi.fn().mockResolvedValue({
        error: new Error("provider unavailable"),
      });
      createClient.mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { email: "admin@example.com" } },
            error: null,
          }),
          signOut,
        },
      });
      createAccess.mockReturnValue({
        signInPlatformAdministrator: vi
          .fn()
          .mockRejectedValue(new Error("identity store unavailable")),
        verifyPlatformAdministratorMfa: vi
          .fn()
          .mockRejectedValue(new Error("identity store unavailable")),
      });

      const operation =
        stage === "primary"
          ? signInPlatformAdministrator({
              email: "admin@example.com",
              password: "correct-password",
            })
          : verifyPlatformAdministratorMfa({
              factorId: "factor-1",
              challengeId: "challenge-1",
              code: "123456",
            });

      await expect(operation).resolves.toEqual({ status: "unavailable" });
      expect(recordAudit).toHaveBeenCalledWith({
        email: "admin@example.com",
        stage,
        outcome: "failed",
      });
      expect(clearSession).toHaveBeenCalledOnce();
    },
  );

  it("audits a malformed administrator sign-in without throwing", async () => {
    await expect(signInPlatformAdministrator(null)).resolves.toEqual({
      status: "invalid_sign_in",
    });
    expect(recordAudit).toHaveBeenCalledWith({
      email: "",
      stage: "primary",
      outcome: "failed",
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("audits malformed MFA input against the signed-in administrator", async () => {
    createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { email: "admin@example.com" } },
          error: null,
        }),
      },
    });

    await expect(verifyPlatformAdministratorMfa(undefined)).resolves.toEqual({
      status: "invalid_code",
    });
    expect(recordAudit).toHaveBeenCalledWith({
      email: "admin@example.com",
      stage: "mfa",
      outcome: "failed",
    });
    expect(createAccess).not.toHaveBeenCalled();
  });

  it("clears an unresolved administrator session after identity lookup fails", async () => {
    const signOut = vi.fn().mockResolvedValue({
      error: new Error("provider unavailable"),
    });
    createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: new Error("identity lookup unavailable"),
        }),
        signOut,
      },
    });

    await expect(verifyPlatformAdministratorMfa(undefined)).resolves.toEqual({
      status: "unavailable",
    });
    expect(clearSession).toHaveBeenCalledOnce();
  });

  it("signs out and returns unavailable when a successful MFA audit cannot persist", async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null });
    createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { email: "admin@example.com" } },
          error: null,
        }),
        signOut,
      },
    });
    createAccess.mockReturnValue({
      verifyPlatformAdministratorMfa: vi.fn().mockResolvedValue({
        status: "authenticated",
        context: { userId: "admin-user", role: "platform_administrator" },
      }),
    });
    recordAudit.mockRejectedValue(new Error("audit unavailable"));

    await expect(
      verifyPlatformAdministratorMfa({
        factorId: "factor-1",
        challengeId: "challenge-1",
        code: "123456",
      }),
    ).resolves.toEqual({ status: "unavailable" });
    expect(signOut).toHaveBeenCalledOnce();
    expect(clearSession).not.toHaveBeenCalled();
  });

  it("clears the browser session when provider sign-out cannot revoke an unaudited login", async () => {
    const signOut = vi.fn().mockResolvedValue({
      error: new Error("provider unavailable"),
    });
    createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { email: "admin@example.com" } },
          error: null,
        }),
        signOut,
      },
    });
    createAccess.mockReturnValue({
      verifyPlatformAdministratorMfa: vi.fn().mockResolvedValue({
        status: "authenticated",
        context: { userId: "admin-user", role: "platform_administrator" },
      }),
    });
    recordAudit.mockRejectedValue(new Error("audit unavailable"));

    await expect(
      verifyPlatformAdministratorMfa({
        factorId: "factor-1",
        challengeId: "challenge-1",
        code: "123456",
      }),
    ).resolves.toEqual({ status: "unavailable" });
    expect(signOut).toHaveBeenCalledOnce();
    expect(clearSession).toHaveBeenCalledOnce();
  });

  it("signs out and returns unavailable when a successful primary audit cannot persist", async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null });
    createClient.mockResolvedValue({ auth: { signOut } });
    createAccess.mockReturnValue({
      signInPlatformAdministrator: vi.fn().mockResolvedValue({
        status: "challenge_required",
        factorId: "factor-1",
        challengeId: "challenge-1",
      }),
    });
    recordAudit.mockRejectedValue(new Error("audit unavailable"));

    await expect(
      signInPlatformAdministrator({
        email: "admin@example.com",
        password: "correct-password",
      }),
    ).resolves.toEqual({ status: "unavailable" });
    expect(signOut).toHaveBeenCalledOnce();
  });
});

describe("current-device sign out", () => {
  it.each([false, true])(
    "clears local session and private rendering when provider error is %s",
    async (providerError) => {
      vi.clearAllMocks();
      const signOut = vi.fn().mockResolvedValue({
        error: providerError ? new Error("offline") : null,
      });
      createClient.mockResolvedValue({ auth: { signOut } });
      await signOutAccount("ckb");
      expect(signOut).toHaveBeenCalledWith({ scope: "local" });
      expect(clearSession).toHaveBeenCalledOnce();
      expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
      expect(redirect).toHaveBeenCalledWith("/ckb");
    },
  );
});
