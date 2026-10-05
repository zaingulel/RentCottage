import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClient, resolve } = vi.hoisted(() => ({
  createClient: vi.fn(),
  resolve: vi.fn(),
}));
vi.mock("@/access/supabase-server", () => ({
  createRequestSupabaseClient: createClient,
}));
vi.mock("@/access/supabase-account-access", () => ({
  SupabaseAccountContextStore: class {
    resolve = resolve;
  },
}));
vi.mock("server-only", () => ({}));
import {
  loadAdministratorRecord,
  searchAdministratorRecords,
} from "./supabase-administrator-records";

const id = "25000000-0000-4000-8000-000000000001";

describe("administrator records request session", () => {
  const rpc = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    createClient.mockResolvedValue({ rpc });
    resolve.mockResolvedValue({ role: "platform_administrator" });
  });

  it("rechecks AAL2 using the request client and passes fixed RPC arguments", async () => {
    rpc
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({
        data: {
          rows: [],
          total: 0,
          pendingApplications: 2,
          pendingApprovals: 1,
          nextCursor: null,
        },
        error: null,
      });
    await expect(
      searchAdministratorRecords({ kind: "applications", status: "pending" }),
    ).resolves.toMatchObject({
      status: "ready",
      page: { total: 0, pendingApplications: 2 },
    });
    expect(rpc).toHaveBeenNthCalledWith(1, "is_platform_administrator", {
      required_assurance: "aal2",
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "search_administrator_records", {
      target_kind: "applications",
      target_query: "",
      target_status: "pending",
      target_from: null,
      target_through: null,
      target_owner_id: null,
      after_at: null,
      after_id: null,
    });
  });

  it("denies stale or revoked AAL2 sessions before reading", async () => {
    rpc.mockResolvedValueOnce({ data: false, error: null });
    await expect(
      searchAdministratorRecords({ kind: "customers" }),
    ).resolves.toEqual({ status: "access_required" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("distinguishes denied, absent and unavailable detail", async () => {
    rpc
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    await expect(loadAdministratorRecord("account", id)).resolves.toEqual({
      status: "access_required",
    });
    rpc
      .mockReset()
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    await expect(loadAdministratorRecord("account", id)).resolves.toEqual({
      status: "not_found",
    });
    rpc
      .mockReset()
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "PGRST500" } });
    await expect(loadAdministratorRecord("account", id)).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("never turns provider or malformed results into an empty page", async () => {
    rpc
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "PGRST500" } });
    await expect(
      searchAdministratorRecords({ kind: "customers" }),
    ).resolves.toEqual({ status: "unavailable" });
    rpc
      .mockReset()
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({
        data: {
          rows: [],
          total: -1,
          pendingApplications: 0,
          pendingApprovals: 0,
          nextCursor: null,
        },
        error: null,
      });
    await expect(
      searchAdministratorRecords({ kind: "customers" }),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("refuses search and detail to a signed-out session the database still accepts", async () => {
    resolve.mockResolvedValue(undefined);
    rpc.mockResolvedValueOnce({ data: true, error: null });
    await expect(
      searchAdministratorRecords({ kind: "customers" }),
    ).resolves.toEqual({ status: "access_required" });
    rpc.mockResolvedValueOnce({ data: true, error: null });
    await expect(loadAdministratorRecord("account", id)).resolves.toEqual({
      status: "access_required",
    });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "is_platform_administrator",
      "is_platform_administrator",
    ]);
  });

  it("reports a failed Platform Administrator check as unavailable without reading", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST500" } });
    await expect(
      searchAdministratorRecords({ kind: "customers" }),
    ).resolves.toEqual({ status: "unavailable" });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST500" } });
    await expect(loadAdministratorRecord("account", id)).resolves.toEqual({
      status: "unavailable",
    });
    expect(logged.mock.calls.map(([, detail]) => detail.operation)).toEqual([
      "search_authorization",
      "detail_authorization",
    ]);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "is_platform_administrator",
      "is_platform_administrator",
    ]);
    logged.mockRestore();
  });
});
