import { describe, expect, it } from "vitest";

import {
  parseMarketplaceSuspensionCommand,
  parseMarketplaceSuspensionCursor,
  parseMarketplaceSuspensionReadResult,
  parseMarketplaceSuspensionCommandResult,
} from "./marketplace-suspension";

const target = {
  kind: "customer" as const,
  id: "44000000-0000-4000-8000-000000000001",
};
const command = {
  target,
  action: "suspend" as const,
  expectedRevision: 3,
  reason: "  Safety review  ",
  commandId: "44000000-0000-4000-8000-000000000002",
};

describe("marketplace suspension contract", () => {
  it("accepts only a bounded suspension intent without a client actor", () => {
    expect(parseMarketplaceSuspensionCommand(command)).toEqual({
      ...command,
      reason: "Safety review",
    });
    for (const invalid of [
      null,
      [],
      { ...command, actorUserId: target.id },
      { ...command, target: { ...target, actor: target.id } },
      { ...command, target: { ...target, kind: "administrator" } },
      { ...command, target: { ...target, id: "../account" } },
      { ...command, action: "delete" },
      { ...command, commandId: "not-a-uuid" },
      ...[-1, 1.5, Number.MAX_SAFE_INTEGER + 1, "3"].map(
        (expectedRevision) => ({ ...command, expectedRevision }),
      ),
      ...[" ", "a".repeat(1001), null].map((reason) => ({
        ...command,
        reason,
      })),
    ])
      expect(() => parseMarketplaceSuspensionCommand(invalid)).toThrow();
  });
});

const action = {
  id: "44000000-0000-4000-8000-000000000003",
  commandId: command.commandId,
  actorUserId: "44000000-0000-4000-8000-000000000004",
  action: "suspend",
  expectedRevision: 3,
  resultingRevision: 4,
  fromState: "active",
  toState: "suspended",
  reason: "Safety review",
  createdAt: "2026-10-20T02:00:00.123456+00:00",
  affected: 6,
  resolved: 1,
  processing: 3,
  quarantined: 2,
};
const ready = {
  status: "ready",
  targetKind: "customer",
  targetId: target.id,
  state: "suspended",
  revision: 4,
  applicationId: null,
  canSuspend: false,
  canReactivate: true,
  restrictionReason: null,
  restorationState: "active",
  restorationRestriction: null,
  releaseSummary: { affected: 6, resolved: 1, processing: 3, quarantined: 2 },
  actions: [action],
  nextCursor: null,
};

it("decodes only the bound authoritative read with honest release arithmetic", () => {
  expect(parseMarketplaceSuspensionReadResult(ready, target)).toEqual(ready);
  for (const invalid of [
    null,
    {},
    { status: "active" },
    { status: "not-found", state: "active" },
    { ...ready, extra: true },
    { ...ready, targetId: action.id },
    { ...ready, targetKind: "owner" },
    { ...ready, state: "approved" },
    { ...ready, revision: -1 },
    { ...ready, applicationId: action.id },
    { ...ready, canSuspend: true },
    { ...ready, canReactivate: "yes" },
    { ...ready, restrictionReason: "unknown" },
    { ...ready, restorationState: "published" },
    { ...ready, restorationRestriction: "unknown" },
    {
      ...ready,
      releaseSummary: {
        affected: 6,
        completed: 1,
        processing: 3,
        quarantined: 2,
      },
    },
    { ...ready, releaseSummary: { ...ready.releaseSummary, affected: 7 } },
    { ...ready, releaseSummary: { ...ready.releaseSummary, resolved: -1 } },
    ...[
      { ...action, affected: 8 },
      { ...action, actorUserId: "forged" },
      { ...action, resultingRevision: 5 },
      { ...action, fromState: "suspended" },
      { ...action, toState: "active" },
      { ...action, createdAt: "2026-02-30T02:00:00Z" },
      { ...action, reason: "  untrimmed " },
      { ...action, unexpected: true },
    ].map((row) => ({ ...ready, actions: [row] })),
    { ...ready, actions: [action, action] },
    { ...ready, nextCursor: { createdAt: action.createdAt } },
  ])
    expect(() =>
      parseMarketplaceSuspensionReadResult(invalid, target),
    ).toThrow();
  expect(
    parseMarketplaceSuspensionReadResult({ status: "not-found" }, target),
  ).toEqual({ status: "not_found" });
  const cursor = { createdAt: action.createdAt, id: action.id };
  expect(parseMarketplaceSuspensionCursor(cursor)).toEqual(cursor);
  for (const invalid of [
    undefined,
    { id: action.id },
    { ...cursor, createdAt: "yesterday" },
    { ...cursor, id: "../" },
    { ...cursor, url: "/evil" },
  ])
    expect(() => parseMarketplaceSuspensionCursor(invalid)).toThrow();
});

