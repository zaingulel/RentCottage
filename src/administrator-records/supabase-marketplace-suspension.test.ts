import { beforeEach, expect, it, vi } from "vitest";

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/access/supabase-server", () => ({
  createRequestSupabaseClient: createClient,
}));
vi.mock("server-only", () => ({}));
import {
  loadMarketplaceSuspension,
  executeMarketplaceSuspension,
} from "./supabase-marketplace-suspension";

const id = "44000000-0000-4000-8000-000000000001";
const target = { kind: "customer" as const, id };
const ready = {
  status: "ready",
  targetKind: "customer",
  targetId: id,
  state: "active",
  revision: 0,
  applicationId: null,
  canSuspend: true,
  canReactivate: false,
  restrictionReason: null,
  restorationState: "active",
  restorationRestriction: null,
  releaseSummary: { affected: 0, resolved: 0, processing: 0, quarantined: 0 },
  actions: [],
  nextCursor: null,
};
const getUser = vi.fn();
const maybeSingle = vi.fn();
const rpc = vi.fn();
const select = vi.fn();
const eq = vi.fn();
const from = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id } }, error: null });
  maybeSingle.mockResolvedValue({
    data: {
      user_id: id,
      role: "platform_administrator",
      owner_approval_state: null,
    },
    error: null,
  });
  select.mockReturnValue({ eq });
  eq.mockReturnValue({ maybeSingle });
  from.mockReturnValue({ select });
  createClient.mockResolvedValue({ auth: { getUser }, from, rpc });
});

it("reauthenticates each read with current administrator identity and AAL2", async () => {
  rpc.mockImplementation(async (name) => ({
    data: name === "is_platform_administrator" ? true : ready,
    error: null,
  }));
  await expect(loadMarketplaceSuspension(target)).resolves.toEqual(ready);
  expect(rpc).toHaveBeenCalledWith("is_platform_administrator", {
    required_assurance: "aal2",
  });
  expect(rpc).toHaveBeenCalledWith("get_marketplace_suspension", {
    target_kind: "customer",
    target_id: id,
    before_created_at: null,
    before_id: null,
    page_size: 20,
  });
  maybeSingle.mockResolvedValueOnce({
    data: { user_id: id, role: "customer", owner_approval_state: null },
    error: null,
  });
  await expect(loadMarketplaceSuspension(target)).resolves.toEqual({
    status: "access_required",
  });
  rpc.mockResolvedValueOnce({ data: false, error: null });
  await expect(loadMarketplaceSuspension(target)).resolves.toEqual({
    status: "access_required",
  });
  expect(getUser).toHaveBeenCalledTimes(3);
  expect(
    rpc.mock.calls.filter(([name]) => name === "get_marketplace_suspension"),
  ).toHaveLength(1);
});

const command = {
  target,
  action: "suspend" as const,
  expectedRevision: 0,
  reason: "  Safety review  ",
  commandId: "44000000-0000-4000-8000-000000000002",
};
const completed = {
  status: "completed",
  actionId: "44000000-0000-4000-8000-000000000003",
  target: {
    ...ready,
    state: "suspended",
    revision: 1,
    canSuspend: false,
    canReactivate: true,
  },
};
it("reauthenticates each command and sends only validated bound intent", async () => {
  rpc.mockImplementation(async (name) => ({
    data: name === "is_platform_administrator" ? true : completed,
    error: null,
  }));
  await expect(executeMarketplaceSuspension(command)).resolves.toEqual(
    completed,
  );
  expect(rpc).toHaveBeenCalledWith("set_marketplace_suspension", {
    target_kind: "customer",
    target_id: id,
    target_action: "suspend",
    expected_revision: 0,
    target_reason: "Safety review",
    target_command_id: command.commandId,
  });
  getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
  await expect(executeMarketplaceSuspension(command)).resolves.toEqual({
    status: "access_required",
  });
  rpc.mockResolvedValueOnce({ data: false, error: null });
  await expect(executeMarketplaceSuspension(command)).resolves.toEqual({
    status: "access_required",
  });
  expect(getUser).toHaveBeenCalledTimes(3);
  expect(
    rpc.mock.calls.filter(([name]) => name === "set_marketplace_suspension"),
  ).toHaveLength(1);
  expect(
    rpc.mock.calls.filter(([name]) => name === "get_marketplace_suspension"),
  ).toHaveLength(0);
});

it("rejects invalid direct adapter input before any request", async () => {
  await expect(
    loadMarketplaceSuspension({ ...target, actor: id }),
  ).resolves.toEqual({ status: "invalid" });
  await expect(loadMarketplaceSuspension(target, { id })).resolves.toEqual({
    status: "invalid",
  });
  await expect(
    executeMarketplaceSuspension({ ...command, actorUserId: id }),
  ).resolves.toEqual({ status: "invalid" });
  await expect(
    executeMarketplaceSuspension({ ...command, expectedRevision: -1 }),
  ).resolves.toEqual({ status: "invalid" });
  expect(createClient).not.toHaveBeenCalled();
});

