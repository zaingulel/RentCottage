import { describe, expect, it, vi } from "vitest";

import {
  executeOwnerApplicationInformationResponse,
  executeOwnerApplicationRenewalSubmission,
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

  it("rejects an unknown requested field", () => {
    expect(() =>
      parseOwnerApplicationReviewCommand({
        action: "request_information",
        applicationId: "20000000-0000-4000-8000-000000000001",
        expectedVersion: 4,
        reason: "Provide the private address.",
        requestedFields: ["owner_user_id"],
        requestedDocumentKinds: [],
      }),
    ).toThrow("Owner Application review command is invalid");
  });

  it("rejects an unknown requested evidence kind", () => {
    expect(() =>
      parseOwnerApplicationReviewCommand({
        action: "request_information",
        applicationId: "20000000-0000-4000-8000-000000000001",
        expectedVersion: 4,
        reason: "Provide replacement evidence.",
        requestedFields: [],
        requestedDocumentKinds: ["bank_password"],
      }),
    ).toThrow("Owner Application review command is invalid");
  });

  it("rejects an unbounded request reason", () => {
    expect(() =>
      parseOwnerApplicationReviewCommand({
        action: "request_information",
        applicationId: "20000000-0000-4000-8000-000000000001",
        expectedVersion: 4,
        reason: "x".repeat(1001),
        requestedFields: ["exact_address"],
        requestedDocumentKinds: [],
      }),
    ).toThrow("Owner Application review command is invalid");
  });

  it.each([0, -1])("rejects snapshot version %s", (expectedVersion) => {
    expect(() =>
      parseOwnerApplicationReviewCommand({
        action: "start_review",
        applicationId: "20000000-0000-4000-8000-000000000001",
        expectedVersion,
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

  it("leaves past-date authority with database time and preserves its invalid outcome", async () => {
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
    ).rejects.toThrow("Owner Application review command is invalid");
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

  it.each(["reject", "suspend"] as const)(
    "delegates a validated %s command without provider details crossing the seam",
    async (action) => {
      const rpc = vi.fn().mockResolvedValue({
        data: {
          application_id: "20000000-0000-4000-8000-000000000001",
          status: action === "reject" ? "rejected" : "suspended",
          version: 6,
          occurred_at: "2026-08-16T12:00:00.000Z",
          review_due_at: null,
        },
        error: null,
      });

      await executeOwnerApplicationReviewCommand(
        { rpc } as unknown as SupabaseClient,
        {
          action,
          applicationId: "20000000-0000-4000-8000-000000000001",
          expectedVersion: 5,
          reason: "Recorded decision reason.",
        },
      );

      expect(rpc).toHaveBeenCalledWith(
        "review_owner_application",
        expect.objectContaining({
          requested_action: action,
          requested_reason: "Recorded decision reason.",
        }),
      );
    },
  );

  it.each([
    ["capacity", undefined],
    ["capacity", ""],
    ["capacity", 3.5],
    ["bedrooms", 0],
  ])("rejects invalid requested numeric %s value %#", async (field, value) => {
    const rpc = vi.fn();

    await expect(
      executeOwnerApplicationInformationResponse(
        { rpc } as unknown as SupabaseClient,
        {
          expectedVersion: 5,
          fieldValues: { [field]: value },
          confirmedDocumentKinds: [],
        },
      ),
    ).rejects.toThrow("Owner Application review command is invalid");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects unsupported response fields before the provider call", async () => {
    const rpc = vi.fn();

    await expect(
      executeOwnerApplicationInformationResponse(
        { rpc } as unknown as SupabaseClient,
        {
          expectedVersion: 5,
          fieldValues: { owner_user_id: "private" },
          confirmedDocumentKinds: [],
        },
      ),
    ).rejects.toThrow("Owner Application review command is invalid");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("delegates a valid scoped information response", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        application_id: "20000000-0000-4000-8000-000000000001",
        status: "under_review",
        version: 6,
        occurred_at: "2026-08-16T12:00:00.000Z",
        review_due_at: "2026-08-19T12:00:00.000Z",
      },
      error: null,
    });

    await executeOwnerApplicationInformationResponse(
      { rpc } as unknown as SupabaseClient,
      {
        expectedVersion: 5,
        fieldValues: { exact_address: "Renewed private address", capacity: 8 },
        confirmedDocumentKinds: ["identity"],
      },
    );

    expect(rpc).toHaveBeenCalledWith("respond_to_owner_application_request", {
      expected_version: 5,
      requested_field_values: {
        exact_address: "Renewed private address",
        capacity: 8,
      },
      confirmed_document_kinds: ["identity"],
    });
  });

  it("rejects an empty renewal scope before the provider call", async () => {
    const rpc = vi.fn();

    await expect(
      executeOwnerApplicationRenewalSubmission(
        { rpc } as unknown as SupabaseClient,
        { expectedVersion: 5, confirmedDocumentKinds: [] },
      ),
    ).rejects.toThrow("Owner Application review command is invalid");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("delegates a valid renewal submission", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        application_id: "20000000-0000-4000-8000-000000000001",
        status: "under_review",
        version: 9,
        occurred_at: "2026-08-16T12:00:00.000Z",
        review_due_at: "2026-08-19T12:00:00.000Z",
      },
      error: null,
    });

    await executeOwnerApplicationRenewalSubmission(
      { rpc } as unknown as SupabaseClient,
      {
        expectedVersion: 8,
        confirmedDocumentKinds: ["licensing_or_exemption"],
      },
    );

    expect(rpc).toHaveBeenCalledWith("submit_owner_application_renewal", {
      expected_version: 8,
      confirmed_document_kinds: ["licensing_or_exemption"],
    });
  });
});
