import { describe, expect, it } from "vitest";
import {
  parseAdministratorRecordSearch,
  parseAdministratorSearchResult,
  parseAdministratorRecordDetail,
} from "./administrator-records";

const ownerId = "25000000-0000-4000-8000-000000000001";
const profileId = "25000000-0000-4000-8000-000000000002";
const id = "25000000-0000-4000-8000-000000000003";
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
});
