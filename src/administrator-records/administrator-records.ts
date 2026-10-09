export const searchKinds = [
  "customers",
  "owners",
  "cottages",
  "applications",
  "approvals",
] as const;
export type AdministratorSearchKind = (typeof searchKinds)[number];
export type AdministratorDetailKind = "account" | "approval";
export const statuses = {
  customers: ["customer", "cottage_owner"],
  owners: ["prospective", "approved", "suspended", "expired"],
  cottages: ["draft", "submitted_for_content_approval", "abandoned"],
  applications: [
    "submitted",
    "under_review",
    "needs_information",
    "approved",
    "rejected",
    "expired",
    "suspended",
  ],
  approvals: ["in_review", "approved", "rejected"],
} as const;
export type AdministratorSearchInput = {
  kind: AdministratorSearchKind;
  query: string;
  status: string | null;
  from: string | null;
  through: string | null;
  ownerId: string | null;
  afterAt: string | null;
  afterId: string | null;
};
export type AdministratorRecordRow = {
  kind: AdministratorSearchKind;
  id: string;
  ownerId: string;
  profileId?: string;
  applicationId?: string;
  label: string;
  status: string;
  at: string;
  cycleNumber?: number;
  maskedPhone?: string;
};
export type AdministratorSearchPage = {
  rows: AdministratorRecordRow[];
  total: number;
  pendingApplications: number;
  pendingApprovals: number;
  nextCursor: { at: string; id: string } | null;
};
export const administratorQueues = [
  "requests",
  "bookings",
  "refunds",
  "incidents",
] as const;
export type AdministratorQueue = (typeof administratorQueues)[number];
export const administratorQueueStates = {
  requests: [
    "pending",
    "processing",
    "payment-required",
    "capture-processing",
    "declined",
    "withdrawn",
    "expired",
    "cancelled",
  ],
  bookings: [
    "confirmed",
    "incident_pending",
    "completed",
    "no_show",
    "cancelled",
  ],
  refunds: ["requested", "processing", "succeeded", "failed", "unknown"],
  incidents: ["incident_pending", "completed", "no_show", "cancelled"],
} as const;
export type AdministratorQueueSearch = {
  queue: AdministratorQueue;
  state: string | null;
  from: string | null;
  through: string | null;
  afterAt: string | null;
  afterId: string | null;
};
export type AdministratorQueueRow = {
  id: string;
  at: string;
  reference: string;
  state: string;
  source: string | null;
  category: string | null;
};
export type AdministratorQueuePage = {
  queue: AdministratorQueue;
  rows: AdministratorQueueRow[];
  total: number;
  stateCounts: Record<string, number>;
  nextCursor: { at: string; id: string } | null;
};
type Decision = {
  approved: boolean;
  reason: string;
  administratorId: string;
  decidedAt: string;
};
export type AdministratorRecordDetail =
  | {
      kind: "account";
      id: string;
      marketplaceRole: "customer" | "cottage_owner";
      customerCapability: true;
      ownerApprovalState?: string;
      createdAt: string;
      applicationId?: string;
      maskedPhone?: string;
    }
  | {
      kind: "approval";
      id: string;
      profileId: string;
      ownerId: string;
      name: string;
      approximateLocation: string;
      state: string;
      cycleNumber: number;
      createdAt: string;
      decidedAt: string | null;
      publicationDecision: Decision | null;
      localizedDecisions: (Decision & {
        decisionId: string;
        locale: "ar" | "ckb" | "en";
        revisionId: string;
      })[];
    };

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid record shape");
  return value as Record<string, unknown>;
}
function oneOf<T extends string>(value: unknown, options: readonly T[]): T {
  if (typeof value !== "string" || !options.includes(value as T))
    throw new Error("Invalid record value");
  return value as T;
}
function text(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error("Invalid record text");
  return value;
}
function uuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new Error("Invalid record ID");
  return value;
}
function optionalUuid(value: unknown): string | undefined {
  return value === undefined ? undefined : uuid(value);
}
function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("Invalid count");
  return value;
}
function date(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error("Invalid date");
  const [year, month, day] = value.split("-").map(Number);
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > new Date(Date.UTC(year, month, 0)).getUTCDate()
  )
    throw new Error("Invalid date");
  return value;
}
function timestamp(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid timestamp");
  const parts =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (
    !parts ||
    Number(parts[2]) > 23 ||
    Number(parts[3]) > 59 ||
    Number(parts[4]) > 59 ||
    !Number.isFinite(Date.parse(value))
  )
    throw new Error("Invalid timestamp");
  date(parts[1]);
  return value;
}
function phone(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^•••\d{4}$/.test(value))
    throw new Error("Invalid masked phone");
  return value;
}

