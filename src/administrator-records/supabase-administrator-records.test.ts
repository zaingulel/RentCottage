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
  loadAdministratorQueue,
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

  describe("booking queue", () => {
    const rowId = "25000000-0000-4000-8000-000000000002";
    const microsecondAt = "2026-09-01T10:00:00.123456+00:00";
    const requestStates = [
      "pending",
      "processing",
      "payment-required",
      "capture-processing",
      "declined",
      "withdrawn",
      "expired",
      "cancelled",
    ];
    const queueReply = (overrides: Record<string, unknown> = {}) => ({
      queue: "requests",
      rows: [
        {
          id: rowId,
          at: microsecondAt,
          reference: "RC-REQ-0123456789ABCDEF",
          state: "pending",
          source: null,
          category: null,
        },
      ],
      total: 1,
      stateCounts: Object.fromEntries(
        requestStates.map((s) => [s, s === "pending" ? 1 : 0]),
      ),
      nextCursor: null,
      ...overrides,
    });

    it("rechecks AAL2, then passes the six fixed arguments with the cursor unchanged", async () => {
      rpc
        .mockResolvedValueOnce({ data: true, error: null })
        .mockResolvedValueOnce({ data: queueReply(), error: null });
      await expect(
        loadAdministratorQueue({
          queue: "requests",
          state: "pending",
          from: "2026-09-01",
          through: "2026-09-30",
          afterAt: microsecondAt,
          afterId: rowId,
        }),
      ).resolves.toMatchObject({
        status: "ready",
        page: { queue: "requests", total: 1 },
      });
      expect(rpc).toHaveBeenNthCalledWith(1, "is_platform_administrator", {
        required_assurance: "aal2",
      });
      expect(rpc).toHaveBeenNthCalledWith(
        2,
        "search_administrator_booking_queue",
        {
          target_queue: "requests",
          target_state: "pending",
          target_from: "2026-09-01",
          target_through: "2026-09-30",
          after_at: microsecondAt,
          after_id: rowId,
        },
      );
    });

    it("sends the requests defaults for an empty query", async () => {
      rpc
        .mockResolvedValueOnce({ data: true, error: null })
        .mockResolvedValueOnce({ data: queueReply(), error: null });
      await loadAdministratorQueue({});
      expect(rpc).toHaveBeenNthCalledWith(
        2,
        "search_administrator_booking_queue",
        {
          target_queue: "requests",
          target_state: null,
          target_from: null,
          target_through: null,
          after_at: null,
          after_id: null,
        },
      );
    });

    it("makes no queue call for refused access, even with invalid input", async () => {
      resolve.mockResolvedValue(undefined);
      rpc.mockResolvedValueOnce({ data: true, error: null });
      await expect(
        loadAdministratorQueue({ from: "2026-09-02", through: "2026-09-01" }),
      ).resolves.toEqual({ status: "access_required" });
      resolve.mockResolvedValue({ role: "platform_administrator" });
      rpc.mockResolvedValueOnce({ data: false, error: null });
      await expect(
        loadAdministratorQueue({ queue: "refunds" }),
      ).resolves.toEqual({ status: "access_required" });
      expect(rpc.mock.calls.map(([name]) => name)).toEqual([
        "is_platform_administrator",
        "is_platform_administrator",
      ]);
    });

    it("gives invalid for a reversed date range after the gate passes", async () => {
      rpc.mockResolvedValueOnce({ data: true, error: null });
      await expect(
        loadAdministratorQueue({ from: "2026-09-02", through: "2026-09-01" }),
      ).resolves.toEqual({ status: "invalid" });
      expect(rpc.mock.calls.map(([name]) => name)).toEqual([
        "is_platform_administrator",
      ]);
    });

    it("maps 42501 to access_required, and another error or a corrupt reply to unavailable", async () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      rpc
        .mockResolvedValueOnce({ data: true, error: null })
        .mockResolvedValueOnce({ data: null, error: { code: "42501" } });
      await expect(loadAdministratorQueue({})).resolves.toEqual({
        status: "access_required",
      });
      rpc
        .mockResolvedValueOnce({ data: true, error: null })
        .mockResolvedValueOnce({ data: null, error: { code: "PGRST500" } });
      await expect(loadAdministratorQueue({})).resolves.toEqual({
        status: "unavailable",
      });
      rpc
        .mockResolvedValueOnce({ data: true, error: null })
        .mockResolvedValueOnce({
          data: queueReply({ queue: "refunds" }),
          error: null,
        });
      await expect(loadAdministratorQueue({})).resolves.toEqual({
        status: "unavailable",
      });
      expect(logged.mock.calls.map(([, detail]) => detail.operation)).toEqual([
        "queue_read",
        "queue_read",
      ]);
      logged.mockRestore();
    });

    it("reports a failed Platform Administrator check as unavailable without reading", async () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST500" } });
      await expect(loadAdministratorQueue({})).resolves.toEqual({
        status: "unavailable",
      });
      expect(logged.mock.calls.map(([, detail]) => detail.operation)).toEqual([
        "queue_authorization",
      ]);
      expect(rpc).toHaveBeenCalledTimes(1);
      logged.mockRestore();
    });
  });
});
