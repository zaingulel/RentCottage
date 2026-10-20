import { beforeEach, expect, it, vi } from "vitest";

const { createClient, revalidatePath } = vi.hoisted(() => ({
  createClient: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("@/access/supabase-server", () => ({
  createRequestSupabaseClient: createClient,
}));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("server-only", () => ({}));
import {
  readMarketplaceSuspension,
  setMarketplaceSuspension,
} from "./marketplace-suspension-actions";

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
const rpc = vi.fn();
const getUser = vi.fn();
const maybeSingle = vi.fn();
const eq = vi.fn();
const select = vi.fn();
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
  eq.mockReturnValue({ maybeSingle });
  select.mockReturnValue({ eq });
  from.mockReturnValue({ select });
  createClient.mockResolvedValue({ auth: { getUser }, from, rpc });
});
it("validates read input and cursor before fresh authority on each refresh", async () => {
  const cursor = { createdAt: "2026-10-20T02:00:00.123456+00:00", id };
  rpc.mockImplementation(async (name) => ({
    data: name === "is_platform_administrator" ? true : ready,
    error: null,
  }));
  for (const invalid of [
    null,
    [],
    { locale: "fr", target },
    { locale: "en", target, actorUserId: id },
    { locale: "en", target, cursor: { id } },
    { locale: "en", target: { ...target, id: "/evil" } },
    { locale: "en", target, cursor: { ...cursor, createdAt: "never" } },
    { locale: "en", target, returnTo: "https://evil.test" },
  ])
    await expect(readMarketplaceSuspension(invalid)).resolves.toEqual({
      status: "invalid",
    });
  expect(createClient).not.toHaveBeenCalled();
  await expect(
    readMarketplaceSuspension({ locale: "ar", target, cursor }),
  ).resolves.toEqual(ready);
  expect(rpc).toHaveBeenCalledWith("get_marketplace_suspension", {
    target_kind: "customer",
    target_id: id,
    before_created_at: cursor.createdAt,
    before_id: id,
    page_size: 20,
  });
  rpc.mockResolvedValueOnce({ data: false, error: null });
  await expect(
    readMarketplaceSuspension({ locale: "ar", target }),
  ).resolves.toEqual({ status: "access_required" });
  expect(getUser).toHaveBeenCalledTimes(2);
  expect(revalidatePath).not.toHaveBeenCalled();
});

const command = {
  locale: "en",
  target,
  action: "suspend",
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
it("validates command input and revalidates only authoritative completed targets", async () => {
  for (const invalid of [
    null,
    [],
    { ...command, locale: "../" },
    { ...command, actorUserId: id },
    { ...command, returnTo: "/evil" },
    { ...command, applicationId: id },
    { ...command, target: { ...target, id: "https://evil.test" } },
    { ...command, expectedRevision: "0" },
    { ...command, action: "erase" },
    { ...command, reason: " " },
    { ...command, commandId: "not-a-uuid" },
  ])
    await expect(setMarketplaceSuspension(invalid)).resolves.toEqual({
      status: "invalid",
    });
  expect(createClient).not.toHaveBeenCalled();
  rpc.mockImplementation(async (name) => ({
    data: name === "is_platform_administrator" ? true : completed,
    error: null,
  }));
  await expect(setMarketplaceSuspension(command)).resolves.toEqual(completed);
  expect(rpc).toHaveBeenCalledWith("set_marketplace_suspension", {
    target_kind: "customer",
    target_id: id,
    target_action: "suspend",
    expected_revision: 0,
    target_reason: "Safety review",
    target_command_id: command.commandId,
  });
  expect(revalidatePath.mock.calls).toEqual([
    ["/en/administrator/records"],
    [`/en/administrator/records/account/${id}`],
  ]);
  rpc.mockResolvedValueOnce({ data: false, error: null });
  await expect(setMarketplaceSuspension(command)).resolves.toEqual({
    status: "access_required",
  });
  expect(getUser).toHaveBeenCalledTimes(2);
  expect(revalidatePath).toHaveBeenCalledTimes(2);
});

it("revalidates owner and cottage pages with returned application identity in launch locales", async () => {
  const applicationId = "44000000-0000-4000-8000-000000000005";
  for (const [kind, locale] of [
    ["owner", "ar"],
    ["cottage", "ckb"],
  ] as const) {
    revalidatePath.mockClear();
    const reply = {
      ...completed,
      target: {
        ...completed.target,
        targetKind: kind,
        applicationId,
        restorationState: kind === "owner" ? "approved" : "unpublished",
        restorationRestriction: null,
      },
    };
    rpc.mockImplementation(async (name) => ({
      data: name === "is_platform_administrator" ? true : reply,
      error: null,
    }));
    await expect(
      setMarketplaceSuspension({ ...command, locale, target: { kind, id } }),
    ).resolves.toEqual(reply);
    expect(revalidatePath.mock.calls).toEqual([
      [`/${locale}/administrator/records`],
      [
        kind === "owner"
          ? `/${locale}/administrator/records/account/${id}`
          : `/${locale}/administrator/cottages/${id}`,
      ],
      [`/${locale}/administrator/owner-applications/${applicationId}`],
      [`/${locale}/administrator/owner-applications`],
      [`/${locale}/owner/application`],
    ]);
  }
});

it("keeps uncertain commands and failed reads unavailable without refreshing invented targets", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  for (const status of [
    "conflict",
    "retry",
    "invalid",
    "not-found",
    "unavailable",
  ] as const) {
    rpc
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: { status }, error: null });
    await expect(setMarketplaceSuspension(command)).resolves.toEqual({
      status: status === "not-found" ? "not_found" : status,
    });
  }
  rpc
    .mockResolvedValueOnce({ data: true, error: null })
    .mockResolvedValueOnce({
      data: {
        ...completed,
        target: { ...completed.target, applicationId: "/evil" },
      },
      error: null,
    });
  await expect(setMarketplaceSuspension(command)).resolves.toEqual({
    status: "unavailable",
  });
  rpc
    .mockResolvedValueOnce({ data: true, error: null })
    .mockResolvedValueOnce({ data: null, error: null });
  await expect(
    readMarketplaceSuspension({ locale: "en", target }),
  ).resolves.toEqual({ status: "unavailable" });
  expect(revalidatePath).not.toHaveBeenCalled();
  expect(command.commandId).toBe("44000000-0000-4000-8000-000000000002");
  expect(command.reason).toBe("  Safety review  ");
  logged.mockRestore();
});