function exactKeys(raw: Record<string, unknown>, keys: readonly string[]) {
  const present = Object.keys(raw);
  if (present.length !== keys.length || !keys.every((k) => present.includes(k)))
    throw new Error("Invalid record keys");
}
function nothing(value: unknown): null {
  if (value !== null) throw new Error("Invalid record value");
  return null;
}
function filterText(value: unknown): string | null {
  if (value === undefined || value === "") return null;
  if (typeof value !== "string") throw new Error("Invalid filter");
  return value;
}

const queueSearchKeys = [
  "queue",
  "state",
  "from",
  "through",
  "afterAt",
  "afterId",
] as const;
const queueReference = /^RC-REQ-[A-F0-9]{16}$/;
const refundSources = ["cancellation", "administrator", "dispute"] as const;
const incidentCategories = {
  lifecycle: ["safety", "property_damage", "conduct", "other"],
  cancellation: ["safety", "fraud", "legal", "serious_operational"],
} as const;

export class UnsupportedAdministratorQueryError extends Error {}

export function parseAdministratorRecordSearch(
  value: unknown,
): AdministratorSearchInput {
  const raw = object(value),
    kind = oneOf(raw.kind, searchKinds);
  const query =
    raw.query === undefined || raw.query === null
      ? ""
      : typeof raw.query === "string"
        ? raw.query.trim()
        : text(raw.query, 120);
  if (query && (query.length < 2 || query.length > 120))
    throw new Error("Invalid search text");
  const isAccountId =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      query,
    );
  const isCanonicalPhone = /^\+964\d{10}$/.test(query);
  if (
    (kind === "customers" && query && !isAccountId && !isCanonicalPhone) ||
    (kind === "owners" &&
      query &&
      !isCanonicalPhone &&
      (/^\+/.test(query) || /^\d+$/.test(query)))
  )
    throw new UnsupportedAdministratorQueryError("Unsupported account search");
  if (
    /^[0-9a-z]{8}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{12}$/i.test(
      query,
    ) &&
    !/^[0-9a-f-]+$/i.test(query)
  )
    throw new Error("Invalid identifier");
  const status =
    raw.status === undefined || raw.status === null || raw.status === ""
      ? null
      : oneOf(
          raw.status,
          kind === "applications"
            ? [...statuses.applications, "pending"]
            : kind === "customers"
              ? []
              : statuses[kind],
        );
  const from =
    raw.from === undefined || raw.from === null || raw.from === ""
      ? null
      : date(raw.from);
  const through =
    raw.through === undefined || raw.through === null || raw.through === ""
      ? null
      : date(raw.through);
  if (from && through && from > through) throw new Error("Reversed date range");
  const ownerId =
    raw.ownerId === undefined || raw.ownerId === null || raw.ownerId === ""
      ? null
      : uuid(raw.ownerId);
  if (
    ownerId &&
    kind !== "cottages" &&
    kind !== "applications" &&
    kind !== "approvals"
  )
    throw new Error("Invalid owner scope");
  const afterAt =
    raw.afterAt === undefined || raw.afterAt === null || raw.afterAt === ""
      ? null
      : timestamp(raw.afterAt);
  const afterId =
    raw.afterId === undefined || raw.afterId === null || raw.afterId === ""
      ? null
      : uuid(raw.afterId);
  if ((afterAt === null) !== (afterId === null))
    throw new Error("Invalid cursor");
  return { kind, query, status, from, through, ownerId, afterAt, afterId };
}

