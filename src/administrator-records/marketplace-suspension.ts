export type MarketplaceSuspensionTarget = {
  kind: "customer" | "owner" | "cottage";
  id: string;
};
export type MarketplaceSuspensionCommand = {
  target: MarketplaceSuspensionTarget;
  action: "suspend" | "reactivate";
  expectedRevision: number;
  reason: string;
  commandId: string;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function object(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid marketplace suspension object");
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => !keys.includes(key)))
    throw new Error("Unknown marketplace suspension field");
  return row;
}
function identifier(value: unknown): string {
  if (typeof value !== "string" || !uuid.test(value))
    throw new Error("Invalid marketplace suspension identifier");
  return value.toLowerCase();
}
function revision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("Invalid marketplace suspension revision or count");
  return value;
}
function reason(value: unknown): string {
  if (typeof value !== "string")
    throw new Error("Invalid marketplace suspension reason");
  const normalized = value.trim();
  if ([...normalized].length < 1 || [...normalized].length > 1000)
    throw new Error("Invalid marketplace suspension reason");
  return normalized;
}
export function parseMarketplaceSuspensionTarget(
  value: unknown,
): MarketplaceSuspensionTarget {
  const row = object(value, ["kind", "id"]);
  if (row.kind !== "customer" && row.kind !== "owner" && row.kind !== "cottage")
    throw new Error("Invalid marketplace suspension target");
  return { kind: row.kind, id: identifier(row.id) };
}
export function parseMarketplaceSuspensionCommand(
  value: unknown,
): MarketplaceSuspensionCommand {
  const row = object(value, [
    "target",
    "action",
    "expectedRevision",
    "reason",
    "commandId",
  ]);
  if (row.action !== "suspend" && row.action !== "reactivate")
    throw new Error("Invalid marketplace suspension action");
  return {
    target: parseMarketplaceSuspensionTarget(row.target),
    action: row.action,
    expectedRevision: revision(row.expectedRevision),
    reason: reason(row.reason),
    commandId: identifier(row.commandId),
  };
}

export type MarketplaceSuspensionCursor = { createdAt: string; id: string };
export type MarketplaceSuspensionState =
  | "active"
  | "suspended"
  | "draft"
  | "submitted"
  | "needs_information"
  | "under_review"
  | "approved"
  | "rejected"
  | "expired"
  | "published"
  | "paused"
  | "unpublished";
export type MarketplaceSuspensionReleaseSummary = {
  affected: number;
  resolved: number;
  processing: number;
  quarantined: number;
};
export type MarketplaceSuspensionAudit = MarketplaceSuspensionReleaseSummary & {
  id: string;
  commandId: string;
  actorUserId: string;
  action: "suspend" | "reactivate";
  expectedRevision: number;
  resultingRevision: number;
  fromState: MarketplaceSuspensionState;
  toState: MarketplaceSuspensionState;
  reason: string;
  createdAt: string;
};
export type MarketplaceSuspensionRestriction =
  | "verification-unavailable"
  | "owner-application-ineligible"
  | "abandoned-profile";
export type MarketplaceSuspensionRestorationRestriction =
  | "verification-unavailable"
  | "verification-expired"
  | "previously-paused"
  | "publication-or-owner-ineligible";
export type MarketplaceSuspensionReady = {
  status: "ready";
  targetKind: MarketplaceSuspensionTarget["kind"];
  targetId: string;
  state: MarketplaceSuspensionState;
  revision: number;
  applicationId: string | null;
  canSuspend: boolean;
  canReactivate: boolean;
  restrictionReason: MarketplaceSuspensionRestriction | null;
  restorationState: MarketplaceSuspensionState | null;
  restorationRestriction: MarketplaceSuspensionRestorationRestriction | null;
  releaseSummary: MarketplaceSuspensionReleaseSummary;
  actions: MarketplaceSuspensionAudit[];
  nextCursor: MarketplaceSuspensionCursor | null;
};
export type MarketplaceSuspensionReadResult =
  | MarketplaceSuspensionReady
  | {
      status: "access_required" | "invalid" | "not_found" | "unavailable";
    };

function timestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new Error("Invalid suspension timestamp");
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > new Date(Date.UTC(year, month, 0)).getUTCDate()
  )
    throw new Error("Invalid suspension date");
  return value;
}
export function parseMarketplaceSuspensionCursor(
  value: unknown,
): MarketplaceSuspensionCursor | null {
  if (value === null) return null;
  const row = object(value, ["createdAt", "id"]);
  return { createdAt: timestamp(row.createdAt), id: identifier(row.id) };
}
function releaseSummary(
  row: Record<string, unknown>,
): MarketplaceSuspensionReleaseSummary {
  const counts = {
    affected: revision(row.affected),
    resolved: revision(row.resolved),
    processing: revision(row.processing),
    quarantined: revision(row.quarantined),
  };
  if (
    counts.affected !==
    counts.resolved + counts.processing + counts.quarantined
  )
    throw new Error("Inconsistent suspension release counts");
  return counts;
}
const targetStates = {
  customer: ["active", "suspended"],
  owner: [
    "draft",
    "submitted",
    "needs_information",
    "under_review",
    "approved",
    "rejected",
    "expired",
    "suspended",
  ],
  cottage: ["published", "paused", "unpublished", "suspended"],
};
function state(
  value: unknown,
  kind: MarketplaceSuspensionTarget["kind"],
): MarketplaceSuspensionState {
  if (typeof value !== "string" || !targetStates[kind].includes(value))
    throw new Error("Invalid suspension state for target");
  return value as MarketplaceSuspensionState;
}
function audit(
  value: unknown,
  kind: MarketplaceSuspensionTarget["kind"],
): MarketplaceSuspensionAudit {
  const row = object(value, [
    "id",
    "commandId",
    "actorUserId",
    "action",
    "expectedRevision",
    "resultingRevision",
    "fromState",
    "toState",
    "reason",
    "createdAt",
    "affected",
    "resolved",
    "processing",
    "quarantined",
  ]);
  const fromState = state(row.fromState, kind);
  const toState = state(row.toState, kind);
  const expectedRevision = revision(row.expectedRevision);
  const resultingRevision = revision(row.resultingRevision);
  const trimmedReason = reason(row.reason);
  const unrestrictedStates =
    kind === "customer"
      ? ["active"]
      : kind === "owner"
        ? ["approved", "expired"]
        : ["published", "paused", "unpublished"];
  if (
    trimmedReason !== row.reason ||
    resultingRevision !== expectedRevision + 1 ||
    (row.action !== "suspend" && row.action !== "reactivate") ||
    (row.action === "suspend" &&
      (toState !== "suspended" || !unrestrictedStates.includes(fromState))) ||
    (row.action === "reactivate" &&
      (fromState !== "suspended" || !unrestrictedStates.includes(toState)))
  )
    throw new Error("Inconsistent suspension audit transition");
  return {
    id: identifier(row.id),
    commandId: identifier(row.commandId),
    actorUserId: identifier(row.actorUserId),
    action: row.action,
    expectedRevision,
    resultingRevision,
    fromState,
    toState,
    reason: trimmedReason,
    createdAt: timestamp(row.createdAt),
    ...releaseSummary(row),
  };
}
export function parseMarketplaceSuspensionReadResult(
  value: unknown,
  target: MarketplaceSuspensionTarget,
): MarketplaceSuspensionReadResult {
  const row = object(value, [
    "status",
    "targetKind",
    "targetId",
    "state",
    "revision",
    "applicationId",
    "canSuspend",
    "canReactivate",
    "restrictionReason",
    "restorationState",
    "restorationRestriction",
    "releaseSummary",
    "actions",
    "nextCursor",
  ]);
  if (row.status !== "ready") {
    object(value, ["status"]);
    switch (row.status) {
      case "access-required":
        return { status: "access_required" };
      case "not-found":
        return { status: "not_found" };
      case "invalid":
      case "unavailable":
        return { status: row.status };
      default:
        throw new Error("Unknown suspension read outcome");
    }
  }
  if (
    row.targetKind !== target.kind ||
    row.targetId !== target.id ||
    typeof row.canSuspend !== "boolean" ||
    typeof row.canReactivate !== "boolean" ||
    !Array.isArray(row.actions) ||
    row.actions.length > 50
  )
    throw new Error("Invalid suspension target or capabilities");
  const currentState = state(row.state, target.kind);
  const currentRevision = revision(row.revision);
  const applicationId =
    row.applicationId === null ? null : identifier(row.applicationId);
  if (
    (target.kind === "customer" && applicationId !== null) ||
    (target.kind === "owner" && applicationId === null)
  )
    throw new Error("Invalid suspension application binding");
  const restrictionReason = row.restrictionReason;
  const restorationRestriction = row.restorationRestriction;
  if (
    restrictionReason !== null &&
    restrictionReason !== "verification-unavailable" &&
    restrictionReason !== "owner-application-ineligible" &&
    restrictionReason !== "abandoned-profile"
  )
    throw new Error("Invalid suspension restriction");
  if (
    restorationRestriction !== null &&
    restorationRestriction !== "verification-unavailable" &&
    restorationRestriction !== "verification-expired" &&
    restorationRestriction !== "previously-paused" &&
    restorationRestriction !== "publication-or-owner-ineligible"
  )
    throw new Error("Invalid suspension restoration restriction");
  const restorationState =
    row.restorationState === null
      ? null
      : state(row.restorationState, target.kind);
  if (
    !(
      target.kind === "customer"
        ? ["active"]
        : target.kind === "owner"
          ? [null, "approved", "expired"]
          : ["published", "paused", "unpublished"]
    ).includes(restorationState)
  )
    throw new Error("Inconsistent suspension capability or restoration");
  if (target.kind === "customer") {
    if (
      restrictionReason !== null ||
      restorationRestriction !== null ||
      row.canSuspend !== (currentState === "active") ||
      row.canReactivate !== (currentState === "suspended")
    )
      throw new Error("Inconsistent customer suspension capabilities");
  } else if (target.kind === "owner") {
    const verificationUnavailable = restorationState === null;
    const eligible = currentState === "approved" || currentState === "expired";
    const expectedRestriction = eligible
      ? null
      : currentState === "suspended"
        ? verificationUnavailable
          ? "verification-unavailable"
          : null
        : "owner-application-ineligible";
    if (
      restorationRestriction !==
        (verificationUnavailable
          ? "verification-unavailable"
          : restorationState === "expired"
            ? "verification-expired"
            : null) ||
      restrictionReason !== expectedRestriction ||
      row.canSuspend !== eligible ||
      row.canReactivate !==
        (currentState === "suspended" && !verificationUnavailable)
    )
      throw new Error("Inconsistent owner suspension capabilities");
  } else {
    if (
      (restrictionReason !== null &&
        restrictionReason !== "abandoned-profile") ||
      row.canSuspend !==
        (restrictionReason === null && currentState !== "suspended") ||
      row.canReactivate !==
        (restrictionReason === null && currentState === "suspended") ||
      (restorationState === "paused"
        ? restorationRestriction !== "previously-paused" &&
          restorationRestriction !== "publication-or-owner-ineligible"
        : restorationRestriction !== null)
    )
      throw new Error("Inconsistent cottage suspension capabilities");
  }
  const actions = row.actions.map((value) => audit(value, target.kind));
  if (
    new Set(actions.map((item) => item.id)).size !== actions.length ||
    new Set(actions.map((item) => item.commandId)).size !== actions.length ||
    actions.some((item) => item.resultingRevision > currentRevision)
  )
    throw new Error("Inconsistent suspension audit page");
  return {
    status: "ready",
    targetKind: target.kind,
    targetId: target.id,
    state: currentState,
    revision: currentRevision,
    applicationId,
    canSuspend: row.canSuspend,
    canReactivate: row.canReactivate,
    restrictionReason,
    restorationState,
    restorationRestriction,
    releaseSummary: releaseSummary(
      object(row.releaseSummary, [
        "affected",
        "resolved",
        "processing",
        "quarantined",
      ]),
    ),
    actions,
    nextCursor: parseMarketplaceSuspensionCursor(row.nextCursor),
  };
}

