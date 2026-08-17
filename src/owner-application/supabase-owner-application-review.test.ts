import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  loadOwnerApplicationOwnerReview,
  loadOwnerApplicationReviewDetail,
} from "./supabase-owner-application-review";

function queryResult(data: unknown) {
  const result = Promise.resolve({ data, error: null });
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    is: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn(() => result),
    then: result.then.bind(result),
  };
  for (const method of [
    "select",
    "eq",
    "in",
    "is",
    "order",
    "limit",
  ] as const) {
    query[method].mockReturnValue(query);
  }
  return query;
}

describe("Supabase Owner Application review adapter", () => {
  it("does not request or serialize the owner's authentication identifier for administrators", async () => {
    const application = queryResult({
      id: "20000000-0000-4000-8000-000000000001",
      version: 2,
      status: "submitted",
      submitted_at: "2026-08-16T12:00:00.000Z",
      review_due_at: "2026-08-19T12:00:00.000Z",
      applicant_kind: "individual",
      legal_name: "Private owner",
      company_name: null,
      licensing_basis: "licence",
      exemption_basis: null,
    });
    const profile = queryResult({
      name: "Garden House",
      governorate: "Erbil",
      approximate_location: "Shaqlawa",
      exact_address: "Private road",
      capacity: 8,
      bedrooms: 3,
      bathrooms: 2,
      amenities: ["garden"],
      description: "Description",
      house_rules: "Rules",
    });
    const documents = queryResult([]);
    const request = queryResult(null);
    const transitions = queryResult([]);
    const tableQueries: Record<string, ReturnType<typeof queryResult>> = {
      owner_applications: application,
      owner_application_cottage_profiles: profile,
      owner_verification_documents: documents,
      owner_application_information_requests: request,
      owner_application_transitions: transitions,
    };
    const from = vi.fn((table: string) => tableQueries[table]);

    const detail = await loadOwnerApplicationReviewDetail(
      { from } as unknown as SupabaseClient,
      "20000000-0000-4000-8000-000000000001",
    );

    expect(application.select).toHaveBeenCalledWith(
      expect.not.stringContaining("owner_user_id"),
    );
    expect(detail).not.toBeNull();
    expect(detail).not.toHaveProperty("ownerUserId");
  });

  it.each([0, -1])(
    "rejects invalid loaded snapshot version %s",
    async (version) => {
      const application = queryResult({
        id: "20000000-0000-4000-8000-000000000001",
        version,
        status: "submitted",
        submitted_at: "2026-08-16T12:00:00.000Z",
        review_due_at: "2026-08-19T12:00:00.000Z",
        applicant_kind: "individual",
        legal_name: "Private owner",
        company_name: null,
        licensing_basis: "licence",
        exemption_basis: null,
      });
      const tableQueries = {
        owner_applications: application,
        owner_application_cottage_profiles: queryResult({
          name: "Garden House",
          governorate: "Erbil",
          approximate_location: "Shaqlawa",
          exact_address: "Private road",
          capacity: 8,
          bedrooms: 3,
          bathrooms: 2,
          amenities: [],
          description: "Description",
          house_rules: "Rules",
        }),
        owner_verification_documents: queryResult([]),
        owner_application_information_requests: queryResult(null),
        owner_application_transitions: queryResult([]),
      };
      const from = vi.fn(
        (table: keyof typeof tableQueries) => tableQueries[table],
      );

      await expect(
        loadOwnerApplicationReviewDetail(
          { from } as unknown as SupabaseClient,
          "20000000-0000-4000-8000-000000000001",
        ),
      ).rejects.toThrow("Owner Application review detail is invalid");
    },
  );

  it("loads owner request scope through the safe RPC without selecting the base table", async () => {
    const renewal = queryResult(null);
    const notices = queryResult([]);
    const from = vi.fn((table: string) => {
      if (table === "owner_application_renewal_work") return renewal;
      if (table === "owner_application_notices") return notices;
      throw new Error(`unexpected table: ${table}`);
    });
    const rpc = vi.fn().mockResolvedValue({
      data: {
        reason: "Renew the licence",
        requested_fields: ["exact_address"],
        requested_document_kinds: ["licensing_or_exemption"],
        requested_at: "2026-08-16T12:00:00.000Z",
        requested_by_user_id: "must-not-cross-owner-boundary",
      },
      error: null,
    });

    await expect(
      loadOwnerApplicationOwnerReview(
        { from, rpc } as unknown as SupabaseClient,
        "20000000-0000-4000-8000-000000000001",
      ),
    ).resolves.toEqual({
      activeRequest: {
        reason: "Renew the licence",
        requestedFields: ["exact_address"],
        requestedDocumentKinds: ["licensing_or_exemption"],
      },
      renewalDocumentKinds: [],
      notices: [],
    });
    expect(rpc).toHaveBeenCalledWith(
      "owner_application_active_information_request",
    );
    expect(from).not.toHaveBeenCalledWith(
      "owner_application_information_requests",
    );
  });

  it("rejects an unknown Owner Backoffice notice kind", async () => {
    const renewal = queryResult(null);
    const notices = queryResult([
      {
        kind: "internal_only",
        reason: null,
        created_at: "2026-08-16T12:00:00.000Z",
      },
    ]);
    const from = vi.fn((table: string) =>
      table === "owner_application_renewal_work" ? renewal : notices,
    );
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });

    await expect(
      loadOwnerApplicationOwnerReview(
        { from, rpc } as unknown as SupabaseClient,
        "20000000-0000-4000-8000-000000000001",
      ),
    ).rejects.toThrow("Owner Application notice is invalid");
  });
});