export function parseAdministratorSearchResult(
  value: unknown,
  requestedKind: AdministratorSearchKind,
): AdministratorSearchPage {
  const raw = object(value);
  if (!Array.isArray(raw.rows) || raw.rows.length > 25)
    throw new Error("Invalid page");
  const rows = raw.rows.map((item): AdministratorRecordRow => {
    const row = object(item),
      kind = oneOf(row.kind, searchKinds);
    if (kind !== requestedKind) throw new Error("Wrong record kind");
    const projected: AdministratorRecordRow = {
      kind,
      id: uuid(row.id),
      ownerId: uuid(row.ownerId),
      label: text(row.label, 240),
      status: oneOf(row.status, statuses[kind]),
      at: timestamp(row.at),
    };
    if (kind === "cottages" || kind === "approvals")
      projected.profileId = uuid(row.profileId);
    if (kind === "applications")
      projected.applicationId = uuid(row.applicationId);
    if (kind === "approvals") {
      projected.cycleNumber = count(row.cycleNumber);
      if (projected.cycleNumber < 1) throw new Error("Invalid cycle");
    }
    if (kind === "customers" || kind === "owners") {
      const applicationId = optionalUuid(row.applicationId),
        maskedPhone = phone(row.maskedPhone);
      if (applicationId) projected.applicationId = applicationId;
      if (maskedPhone) projected.maskedPhone = maskedPhone;
    }
    return projected;
  });
  const total = count(raw.total),
    pendingApplications = count(raw.pendingApplications),
    pendingApprovals = count(raw.pendingApprovals);
  if (total < rows.length) throw new Error("Invalid total");
  const nextCursor =
    raw.nextCursor === null
      ? null
      : (() => {
          const cursor = object(raw.nextCursor);
          return { at: timestamp(cursor.at), id: uuid(cursor.id) };
        })();
  return { rows, total, pendingApplications, pendingApprovals, nextCursor };
}

function decision(value: unknown): Decision {
  const raw = object(value);
  if (typeof raw.approved !== "boolean") throw new Error("Invalid decision");
  return {
    approved: raw.approved,
    reason: text(raw.reason, 1000),
    administratorId: uuid(raw.administratorId),
    decidedAt: timestamp(raw.decidedAt),
  };
}
export function parseAdministratorRecordDetail(
  value: unknown,
  expectedKind: AdministratorDetailKind,
): AdministratorRecordDetail {
  const raw = object(value);
  if (raw.kind !== expectedKind) throw new Error("Wrong record detail");
  if (expectedKind === "account") {
    const marketplaceRole = oneOf(raw.marketplaceRole, statuses.customers);
    if (raw.customerCapability !== true) throw new Error("Invalid capability");
    const ownerApprovalState =
      raw.ownerApprovalState === undefined
        ? undefined
        : oneOf(raw.ownerApprovalState, statuses.owners);
    if (
      (marketplaceRole === "cottage_owner") !==
      (ownerApprovalState !== undefined)
    )
      throw new Error("Invalid owner state");
    const result: Extract<AdministratorRecordDetail, { kind: "account" }> = {
      kind: "account",
      id: uuid(raw.id),
      marketplaceRole,
      customerCapability: true,
      createdAt: timestamp(raw.createdAt),
    };
    if (ownerApprovalState) result.ownerApprovalState = ownerApprovalState;
    const applicationId = optionalUuid(raw.applicationId),
      maskedPhone = phone(raw.maskedPhone);
    if (applicationId) result.applicationId = applicationId;
    if (maskedPhone) result.maskedPhone = maskedPhone;
    return result;
  }
  const state = oneOf(raw.state, statuses.approvals),
    cycleNumber = count(raw.cycleNumber);
  if (cycleNumber < 1 || !Array.isArray(raw.localizedDecisions))
    throw new Error("Invalid history");
  const decidedAt = raw.decidedAt === null ? null : timestamp(raw.decidedAt);
  if ((state === "in_review") !== (decidedAt === null))
    throw new Error("Invalid decision date");
  return {
    kind: "approval",
    id: uuid(raw.id),
    profileId: uuid(raw.profileId),
    ownerId: uuid(raw.ownerId),
    name: text(raw.name, 240),
    approximateLocation: text(raw.approximateLocation, 240),
    state,
    cycleNumber,
    createdAt: timestamp(raw.createdAt),
    decidedAt,
    publicationDecision:
      raw.publicationDecision === null
        ? null
        : decision(raw.publicationDecision),
    localizedDecisions: raw.localizedDecisions.map((value: unknown) => {
      const item = object(value);
      return {
        ...decision(item),
        decisionId: uuid(item.decisionId),
        locale: oneOf(item.locale, ["ar", "ckb", "en"]),
        revisionId: uuid(item.revisionId),
      };
    }),
  };
}
export function parseAdministratorDetailTarget(
  kind: unknown,
  id: unknown,
): { kind: AdministratorDetailKind; id: string } {
  return { kind: oneOf(kind, ["account", "approval"]), id: uuid(id) };
}

