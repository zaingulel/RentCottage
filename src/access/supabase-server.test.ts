import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createServerClient, getAll, set, getCookies } = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  getAll: vi.fn(),
  set: vi.fn(),
  getCookies: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({ createServerClient }));

vi.mock("next/headers", () => ({
  cookies: getCookies,
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

async function configureRealClient() {
  const actual =
    await vi.importActual<typeof import("@supabase/ssr")>("@supabase/ssr");
  createServerClient.mockImplementation(actual.createServerClient);
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2030-01-01T00:00:00Z"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  const session = {
    access_token: "synthetic-access-token",
    refresh_token: "synthetic-refresh-token",
    expires_at: 1893459600,
    token_type: "bearer",
    user: { id: "synthetic-user" },
  };
  getAll.mockReturnValue([
    {
      name: "rentcottage-auth",
      value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`,
    },
  ]);
  const provider = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input, init) => {
      if (
        input !== "https://project-ref.supabase.co/auth/v1/user" ||
        init?.method !== "GET"
      )
        throw new Error("Unexpected synthetic auth request");
      return Response.json(
        { code: "session_not_found", message: "Session no longer exists" },
        { status: 401, headers: { "x-supabase-api-version": "2024-01-01" } },
      );
    });
  return provider;
}

describe("Supabase request session cleanup", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getCookies.mockResolvedValue({ getAll, set });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("persists missing-session cleanup with the default writable client", async () => {
    const provider = await configureRealClient();
    const client = await createRequestSupabaseClient();

    await expect(client.auth.getUser()).resolves.toEqual({
      data: { user: null },
      error: expect.objectContaining({ name: "AuthSessionMissingError" }),
    });
    expect(provider).toHaveBeenCalledExactlyOnceWith(
      "https://project-ref.supabase.co/auth/v1/user",
      expect.objectContaining({ method: "GET" }),
    );
    expect(set).toHaveBeenCalledExactlyOnceWith(
      "rentcottage-auth",
      "",
      expect.objectContaining({ path: "/", maxAge: 0 }),
    );
  });

  it("propagates unexpected default-client cookie write failures", async () => {
    const provider = await configureRealClient();
    const failure = new Error("Synthetic cookie storage failure");
    set.mockImplementation(() => {
      throw failure;
    });
    const client = await createRequestSupabaseClient();

    await expect(client.auth.getUser()).rejects.toBe(failure);
    expect(provider).toHaveBeenCalledExactlyOnceWith(
      "https://project-ref.supabase.co/auth/v1/user",
      expect.objectContaining({ method: "GET" }),
    );
    expect(set).toHaveBeenCalledExactlyOnceWith(
      "rentcottage-auth",
      "",
      expect.objectContaining({ path: "/", maxAge: 0 }),
    );
  });
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