it("binds completed receipts to explicit intent without rejecting an older replay", () => {
  const completed = { status: "completed", actionId: action.id, target: ready };
  expect(
    parseMarketplaceSuspensionCommandResult(completed, {
      ...command,
      reason: "Safety review",
    }),
  ).toEqual(completed);
  const newerActions = Array.from({ length: 20 }, (_, index) => ({
    ...action,
    id: `44000000-0000-4000-8000-${String(125 - index).padStart(12, "0")}`,
    commandId: `44000000-0000-4000-8000-${String(225 - index).padStart(12, "0")}`,
    action: index % 2 === 0 ? "reactivate" : "suspend",
    fromState: index % 2 === 0 ? "suspended" : "active",
    toState: index % 2 === 0 ? "active" : "suspended",
    expectedRevision: 24 - index,
    resultingRevision: 25 - index,
    affected: 0,
    resolved: 0,
    processing: 0,
    quarantined: 0,
  }));
  const replay = {
    ...completed,
    target: {
      ...ready,
      state: "active",
      revision: 25,
      canSuspend: true,
      canReactivate: false,
      actions: newerActions,
      nextCursor: { createdAt: action.createdAt, id: newerActions[19].id },
    },
  };
  expect(
    parseMarketplaceSuspensionCommandResult(replay, {
      ...command,
      reason: "Safety review",
    }),
  ).toEqual(replay);
  for (const invalid of [
    { ...completed, actionId: "unknown" },
    { ...completed, extra: true },
    { ...completed, target: { ...ready, targetId: action.id } },
    { ...completed, target: { status: "unavailable" } },
    ...[
      { ...action, commandId: action.id },
      { ...action, id: command.commandId },
      { ...action, expectedRevision: 2, resultingRevision: 3 },
      { ...action, reason: "Other reason" },
      {
        ...action,
        action: "reactivate",
        fromState: "suspended",
        toState: "active",
      },
    ].map((row) => ({ ...completed, target: { ...ready, actions: [row] } })),
    { status: "completed" },
    { status: "success" },
    { status: "retry", actionId: action.id },
    { status: "conflict", reason: "arbitrary" },
  ])
    expect(() =>
      parseMarketplaceSuspensionCommandResult(invalid, {
        ...command,
        reason: "Safety review",
      }),
    ).toThrow();
  for (const status of ["invalid", "unavailable", "retry", "conflict"])
    expect(
      parseMarketplaceSuspensionCommandResult({ status }, command),
    ).toEqual({ status });
  expect(
    parseMarketplaceSuspensionCommandResult(
      { status: "access-required" },
      command,
    ),
  ).toEqual({ status: "access_required" });
  expect(
    parseMarketplaceSuspensionCommandResult({ status: "not-found" }, command),
  ).toEqual({ status: "not_found" });
  expect(
    parseMarketplaceSuspensionCommandResult(
      { status: "conflict", reason: "abandoned-profile" },
      command,
    ),
  ).toEqual({ status: "conflict", reason: "abandoned-profile" });
});

it("keeps capability and restoration facts compatible with each SQL target", () => {
  const owner = { kind: "owner" as const, id: target.id };
  const cottage = { kind: "cottage" as const, id: target.id };
  const ownerReady = {
    ...ready,
    targetKind: "owner",
    applicationId: action.id,
    restorationState: "expired",
    restorationRestriction: "verification-expired",
    actions: [],
  };
  const paused = {
    ...ready,
    targetKind: "cottage",
    applicationId: action.id,
    restorationState: "paused",
    restorationRestriction: "previously-paused",
    actions: [],
  };
  expect(parseMarketplaceSuspensionReadResult(ownerReady, owner)).toEqual(
    ownerReady,
  );
  expect(parseMarketplaceSuspensionReadResult(paused, cottage)).toEqual(paused);
  const unavailableVerification = {
    ...ownerReady,
    canReactivate: false,
    restrictionReason: "verification-unavailable",
    restorationState: null,
    restorationRestriction: "verification-unavailable",
  };
  expect(
    parseMarketplaceSuspensionReadResult(unavailableVerification, owner),
  ).toEqual(unavailableVerification);
  const prospective = {
    ...ownerReady,
    state: "under_review",
    canReactivate: false,
    restrictionReason: "owner-application-ineligible",
  };
  expect(parseMarketplaceSuspensionReadResult(prospective, owner)).toEqual(
    prospective,
  );
  for (const [payload, bound] of [
    [{ ...ready, restorationRestriction: "verification-expired" }, target],
    [
      {
        ...ready,
        canReactivate: false,
        restrictionReason: "abandoned-profile",
      },
      target,
    ],
    [{ ...ownerReady, restorationRestriction: null }, owner],
    [
      {
        ...ownerReady,
        canReactivate: false,
        restrictionReason: "abandoned-profile",
      },
      owner,
    ],
    [{ ...paused, restorationState: "published" }, cottage],
    [
      {
        ...paused,
        canReactivate: false,
        restrictionReason: "owner-application-ineligible",
      },
      cottage,
    ],
  ] as const)
    expect(() =>
      parseMarketplaceSuspensionReadResult(payload, bound),
    ).toThrow();
});

it("normalizes UUID spelling before binding the database target and receipt", () => {
  const parsed = parseMarketplaceSuspensionCommand({
    ...command,
    target: { kind: "owner", id: "44000000-AAAA-4000-8000-000000000001" },
    commandId: "44000000-BBBB-4000-8000-000000000002",
  });
  expect(parsed.target.id).toBe("44000000-aaaa-4000-8000-000000000001");
  expect(parsed.commandId).toBe("44000000-bbbb-4000-8000-000000000002");
});
