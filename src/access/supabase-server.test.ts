import { describe, expect, it, vi } from "vitest";

const { createServerClient, getAll, set } = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  getAll: vi.fn(),
  set: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({ createServerClient }));

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

import {
  clearRequestSupabaseSession,
  createRequestSupabaseClient,
} from "./supabase-server";

describe("Supabase request session cleanup", () => {
  it("configures the same explicit auth cookie name used by cleanup", async () => {
    createServerClient.mockReturnValue({ configured: true });

    await expect(createRequestSupabaseClient()).resolves.toEqual({
      configured: true,
    });
    expect(createServerClient).toHaveBeenCalledWith(
      "https://project-ref.supabase.co",
      "publishable",
      expect.objectContaining({
        cookieOptions: { name: "rentcottage-auth" },
      }),
    );
  });

  it("expires every chunk of the project auth cookie and leaves other cookies", async () => {
    getAll.mockReturnValue([
      { name: "rentcottage-auth.0", value: "session-part-one" },
      { name: "rentcottage-auth.1", value: "session-part-two" },
      { name: "preferences", value: "compact" },
    ]);

    await clearRequestSupabaseSession();

    expect(set.mock.calls).toEqual([
      ["rentcottage-auth.0", "", { path: "/", maxAge: 0 }],
      ["rentcottage-auth.1", "", { path: "/", maxAge: 0 }],
    ]);
  });
});
