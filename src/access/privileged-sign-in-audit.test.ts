import { describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ rpc })),
}));

vi.mock("@/config/server-runtime", () => ({
  getServerEnvironment: () => ({
    privilegedAuditHmacKey: "audit-secret-with-at-least-32-characters",
    supabase: {
      url: "https://project.supabase.co",
      secretKey: "audit-secret",
    },
  }),
}));

import { recordPrivilegedSignInAttempt } from "./privileged-sign-in-audit";

describe("privileged sign-in audit", () => {
  it("sends a normalized keyed digest instead of a reusable email hash", async () => {
    rpc.mockResolvedValue({ error: null });

    await recordPrivilegedSignInAttempt({
      email: " Admin@Example.com ",
      stage: "primary",
      outcome: "failed",
    });

    expect(rpc).toHaveBeenCalledWith("record_privileged_sign_in_attempt", {
      attempted_email: " Admin@Example.com ",
      attempted_email_digest:
        "1b9403ce8694a6622db9124737fd2e5e72d030dc37ce188337a0e6fe9848df53",
      attempt_stage: "primary",
      attempt_outcome: "failed",
    });
  });

  it("fails loudly when the audit RPC rejects the write", async () => {
    const error = new Error("audit unavailable");
    rpc.mockResolvedValue({ error });

    await expect(
      recordPrivilegedSignInAttempt({
        email: "admin@example.com",
        stage: "mfa",
        outcome: "succeeded",
      }),
    ).rejects.toBe(error);
  });
});
