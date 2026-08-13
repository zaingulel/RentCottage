import { beforeEach, describe, expect, it, vi } from "vitest";

const { recordAudit, createClient, createAccess } = vi.hoisted(() => ({
  recordAudit: vi.fn(),
  createClient: vi.fn(),
  createAccess: vi.fn(),
}));

vi.mock("./privileged-sign-in-audit", () => ({
  recordPrivilegedSignInAttempt: recordAudit,
}));
vi.mock("./supabase-server", () => ({
  createRequestSupabaseClient: createClient,
}));
vi.mock("./supabase-account-access", () => ({
  createSupabaseAccountAccess: createAccess,
}));

import {
  requestPhoneAccess,
  signInPlatformAdministrator,
  verifyPhoneAccess,
  verifyPlatformAdministratorMfa,
} from "./actions";

describe("account action HTTP boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recordAudit.mockResolvedValue(undefined);
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
});
