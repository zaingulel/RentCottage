import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  SupabaseOwnerApplicationRepository,
  SupabaseVerificationDocumentStorage,
} from "./supabase-owner-application";

function result<T>(data: T, error: unknown = null) {
  return Promise.resolve({ data, error });
}

describe("Supabase Owner Application adapter", () => {
  it("maps the private application, Cottage Profile and document metadata", async () => {
    const maybeSingle = vi
      .fn()
      .mockReturnValueOnce(
        result({
          id: "20000000-0000-4000-8000-000000000001",
          owner_user_id: "10000000-0000-4000-8000-000000000001",
          status: "draft",
          applicant_kind: "individual",
          legal_name: "Zana Kareem",
          company_name: null,
          licensing_basis: "licence",
          exemption_basis: null,
          submitted_at: null,
        }),
      )
      .mockReturnValueOnce(
        result({
          name: "Garden House",
          governorate: "Erbil",
          approximate_location: "Shaqlawa countryside",
          exact_address: "Near the eastern orchard road",
          capacity: 8,
          bedrooms: 3,
          bathrooms: 2,
          amenities: ["garden", "parking"],
          description: "A quiet family cottage.",
          house_rules: "Families only.",
        }),
      );
    const documents = result([
      {
        id: "40000000-0000-4000-8000-000000000001",
        kind: "identity",
        original_filename: "passport.pdf",
        media_type: "application/pdf",
        size_bytes: 128,
        updated_at: "2026-08-14T10:00:00.000Z",
      },
    ]);
    const from = vi.fn((table: string) => {
      if (table === "owner_verification_documents") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({ order: vi.fn(() => documents) }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({ maybeSingle }),
          eq: vi.fn().mockReturnValue({ maybeSingle }),
        }),
      };
    });
    const client = { from } as unknown as SupabaseClient;

    await expect(
      new SupabaseOwnerApplicationRepository(client).load(),
    ).resolves.toMatchObject({
      status: "draft",
      legalName: "Zana Kareem",
      cottage: { name: "Garden House", capacity: 8 },
      documents: [{ kind: "identity", originalFilename: "passport.pdf" }],
    });
  });

  it("sends a normalized draft through the atomic save function", async () => {
    const rpc = vi.fn().mockReturnValue(result({ id: "application" }));
    const client = { rpc } as unknown as SupabaseClient;
    const repository = new SupabaseOwnerApplicationRepository(client);

    await repository.saveDraft({
      applicantKind: "individual",
      legalName: "Zana Kareem",
      companyName: "",
      licensingBasis: "licence",
      exemptionBasis: "",
      cottageName: "Garden House",
      governorate: "Erbil",
      approximateLocation: "Shaqlawa countryside",
      exactAddress: "Eastern orchard road",
      capacity: 8,
      bedrooms: 3,
      bathrooms: 2,
      amenities: ["garden"],
      description: "A quiet family cottage.",
      houseRules: "Families only.",
    });

    expect(rpc).toHaveBeenCalledWith(
      "save_owner_application",
      expect.objectContaining({
        requested_applicant_kind: "individual",
        requested_cottage_name: "Garden House",
        requested_capacity: 8,
      }),
    );
  });

  it("returns the prior object path from atomic metadata registration", async () => {
    const authenticatedRpc = vi.fn();
    const privilegedRpc = vi.fn().mockReturnValue(
      result({
        document_id: "40000000-0000-4000-8000-000000000001",
        previous_object_path: "owner/application/identity/old.pdf",
        previous_cleanup_id: "50000000-0000-4000-8000-000000000002",
      }),
    );
    const repository = new SupabaseOwnerApplicationRepository(
      { rpc: authenticatedRpc } as unknown as SupabaseClient,
      { rpc: privilegedRpc } as unknown as SupabaseClient,
    );

    await expect(
      repository.registerDocument("50000000-0000-4000-8000-000000000001"),
    ).resolves.toEqual({
      documentId: "40000000-0000-4000-8000-000000000001",
      previousObjectPath: "owner/application/identity/old.pdf",
      previousCleanupId: "50000000-0000-4000-8000-000000000002",
    });
    expect(privilegedRpc).toHaveBeenCalledWith(
      "register_owner_verification_document",
      {
        target_cleanup_id: "50000000-0000-4000-8000-000000000001",
      },
    );
    expect(authenticatedRpc).not.toHaveBeenCalled();
  });

  it("prepares upload cleanup through the server-only client", async () => {
    const authenticatedRpc = vi.fn();
    const privilegedRpc = vi
      .fn()
      .mockReturnValue(result("50000000-0000-4000-8000-000000000001"));
    const repository = new SupabaseOwnerApplicationRepository(
      { rpc: authenticatedRpc } as unknown as SupabaseClient,
      { rpc: privilegedRpc } as unknown as SupabaseClient,
    );

    await expect(
      repository.prepareDocumentUpload({
        ownerUserId: "10000000-0000-4000-8000-000000000001",
        applicationId: "20000000-0000-4000-8000-000000000001",
        kind: "identity",
        objectPath: "owner/application/identity/document.pdf",
        originalFilename: "passport.pdf",
        mediaType: "application/pdf",
        sizeBytes: 128,
      }),
    ).resolves.toBe("50000000-0000-4000-8000-000000000001");
    expect(privilegedRpc).toHaveBeenCalledWith(
      "prepare_owner_verification_document_upload",
      expect.objectContaining({ requested_kind: "identity" }),
    );
    expect(authenticatedRpc).not.toHaveBeenCalled();
  });

  it("fails loudly on malformed provider data", async () => {
    const maybeSingle = vi.fn().mockReturnValue(
      result({
        id: "not-a-uuid",
        owner_user_id: "not-a-uuid",
        status: "unexpected",
      }),
    );
    const client = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({ maybeSingle }),
        }),
      }),
    } as unknown as SupabaseClient;

    await expect(
      new SupabaseOwnerApplicationRepository(client).load(),
    ).rejects.toThrow(/Owner Application/);
  });
});

describe("Supabase private verification storage adapter", () => {
  it("uploads to the private bucket without overwriting an object", async () => {
    const upload = vi.fn().mockReturnValue(result({ path: "path" }));
    const from = vi.fn().mockReturnValue({ upload });
    const storage = new SupabaseVerificationDocumentStorage({
      storage: { from },
    } as unknown as SupabaseClient);

    await storage.upload("owner/application/identity/document.pdf", {
      name: "passport.pdf",
      type: "application/pdf",
      size: 4,
      bytes: new Uint8Array([1, 2, 3, 4]),
    });

    expect(from).toHaveBeenCalledWith("owner-verification");
    expect(upload).toHaveBeenCalledWith(
      "owner/application/identity/document.pdf",
      expect.any(Uint8Array),
      { contentType: "application/pdf", upsert: false },
    );
  });
});