export function parseAdministratorQueueSearch(
  value: unknown,
): AdministratorQueueSearch {
  const raw = object(value);
  if (!Object.keys(raw).every((key) => queueSearchKeys.some((k) => k === key)))
    throw new Error("Invalid queue filter");
  const queue = oneOf(filterText(raw.queue) ?? "requests", administratorQueues),
    state = filterText(raw.state),
    from = filterText(raw.from),
    through = filterText(raw.through),
    afterAt = filterText(raw.afterAt),
    afterId = filterText(raw.afterId);
  if (state !== null) oneOf(state, administratorQueueStates[queue]);
  if (from !== null) date(from);
  if (through !== null) date(through);
  if (from !== null && through !== null && from > through)
    throw new Error("Reversed date range");
  if ((afterAt === null) !== (afterId === null))
    throw new Error("Invalid cursor");
  if (afterAt !== null) timestamp(afterAt);
  if (afterId !== null) uuid(afterId);
  return { queue, state, from, through, afterAt, afterId };
}

function queueRow(
  value: unknown,
  queue: AdministratorQueue,
): AdministratorQueueRow {
  const row = object(value);
  exactKeys(row, ["id", "at", "reference", "state", "source", "category"]);
  if (typeof row.reference !== "string" || !queueReference.test(row.reference))
    throw new Error("Invalid booking request reference");
  const projected = {
    id: uuid(row.id),
    at: timestamp(row.at),
    reference: row.reference,
    state: oneOf(row.state, administratorQueueStates[queue]),
  };
  if (queue === "requests" || queue === "bookings")
    return {
      ...projected,
      source: nothing(row.source),
      category: nothing(row.category),
    };
  if (queue === "refunds")
    return {
      ...projected,
      source: oneOf(row.source, refundSources),
      category: nothing(row.category),
    };
  const source = oneOf(row.source, ["lifecycle", "cancellation"] as const);
  return {
    ...projected,
    source,
    category:
      source === "cancellation" && row.category === null
        ? null
        : oneOf(row.category, incidentCategories[source]),
  };
}

export function parseAdministratorQueueResult(
  value: unknown,
  queue: AdministratorQueue,
  requestedState: string | null,
): AdministratorQueuePage {
  const raw = object(value);
  exactKeys(raw, ["queue", "rows", "total", "stateCounts", "nextCursor"]);
  if (raw.queue !== queue) throw new Error("Wrong queue");
  if (!Array.isArray(raw.rows) || raw.rows.length > 25)
    throw new Error("Invalid page");
  const rows = raw.rows.map((item) => queueRow(item, queue)),
    total = count(raw.total);
  if (total < rows.length) throw new Error("Invalid total");
  const counts = object(raw.stateCounts);
  exactKeys(counts, administratorQueueStates[queue]);
  const stateCounts = Object.fromEntries(
    administratorQueueStates[queue].map((state) => [
      state,
      count(counts[state]),
    ]),
  );
  const expectedTotal =
    requestedState === null
      ? Object.values(stateCounts).reduce((sum, value) => sum + value, 0)
      : stateCounts[requestedState];
  if (
    total !== expectedTotal ||
    (requestedState !== null &&
      rows.some((row) => row.state !== requestedState)) ||
    new Set(rows.map((row) => row.id.toLowerCase())).size < rows.length
  )
    throw new Error("Inconsistent queue page");
  let nextCursor: AdministratorQueuePage["nextCursor"] = null;
  if (raw.nextCursor !== null) {
    const cursor = object(raw.nextCursor);
    exactKeys(cursor, ["at", "id"]);
    nextCursor = { at: timestamp(cursor.at), id: uuid(cursor.id) };
  }
  return { queue, rows, total, stateCounts, nextCursor };
}
