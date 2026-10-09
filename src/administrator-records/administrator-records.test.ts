import { describe, expect, it, vi } from "vitest";
vi.mock("@/administrator-records/actions", () => ({
  searchAdministratorRecordsAction: vi.fn(),
}));
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { searchAdministratorRecordsAction } from "./actions";
import {
  AdministratorRecordDetailView,
  AdministratorRecords,
} from "@/components/administrator-records";
import {
  parseAdministratorQueueResult,
  parseAdministratorQueueSearch,
  parseAdministratorRecordSearch,
  parseAdministratorSearchResult,
  parseAdministratorRecordDetail,
} from "./administrator-records";

const ownerId = "25000000-0000-4000-8000-000000000001";
const profileId = "25000000-0000-4000-8000-000000000002";
const id = "25000000-0000-4000-8000-000000000003";
const decisionId = "25000000-0000-4000-8000-000000000004";
const at = "2026-09-01T10:00:00+00:00";

describe("administrator records validation", () => {
  it("validates literal search, dates, owner scope and paired cursor", () => {
    expect(
      parseAdministratorRecordSearch({
        kind: "owners",
        query: "  %_\\'  ",
        status: "approved",
      }),
    ).toMatchObject({ kind: "owners", query: "%_\\'", status: "approved" });
    for (const input of [
      { kind: "customers", query: "x" },
      { kind: "customers", status: "approved" },
      { kind: "owners", ownerId },
      { kind: "applications", from: "2026-02-30" },
      { kind: "applications", from: "2026-09-02", through: "2026-09-01" },
      { kind: "applications", afterAt: at },
      { kind: "owners", query: "z".repeat(121) },
    ])
      expect(() => parseAdministratorRecordSearch(input)).toThrow();
    expect(
      parseAdministratorRecordSearch({
        kind: "approvals",
        afterAt: at,
        afterId: id,
      }),
    ).toMatchObject({ afterAt: at, afterId: id });
  });

  it("rejects unsupported customer names and local phone searches", () => {
    for (const input of [
      { kind: "customers", query: "Fictional Customer" },
      { kind: "customers", query: "07510000101" },
      { kind: "owners", query: "07510000101" },
    ])
      expect(() => parseAdministratorRecordSearch(input)).toThrow();
    expect(
      parseAdministratorRecordSearch({
        kind: "customers",
        query: "+9647510000101",
      }),
    ).toMatchObject({ query: "+9647510000101" });
    expect(
      parseAdministratorRecordSearch({
        kind: "owners",
        query: "Fictional Owner",
      }),
    ).toMatchObject({ query: "Fictional Owner" });
  });

  it("projects permitted rows and excludes private provider fields", () => {
    const row = {
      kind: "approvals",
      id,
      ownerId,
      profileId,
      label: "Cottage",
      status: "in_review",
      at,
      cycleNumber: 2,
      exactAddress: "secret",
      storagePath: "private/file",
    };
    const result = parseAdministratorSearchResult(
      {
        rows: [row],
        total: 1,
        pendingApplications: 2,
        pendingApprovals: 1,
        nextCursor: null,
        email: "secret@example.test",
      },
      "approvals",
    );
    expect(result).toEqual({
      rows: [
        {
          kind: "approvals",
          id,
          ownerId,
          profileId,
          label: "Cottage",
          status: "in_review",
          at,
          cycleNumber: 2,
        },
      ],
      total: 1,
      pendingApplications: 2,
      pendingApprovals: 1,
      nextCursor: null,
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("rejects malformed counts, lifecycle, dates, parent IDs and oversized text", () => {
    const row = {
      kind: "approvals",
      id,
      ownerId,
      profileId,
      label: "Cottage",
      status: "in_review",
      at,
      cycleNumber: 2,
    };
    const valid = {
      rows: [row],
      total: 1,
      pendingApplications: 2,
      pendingApprovals: 1,
      nextCursor: null,
    };
    for (const changed of [
      { ...valid, total: -1 },
      { ...valid, pendingApprovals: "0" },
      { ...valid, rows: [{ ...row, status: "unknown" }] },
      { ...valid, rows: [{ ...row, at: "2026-02-30" }] },
      { ...valid, rows: [{ ...row, profileId: undefined }] },
      { ...valid, rows: [{ ...row, label: "x".repeat(5000) }] },
      { ...valid, nextCursor: { at } },
    ])
      expect(() =>
        parseAdministratorSearchResult(changed, "approvals"),
      ).toThrow();
  });

  it("projects historical decisions without private fields", () => {
    const decision = {
      decisionId,
      approved: true,
      reason: "Verified",
      administratorId: ownerId,
      decidedAt: at,
      credential: "secret",
    };
    const detail = parseAdministratorRecordDetail(
      {
        kind: "approval",
        id,
        profileId,
        ownerId,
        name: "Cottage",
        approximateLocation: "Baghdad",
        state: "approved",
        cycleNumber: 1,
        createdAt: at,
        decidedAt: at,
        publicationDecision: decision,
        localizedDecisions: [
          { ...decision, locale: "ar", revisionId: profileId },
        ],
        exactLatitude: 33,
      },
      "approval",
    );
    expect(detail).toMatchObject({
      kind: "approval",
      id,
      localizedDecisions: [
        { locale: "ar", revisionId: profileId, approved: true },
      ],
    });
    expect(JSON.stringify(detail)).not.toContain("secret");
    expect(() =>
      parseAdministratorRecordDetail(
        { ...detail, profileId: undefined },
        "approval",
      ),
    ).toThrow();
  });

  it("retains more than three decisions for repeated revisions with unique event IDs", () => {
    const decisions = [0, 1, 2, 3].map((index) => ({
      decisionId: `25000000-0000-4000-8000-00000000000${index + 4}`,
      locale: "en",
      revisionId: profileId,
      approved: index === 3,
      reason: `Decision ${index + 1}`,
      administratorId: ownerId,
      decidedAt: at,
    }));
    const detail = parseAdministratorRecordDetail(
      {
        kind: "approval",
        id,
        profileId,
        ownerId,
        name: "Cottage",
        approximateLocation: "Baghdad",
        state: "approved",
        cycleNumber: 1,
        createdAt: at,
        decidedAt: at,
        publicationDecision: null,
        localizedDecisions: decisions,
      },
      "approval",
    );
    expect(detail.kind).toBe("approval");
    if (detail.kind !== "approval") return;
    expect(
      detail.localizedDecisions.map(({ decisionId }) => decisionId),
    ).toEqual(decisions.map(({ decisionId }) => decisionId));
    const markup = renderToStaticMarkup(
      createElement(AdministratorRecordDetailView, {
        locale: "en",
        record: detail,
      }),
    );
    expect(markup.match(/<li /g)).toHaveLength(4);
    expect(markup).toContain("English");
    expect(markup).not.toContain("<bdi>en</bdi>");
    for (const [locale, languageName] of [
      ["ar", "الإنجليزية"],
      ["ckb", "ئینگلیزی"],
    ] as const) {
      expect(
        renderToStaticMarkup(
          createElement(AdministratorRecordDetailView, {
            locale,
            record: detail,
          }),
        ),
      ).toContain(languageName);
    }
    expect(() =>
      parseAdministratorRecordDetail(
        {
          ...detail,
          localizedDecisions: [{ ...decisions[0], decisionId: undefined }],
        },
        "approval",
      ),
    ).toThrow();
  });

  it("labels the queue controls as a group in every locale", () => {
    for (const [locale, label] of [
      ["en", "Record queues"],
      ["ar", "طوابير السجلات"],
      ["ckb", "ڕیزەکانی تۆمار"],
    ] as const) {
      const markup = renderToStaticMarkup(
        createElement(AdministratorRecords, {
          locale,
          initial: { status: "idle" },
          initialFilters: {
            kind: "applications",
            query: "",
            status: "pending",
            from: null,
            through: null,
            ownerId: null,
          },
        }),
      );
      expect(markup).toContain(`role="group" aria-label="${label}"`);
    }
  });

  it("shows a supported-query hint after a rejected account search", async () => {
    vi.mocked(searchAdministratorRecordsAction).mockResolvedValue({
      status: "invalid",
      reason: "query",
    });
    render(
      createElement(AdministratorRecords, {
        locale: "en",
        initial: { status: "idle" },
        initialFilters: {
          kind: "customers",
          query: "",
          status: null,
          from: null,
          through: null,
          ownerId: null,
        },
      }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), {
      target: { value: "Fictional Customer" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search records" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Local 07 numbers are unsupported.",
      ),
    );
  });
});

describe("administrator booking queue validation", () => {
  const rowId = "25000000-0000-4000-8000-000000000005";
  const reference = "RC-REQ-0123456789ABCDEF";
  const microsecondAt = "2026-09-01T10:00:00.123456+00:00";
  const stateKeys = {
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
    refunds: ["requested", "processing", "succeeded", "failed", "unknown"],
    incidents: ["incident_pending", "completed", "no_show", "cancelled"],
  };
  const countsFor = (keys: string[], state: string) =>
    Object.fromEntries(keys.map((key) => [key, key === state ? 1 : 0]));
  const reply = (
    queue: string,
    keys: string[],
    row: Record<string, unknown>,
  ) => ({
    queue,
    rows: [{ id: rowId, at: microsecondAt, reference, ...row }],
    total: 1,
    stateCounts: countsFor(keys, String(row.state)),
    nextCursor: null,
  });
  const requestRow = { state: "pending", source: null, category: null };
  const requestReply = (overrides: Record<string, unknown> = {}) => ({
    ...reply("requests", stateKeys.requests, requestRow),
    ...overrides,
  });
  const requestReplyWithRow = (row: Record<string, unknown>) =>
    requestReply({
      rows: [
        { id: rowId, at: microsecondAt, reference, ...requestRow, ...row },
      ],
    });

  it("defaults empty input to the requests queue with nothing set", () => {
    expect(parseAdministratorQueueSearch({})).toEqual({
      queue: "requests",
      state: null,
      from: null,
      through: null,
      afterAt: null,
      afterId: null,
    });
  });

  it("treats empty strings as not set", () => {
    expect(
      parseAdministratorQueueSearch({
        queue: "",
        state: "",
        from: "",
        through: "",
        afterAt: "",
        afterId: "",
      }),
    ).toEqual({
      queue: "requests",
      state: null,
      from: null,
      through: null,
      afterAt: null,
      afterId: null,
    });
  });

  it("accepts every filter and passes the cursor timestamp byte for byte", () => {
    expect(
      parseAdministratorQueueSearch({
        queue: "refunds",
        state: "failed",
        from: "2026-09-01",
        through: "2026-09-30",
        afterAt: microsecondAt,
        afterId: rowId,
      }),
    ).toEqual({
      queue: "refunds",
      state: "failed",
      from: "2026-09-01",
      through: "2026-09-30",
      afterAt: microsecondAt,
      afterId: rowId,
    });
  });

  it("refuses an unknown key, queue, state, date, range or cursor", () => {
    for (const input of [
      null,
      "requests",
      { kind: "requests" },
      { queue: "reviews" },
      { queue: 7 },
      { queue: "bookings", state: "pending" },
      { queue: "incidents", state: "confirmed" },
      { state: null },
      { from: "2026-02-30" },
      { through: "2026-13-01" },
      { from: "2026-09-02", through: "2026-09-01" },
      { from: "0000-01-01" },
      { through: "0000-12-31" },
      { afterAt: microsecondAt },
      { afterId: rowId },
      { afterAt: "2026-09-01", afterId: rowId },
      { afterAt: microsecondAt, afterId: "not-a-uuid" },
    ])
      expect(() => parseAdministratorQueueSearch(input)).toThrow();
  });

  it("accepts a valid reply for each queue and keeps the cursor intact", () => {
    expect(
      parseAdministratorQueueResult(
        requestReply({ nextCursor: { at: microsecondAt, id: rowId } }),
        "requests",
        null,
      ),
    ).toEqual({
      queue: "requests",
      rows: [
        {
          id: rowId,
          at: microsecondAt,
          reference,
          state: "pending",
          source: null,
          category: null,
        },
      ],
      total: 1,
      stateCounts: countsFor(stateKeys.requests, "pending"),
      nextCursor: { at: microsecondAt, id: rowId },
    });
    expect(
      parseAdministratorQueueResult(
        reply("refunds", stateKeys.refunds, {
          state: "succeeded",
          source: "dispute",
          category: null,
        }),
        "refunds",
        null,
      ).rows[0],
    ).toMatchObject({ source: "dispute", category: null });
    expect(
      parseAdministratorQueueResult(
        reply("incidents", stateKeys.incidents, {
          state: "no_show",
          source: "cancellation",
          category: null,
        }),
        "incidents",
        null,
      ).rows[0],
    ).toMatchObject({ source: "cancellation", category: null });
    expect(
      parseAdministratorQueueResult(
        reply("incidents", stateKeys.incidents, {
          state: "completed",
          source: "lifecycle",
          category: "property_damage",
        }),
        "incidents",
        null,
      ).rows[0],
    ).toMatchObject({ source: "lifecycle", category: "property_damage" });
  });

  it("refuses a corrupt request-queue reply", () => {
    const rowWithoutSource = {
      id: rowId,
      at: microsecondAt,
      reference,
      state: "pending",
      category: null,
    };
    for (const value of [
      requestReply({ rows: Array(26).fill(requestReply().rows[0]), total: 26 }),
      requestReply({ queue: "bookings" }),
      requestReply({ extra: 1 }),
      { ...requestReply(), stateCounts: undefined },
      "rows",
      requestReplyWithRow({ state: "paid" }),
      requestReplyWithRow({ state: "confirmed" }),
      requestReplyWithRow({ reference: "RC-REQ-0123456789abcdef" }),
      requestReplyWithRow({ reference: "RC-REQ-0123456789ABCDEF/x" }),
      requestReplyWithRow({ reference: "javascript:alert(1)" }),
      requestReplyWithRow({ source: "dispute" }),
      requestReplyWithRow({ category: "safety" }),
      requestReplyWithRow({ id: "x" }),
      requestReplyWithRow({ at: "yesterday" }),
      requestReply({ rows: [rowWithoutSource] }),
      requestReply({ total: 0 }),
      requestReply({ total: -1 }),
      requestReply({ total: 1.5 }),
      requestReply({
        stateCounts: countsFor(stateKeys.requests.slice(1), "pending"),
      }),
      requestReply({
        stateCounts: {
          ...countsFor(stateKeys.requests, "pending"),
          unknown: 0,
        },
      }),
      requestReply({
        stateCounts: {
          ...countsFor(stateKeys.requests, "pending"),
          pending: -1,
        },
      }),
      requestReply({ nextCursor: { at: microsecondAt } }),
      requestReply({ nextCursor: { at: microsecondAt, id: rowId, extra: 1 } }),
    ])
      expect(() =>
        parseAdministratorQueueResult(value, "requests", null),
      ).toThrow();
  });

  it("refuses a corrupt refund or incident reply", () => {
    const refundRow = {
      state: "failed",
      source: "administrator",
      category: null,
    };
    const incidentRow = {
      state: "completed",
      source: "lifecycle",
      category: "safety",
    };
    const refunds = (row: Record<string, unknown>) =>
      reply("refunds", stateKeys.refunds, { ...refundRow, ...row });
    const incidents = (row: Record<string, unknown>) =>
      reply("incidents", stateKeys.incidents, { ...incidentRow, ...row });
    for (const value of [
      refunds({ category: "safety" }),
      refunds({ source: null }),
      refunds({ source: "lifecycle" }),
    ])
      expect(() =>
        parseAdministratorQueueResult(value, "refunds", null),
      ).toThrow();
    for (const value of [
      incidents({ category: null }),
      incidents({ category: "fraud" }),
      incidents({ source: "cancellation", category: "other" }),
      incidents({ source: "refund" }),
      incidents({ state: "confirmed" }),
    ])
      expect(() =>
        parseAdministratorQueueResult(value, "incidents", null),
      ).toThrow();
  });

  it("refuses a reply whose total contradicts its state counts", () => {
    const noCounts = countsFor(stateKeys.requests, "none");
    expect(() =>
      parseAdministratorQueueResult(
        requestReply({ stateCounts: noCounts }),
        "requests",
        null,
      ),
    ).toThrow();
    expect(() =>
      parseAdministratorQueueResult(
        requestReply({
          total: 2,
          stateCounts: countsFor(stateKeys.requests, "pending"),
        }),
        "requests",
        "pending",
      ),
    ).toThrow();
  });

  it("refuses a filtered reply holding a row of another state", () => {
    expect(() =>
      parseAdministratorQueueResult(
        requestReplyWithRow({ state: "processing" }),
        "requests",
        "pending",
      ),
    ).toThrow();
  });

  it("refuses a reply that repeats a row", () => {
    const [row] = requestReply().rows;
    expect(() =>
      parseAdministratorQueueResult(
        requestReply({
          rows: [row, row],
          total: 2,
          stateCounts: {
            ...countsFor(stateKeys.requests, "none"),
            pending: 2,
          },
        }),
        "requests",
        null,
      ),
    ).toThrow();
    expect(() =>
      parseAdministratorQueueResult(
        requestReply({
          rows: [
            { ...row, id: "25000000-0000-4000-8000-abcdefabcdef" },
            { ...row, id: "25000000-0000-4000-8000-ABCDEFABCDEF" },
          ],
          total: 2,
          stateCounts: {
            ...countsFor(stateKeys.requests, "none"),
            pending: 2,
          },
        }),
        "requests",
        null,
      ),
    ).toThrow();
  });

  it("accepts a filtered reply whose total is that state's count", () => {
    expect(
      parseAdministratorQueueResult(
        requestReply({
          total: 1,
          stateCounts: {
            ...countsFor(stateKeys.requests, "none"),
            pending: 1,
            expired: 4,
          },
        }),
        "requests",
        "pending",
      ).total,
    ).toBe(1);
  });
});
