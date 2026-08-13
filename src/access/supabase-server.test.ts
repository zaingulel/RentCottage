import { describe, expect, it, vi } from "vitest";

const { getAll, set } = vi.hoisted(() => ({
  getAll: vi.fn(),
  set: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({ getAll, set }),
}));

vi.mock("@/config/server-runtime", () => ({
  getServerEnvironment: () => ({
    supabase: {
      url: "https://project-ref.supabase.co",
      publishableKey: "publishable",
      secretKey: "secret",
    },
  }),
}));

import { clearRequestSupabaseSession } from "./supabase-server";

describe("Supabase request session cleanup", () => {
  it("expires every chunk of the project auth cookie and leaves other cookies", async () => {
    getAll.mockReturnValue([
      { name: "sb-project-ref-auth-token.0", value: "session-part-one" },
      { name: "sb-project-ref-auth-token.1", value: "session-part-two" },
      { name: "preferences", value: "compact" },
    ]);

    await clearRequestSupabaseSession();

    expect(set.mock.calls).toEqual([
      ["sb-project-ref-auth-token.0", "", { path: "/", maxAge: 0 }],
      ["sb-project-ref-auth-token.1", "", { path: "/", maxAge: 0 }],
    ]);
  });
});