it("withholds malformed or unavailable reads instead of inventing active state or counts", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  for (const data of [
    null,
    { status: "ready" },
    { ...ready, targetId: command.commandId },
    {
      ...ready,
      releaseSummary: {
        affected: 0,
        completed: 0,
        processing: 0,
        quarantined: 0,
      },
    },
  ]) {
    rpc
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data, error: null });
    await expect(loadMarketplaceSuspension(target)).resolves.toEqual({
      status: "unavailable",
    });
  }
  rpc
    .mockResolvedValueOnce({ data: true, error: null })
    .mockResolvedValueOnce({ data: null, error: { code: "42501" } });
  await expect(loadMarketplaceSuspension(target)).resolves.toEqual({
    status: "access_required",
  });
  rpc
    .mockResolvedValueOnce({ data: true, error: null })
    .mockRejectedValueOnce(new Error("private supplier details"));
  await expect(loadMarketplaceSuspension(target)).resolves.toEqual({
    status: "unavailable",
  });
  expect(logged.mock.calls).toEqual(
    Array.from({ length: 5 }, () => [
      "Marketplace suspension request failed",
      { operation: "read", outcome: "unavailable" },
    ]),
  );
  logged.mockRestore();
});

it("preserves retry intent and distinguishes conflict from unknown command results", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  for (const status of ["retry", "conflict", "unavailable"] as const) {
    rpc
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: { status }, error: null });
    await expect(executeMarketplaceSuspension(command)).resolves.toEqual({
      status,
    });
  }
  rpc
    .mockResolvedValueOnce({ data: true, error: null })
    .mockResolvedValueOnce({
      data: {
        ...completed,
        target: { ...completed.target, targetId: command.commandId },
      },
      error: null,
    });
  await expect(executeMarketplaceSuspension(command)).resolves.toEqual({
    status: "unavailable",
  });
  rpc
    .mockResolvedValueOnce({ data: true, error: null })
    .mockResolvedValueOnce({ data: null, error: { code: "42501" } });
  await expect(executeMarketplaceSuspension(command)).resolves.toEqual({
    status: "access_required",
  });
  rpc
    .mockResolvedValueOnce({ data: true, error: null })
    .mockResolvedValueOnce({
      data: null,
      error: { code: "XX000", message: "private database details" },
    });
  await expect(executeMarketplaceSuspension(command)).resolves.toEqual({
    status: "unavailable",
  });
  expect(command.commandId).toBe("44000000-0000-4000-8000-000000000002");
  expect(command.reason).toBe("  Safety review  ");
  const sent = rpc.mock.calls.filter(
    ([name]) => name === "set_marketplace_suspension",
  );
  expect(sent).toHaveLength(6);
  for (const [, input] of sent)
    expect(input).toEqual({
      target_kind: "customer",
      target_id: id,
      target_action: "suspend",
      expected_revision: 0,
      target_reason: "Safety review",
      target_command_id: command.commandId,
    });
  expect(logged.mock.calls).toEqual(
    Array.from({ length: 2 }, () => [
      "Marketplace suspension request failed",
      { operation: "command", outcome: "unavailable" },
    ]),
  );
  logged.mockRestore();
});

it("treats failed identity or assurance checks as unavailable without touching target data", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000" } });
  await expect(loadMarketplaceSuspension(target)).resolves.toEqual({
    status: "unavailable",
  });
  getUser.mockRejectedValueOnce(new Error("private identity error"));
  rpc.mockResolvedValueOnce({ data: true, error: null });
  await expect(executeMarketplaceSuspension(command)).resolves.toEqual({
    status: "unavailable",
  });
  rpc.mockResolvedValueOnce({ data: "allowed", error: null });
  await expect(executeMarketplaceSuspension(command)).resolves.toEqual({
    status: "unavailable",
  });
  expect(rpc.mock.calls.map(([name]) => name)).toEqual([
    "is_platform_administrator",
    "is_platform_administrator",
    "is_platform_administrator",
  ]);
  expect(logged.mock.calls).toEqual([
    [
      "Marketplace suspension request failed",
      { operation: "read", outcome: "unavailable" },
    ],
    [
      "Marketplace suspension request failed",
      { operation: "command", outcome: "unavailable" },
    ],
    [
      "Marketplace suspension request failed",
      { operation: "command", outcome: "unavailable" },
    ],
  ]);
  logged.mockRestore();
});