export type MarketplaceSuspensionCommandResult =
  | {
      status: "completed";
      actionId: string;
      target: MarketplaceSuspensionReady;
    }
  | { status: "conflict"; reason?: "abandoned-profile" }
  | {
      status:
        | "access_required"
        | "not_found"
        | "invalid"
        | "unavailable"
        | "retry";
    };

export function parseMarketplaceSuspensionCommandResult(
  value: unknown,
  command: MarketplaceSuspensionCommand,
): MarketplaceSuspensionCommandResult {
  const row = object(value, ["status", "actionId", "target", "reason"]);
  if (row.status === "completed") {
    object(value, ["status", "actionId", "target"]);
    const actionId = identifier(row.actionId);
    const target = parseMarketplaceSuspensionReadResult(
      row.target,
      command.target,
    );
    if (target.status !== "ready")
      throw new Error("Completed suspension has no authoritative target");
    // A replay can return a current page newer than its immutable receipt.
    for (const action of target.actions) {
      if (
        (action.id === actionId || action.commandId === command.commandId) &&
        (action.id !== actionId ||
          action.commandId !== command.commandId ||
          action.action !== command.action ||
          action.expectedRevision !== command.expectedRevision ||
          action.reason !== command.reason.trim())
      )
        throw new Error("Suspension receipt contradicts command intent");
    }
    return { status: "completed", actionId, target };
  }
  if (row.status === "conflict") {
    object(value, ["status", "reason"]);
    if (row.reason !== undefined && row.reason !== "abandoned-profile")
      throw new Error("Unknown suspension conflict");
    return row.reason === undefined
      ? { status: "conflict" }
      : { status: "conflict", reason: row.reason };
  }
  object(value, ["status"]);
  switch (row.status) {
    case "access-required":
      return { status: "access_required" };
    case "not-found":
      return { status: "not_found" };
    case "invalid":
    case "unavailable":
    case "retry":
      return { status: row.status };
    default:
      throw new Error("Unknown suspension command outcome");
  }
}
