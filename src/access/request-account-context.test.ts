import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RequestCookies } from "next/dist/server/web/spec-extension/cookies";
import { RequestCookiesAdapter } from "next/dist/server/web/spec-extension/adapters/request-cookies";
const { getUser, resolve, createClient, getCookies } = vi.hoisted(() => ({
  getUser: vi.fn(),
  resolve: vi.fn(),
  createClient: vi.fn(),
  getCookies: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: getCookies }));
vi.mock("@/config/server-runtime", () => ({
  getServerEnvironment: () => ({
    supabase: {
      url: "https://project-ref.supabase.co",
      publishableKey: "publishable",
    },
  }),
}));
vi.mock("./supabase-server", () => ({
  createRequestSupabaseClient: createClient,
}));
vi.mock("./supabase-account-access", () => ({
  SupabaseAccountContextStore: class {
    resolve = resolve;
  },
}));
import { resolveRequestAccount } from "./request-account-context";
async function configureRealClient(response: Response) {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  const actual =
    await vi.importActual<typeof import("./supabase-server")>(
      "./supabase-server",
    );
  createClient.mockImplementation(actual.createRequestSupabaseClient);
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2030-01-01T00:00:00Z"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  const session = {
    access_token: "synthetic-access-token",
    refresh_token: "synthetic-refresh-token",
    expires_at: 1893459600,
    token_type: "bearer",
    user: { id: "synthetic-user" },
  };
  const value = `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
  const cookieStore = RequestCookiesAdapter.seal(
    new RequestCookies(new Headers({ cookie: `rentcottage-auth=${value}` })),
  );
  getCookies.mockResolvedValue(cookieStore);
  const provider = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input, init) => {
      if (
        input !== "https://project-ref.supabase.co/auth/v1/user" ||
        init?.method !== "GET"
      )
        throw new Error("Unexpected synthetic auth request");
      return response;
    });
  return { provider, cookieStore, value };
}

describe("current request account", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    createClient.mockResolvedValue({ auth: { getUser } });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it("resolves a provider-revoked session as signed out with read-only cookies", async () => {
    const { provider, cookieStore, value } = await configureRealClient(
      Response.json(
        { code: "session_not_found", message: "Session no longer exists" },
        { status: 401, headers: { "x-supabase-api-version": "2024-01-01" } },
      ),
    );

    const account = await resolveRequestAccount();

    expect(provider).toHaveBeenCalledExactlyOnceWith(
      "https://project-ref.supabase.co/auth/v1/user",
      expect.objectContaining({ method: "GET" }),
    );
    expect(resolve).not.toHaveBeenCalled();
    expect(getUser).not.toHaveBeenCalled();
    expect(cookieStore.getAll()).toEqual([{ name: "rentcottage-auth", value }]);
    expect(account).toEqual({ status: "signed_out" });
  });
  it("keeps provider failures unavailable with read-only cookies", async () => {
    const failures = [
      Response.json({ message: "Provider unavailable" }, { status: 503 }),
      new Response('{"message":"<script>synthetic-hostile-marker</script>"', {
        status: 401,
        headers: {
          "content-type": "application/json",
          "x-supabase-api-version": "2024-01-01",
        },
      }),
    ];
    for (const response of failures) {
      const { provider, cookieStore, value } =
        await configureRealClient(response);

      const account = await resolveRequestAccount();

      expect(provider).toHaveBeenCalledExactlyOnceWith(
        "https://project-ref.supabase.co/auth/v1/user",
        expect.objectContaining({ method: "GET" }),
      );
      expect(account).toEqual({ status: "unavailable" });
      expect(resolve).not.toHaveBeenCalled();
      expect(getUser).not.toHaveBeenCalled();
      expect(cookieStore.getAll()).toEqual([
        { name: "rentcottage-auth", value },
      ]);
    }
  });
  it("preserves the framework request-rendering signal", async () => {
    const signal = Object.assign(new Error("Request-time cookies"), {
      digest: "DYNAMIC_SERVER_USAGE",
    });
    createClient.mockRejectedValueOnce(signal);
    await expect(resolveRequestAccount()).rejects.toBe(signal);
  });
  it("reports an ordinary client exception as unavailable", async () => {
    createClient.mockRejectedValueOnce(new Error("Network unavailable"));
    await expect(resolveRequestAccount()).resolves.toEqual({
      status: "unavailable",
    });
  });
  it("checks current user before reading a private account context", async () => {
    getUser.mockResolvedValue({
      data: { user: null },
      error: { name: "AuthSessionMissingError" },
    });
    await expect(resolveRequestAccount()).resolves.toEqual({
      status: "signed_out",
    });
    expect(resolve).not.toHaveBeenCalled();
  });
  it("reports an auth outage as unavailable rather than signed out", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { status: 503 } });
    await expect(resolveRequestAccount()).resolves.toEqual({
      status: "unavailable",
    });
    expect(resolve).not.toHaveBeenCalled();
  });
  it("preserves authenticated identity with no claimed context", async () => {
    getUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });
    resolve.mockResolvedValue(undefined);
    await expect(resolveRequestAccount()).resolves.toEqual({
      status: "authenticated",
      context: undefined,
    });
  });
  it("refuses a context for another user", async () => {
    getUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });
    resolve.mockResolvedValue({ userId: "other", role: "customer" });
    await expect(resolveRequestAccount()).resolves.toEqual({
      status: "unavailable",
    });
  });
});
