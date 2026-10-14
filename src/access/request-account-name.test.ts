import { beforeEach, describe, expect, it, vi } from "vitest";

const { assurance, createClient, eq, from, maybeSingle, select } = vi.hoisted(
  () => {
    const maybeSingle = vi.fn();
    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    return {
      assurance: vi.fn(),
      createClient: vi.fn(),
      eq,
      from: vi.fn(() => ({ select })),
      maybeSingle,
      select,
    };
  },
);
vi.mock("server-only", () => ({}));
vi.mock("./supabase-server", () => ({
  createRequestSupabaseClient: createClient,
}));
import { resolveRequestAccountName } from "./request-account-name";

const customer = { userId: "user-1", role: "customer" } as const;
const administrator = {
  userId: "user-2",
  role: "platform_administrator",
} as const;

describe("current request account first name", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClient.mockResolvedValue({
      auth: { mfa: { getAuthenticatorAssuranceLevel: assurance } },
      from,
    });
    assurance.mockResolvedValue({
      data: { currentLevel: "aal2" },
      error: null,
    });
    maybeSingle.mockResolvedValue({
      data: { first_name: " Zana " },
      error: null,
    });
  });

  it("reads only the signed-in account's own first name", async () => {
    await expect(resolveRequestAccountName(customer)).resolves.toEqual({
      status: "named",
      firstName: "Zana",
      initial: "Z",
    });
    expect(from).toHaveBeenCalledExactlyOnceWith("account_names");
    expect(select).toHaveBeenCalledExactlyOnceWith("first_name");
    expect(eq).toHaveBeenCalledExactlyOnceWith("user_id", "user-1");
  });

  it("asks nothing of a Platform Administrator before two-step sign-in", async () => {
    assurance.mockResolvedValue({
      data: { currentLevel: "aal1" },
      error: null,
    });
    await expect(
      resolveRequestAccountName({ ...administrator }),
    ).resolves.toEqual({ status: "not_asked" });
    expect(from).not.toHaveBeenCalled();

    assurance.mockResolvedValue({
      data: { currentLevel: "aal2" },
      error: null,
    });
    await expect(
      resolveRequestAccountName({ ...administrator }),
    ).resolves.toMatchObject({ status: "named" });
    expect(eq).toHaveBeenCalledExactlyOnceWith("user_id", "user-2");
  });

  it("returns missing for no row and for a stored name that breaks the rules", async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    await expect(resolveRequestAccountName({ ...customer })).resolves.toEqual({
      status: "missing",
    });

    maybeSingle.mockResolvedValueOnce({
      data: { first_name: "zana@example.com" },
      error: null,
    });
    await expect(resolveRequestAccountName({ ...customer })).resolves.toEqual({
      status: "missing",
    });
  });

  it("reports a failed or thrown read as unavailable", async () => {
    maybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: "permission denied" },
    });
    await expect(resolveRequestAccountName({ ...customer })).resolves.toEqual({
      status: "unavailable",
    });

    maybeSingle.mockRejectedValueOnce(new Error("Network unavailable"));
    await expect(resolveRequestAccountName({ ...customer })).resolves.toEqual({
      status: "unavailable",
    });

    assurance.mockResolvedValueOnce({
      data: null,
      error: { message: "auth outage" },
    });
    await expect(
      resolveRequestAccountName({ ...administrator }),
    ).resolves.toEqual({ status: "unavailable" });

    const signal = Object.assign(new Error("Request-time cookies"), {
      digest: "DYNAMIC_SERVER_USAGE",
    });
    createClient.mockRejectedValueOnce(signal);
    await expect(resolveRequestAccountName({ ...customer })).rejects.toBe(
      signal,
    );
  });
});
