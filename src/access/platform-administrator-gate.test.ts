import { beforeEach, describe, expect, it, vi } from "vitest";
const { rpc, resolve, createClient } = vi.hoisted(() => ({
  rpc: vi.fn(),
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
import { resolvePlatformAdministratorAccess } from "./platform-administrator-gate";

const administrator = { userId: "user-1", role: "platform_administrator" };
const contextUnreadable = new Error("Account context unavailable");

describe("Platform Administrator gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClient.mockResolvedValue({ rpc });
  });
  it("allows an authenticator-verified Platform Administrator", async () => {
    resolve.mockResolvedValue(administrator);
    rpc.mockResolvedValue({ data: true, error: null });
    await expect(resolvePlatformAdministratorAccess()).resolves.toBe("allowed");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("is_platform_administrator", {
      required_assurance: "aal2",
    });
  });
  it.each([
    [
      "a signed-out session",
      undefined,
      { data: null, error: { code: "42501" } },
    ],
    [
      "a Customer account",
      { userId: "user-1", role: "customer" },
      { data: true, error: null },
    ],
    [
      "a Cottage Owner account",
      { userId: "user-1", role: "cottage_owner" },
      { data: true, error: null },
    ],
    [
      "a Platform Administrator without authenticator verification",
      administrator,
      { data: false, error: null },
    ],
  ])("refuses %s", async (_session, context, authorization) => {
    resolve.mockResolvedValue(context);
    rpc.mockResolvedValue(authorization);
    await expect(resolvePlatformAdministratorAccess()).resolves.toBe("refused");
  });
  it.each([
    [
      "the database check errors",
      () => {
        resolve.mockResolvedValue(administrator);
        rpc.mockResolvedValue({ data: null, error: { code: "XX000" } });
      },
      "Platform Administrator check failed",
    ],
    [
      "the database check returns no decision",
      () => {
        resolve.mockResolvedValue(administrator);
        rpc.mockResolvedValue({ data: null, error: null });
      },
      "Platform Administrator check returned no decision",
    ],
    [
      "the account context cannot be read",
      () => {
        resolve.mockRejectedValue(contextUnreadable);
        rpc.mockResolvedValue({ data: true, error: null });
      },
      contextUnreadable,
    ],
  ])(
    "fails loudly and never answers when %s",
    async (_failure, arrange, rejection) => {
      arrange();
      await expect(resolvePlatformAdministratorAccess()).rejects.toThrow(
        rejection,
      );
    },
  );
});
