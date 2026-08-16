import { describe, expect, it, vi } from "vitest";

import {
  executeOwnerApplicationReviewCommand,
  parseOwnerApplicationReviewCommand,
  parseOwnerApplicationReviewResult,
} from "./owner-application-review";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("Owner Application review boundary", () => {
  it("accepts a scoped missing-information request without inventing lifecycle behavior", () => {
    expect(
      parseOwnerApplicationReviewCommand({
        action: "request_information",
        applicationId: "20000000-0000-4000-8000-000000000001",
        expectedVersion: 4,
        reason: "Please provide the renewed municipal licence.",
        requestedFields: ["exact_address"],
        requestedDocumentKinds: ["licensing_or_exemption"],
      }),
    ).toEqual({
      action: "request_information",
      applicationId: "20000000-0000-4000-8000-000000000001",
      expectedVersion: 4,
      reason: "Please provide the renewed municipal licence.",
      requestedFields: ["exact_address"],
      requestedDocumentKinds: ["licensing_or_exemption"],
    });
  });

  it("rejects unknown fields, evidence kinds, and unbounded reasons", () => {
    expect(() =>
      parseOwnerApplicationReviewCommand({
        action: "request_information",
        applicationId: "20000000-0000-4000-8000-000000000001",
        expectedVersion: 4,
        reason: "x".repeat(1001),
        requestedFields: ["owner_user_id"],
        requestedDocumentKinds: ["bank_password"],
      }),
    ).toThrow("Owner Application review command is invalid");
  });

  it("requires the complete approval record at the command boundary", () => {
    expect(
      parseOwnerApplicationReviewCommand({
        action: "approve",
        applicationId: "20000000-0000-4000-8000-000000000001",
        expectedVersion: 7,
        reason: "Evidence meets the owner verification standard.",
        jurisdiction: "Erbil Governorate",
        licensingBasis: "licence",
        licenceOrExemptionBasis: "Tourism licence 2026-41",
        relevantExpiryDates: {
          licensing_or_exemption: "2027-08-15",
        },
      }),
    ).toEqual({
      action: "approve",
      applicationId: "20000000-0000-4000-8000-000000000001",
      expectedVersion: 7,
      reason: "Evidence meets the owner verification standard.",
      jurisdiction: "Erbil Governorate",
      licensingBasis: "licence",
      licenceOrExemptionBasis: "Tourism licence 2026-41",
      relevantExpiryDates: {
        licensing_or_exemption: "2027-08-15",
      },
    });
  });

  it.each(["2027-02-30", "2027-13-01", "2027-01-00", "not-a-date"])(
    "rejects the malformed or impossible approval expiry %s",
    (expiry) => {
      expect(() =>
        parseOwnerApplicationReviewCommand({
          action: "approve",
          applicationId: "20000000-0000-4000-8000-000000000001",
          expectedVersion: 7,
          reason: "Evidence meets the owner verification standard.",
          jurisdiction: "Erbil Governorate",
          licensingBasis: "licence",
          licenceOrExemptionBasis: "Tourism licence 2026-41",
          relevantExpiryDates: { licensing_or_exemption: expiry },
        }),
      ).toThrow("Owner Application review command is invalid");
    },
  );

  it("leaves past-date authority with database time and propagates its refusal", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "RC422" },
    });
    await expect(
      executeOwnerApplicationReviewCommand(
        { rpc } as unknown as SupabaseClient,
        {
          action: "approve",
          applicationId: "20000000-0000-4000-8000-000000000001",
          expectedVersion: 7,
          reason: "Evidence meets the owner verification standard.",
          jurisdiction: "Erbil Governorate",
          licensingBasis: "licence",
          licenceOrExemptionBasis: "Tourism licence 2026-41",
          relevantExpiryDates: { licensing_or_exemption: "1900-01-01" },
        },
      ),
    ).rejects.toThrow("Owner Application review is unavailable");
    expect(rpc).toHaveBeenCalledOnce();
  });

  it("maps only the safe database result fields", () => {
    expect(
      parseOwnerApplicationReviewResult({
        application_id: "20000000-0000-4000-8000-000000000001",
        status: "approved",
        version: 8,
        occurred_at: "2026-08-16T12:00:00.000Z",
        review_due_at: null,
        reviewer_user_id: "private-administrator-id",
        internal_audit: "must not escape",
      }),
    ).toEqual({
      applicationId: "20000000-0000-4000-8000-000000000001",
      status: "approved",
      version: 8,
      occurredAt: "2026-08-16T12:00:00.000Z",
      reviewDueAt: null,
    });
  });

  it("delegates one validated command to the authoritative database function", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        application_id: "20000000-0000-4000-8000-000000000001",
        status: "under_review",
        version: 5,
        occurred_at: "2026-08-16T12:00:00.000Z",
        review_due_at: "2026-08-19T10:00:00.000Z",
        actor_user_id: "must-not-escape",
      },
      error: null,
    });

    await expect(
      executeOwnerApplicationReviewCommand(
        { rpc } as unknown as SupabaseClient,
        {
          action: "start_review",
          applicationId: "20000000-0000-4000-8000-000000000001",
          expectedVersion: 4,
        },
      ),
    ).resolves.toEqual({
      applicationId: "20000000-0000-4000-8000-000000000001",
      status: "under_review",
      version: 5,
      occurredAt: "2026-08-16T12:00:00.000Z",
      reviewDueAt: "2026-08-19T10:00:00.000Z",
    });
    expect(rpc).toHaveBeenCalledWith(
      "review_owner_application",
      expect.objectContaining({
        target_application_id: "20000000-0000-4000-8000-000000000001",
        expected_version: 4,
        requested_action: "start_review",
      }),
    );
  });
});
