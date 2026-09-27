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
