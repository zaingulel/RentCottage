import { beforeEach, describe, expect, it, vi } from "vitest";
const { getUser, resolve, createClient } = vi.hoisted(() => ({
  getUser: vi.fn(),
  resolve: vi.fn(),
  createClient: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("./supabase-server", () => ({
  createRequestSupabaseClient: createClient,
}));
vi.mock("./supabase-account-access", () => ({
  SupabaseAccountContextStore: class {
    resolve = resolve;
  },
}));
import { resolveRequestAccount } from "./request-account-context";
describe("current request account", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClient.mockResolvedValue({ auth: { getUser } });
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
