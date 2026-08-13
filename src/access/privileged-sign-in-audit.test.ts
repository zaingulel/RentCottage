import { describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ rpc })),
}));

vi.mock("@/config/server-runtime", () => ({
  getServerEnvironment: () => ({
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
        "98b8eddeb63917aae64bd4a9acc65efe52193b9447c2ac819796714866f0fcea",
      attempt_stage: "primary",
      attempt_outcome: "failed",
    });
  });
});
