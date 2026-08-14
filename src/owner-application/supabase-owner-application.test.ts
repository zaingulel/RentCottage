import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  SupabaseOwnerApplicationRepository,
  SupabaseVerificationDocumentStorage,
  loadSubmittedOwnerApplicationsForReview,
  parseSubmittedOwnerApplicationReviewCursor,
} from "./supabase-owner-application";

function result<T>(data: T, error: unknown = null) {
  return Promise.resolve({ data, error });
}

describe("Supabase Owner Application adapter", () => {
  it("rejects an unsafe review cursor at the exported loader boundary", async () => {
    const from = vi.fn();

    await expect(
      loadSubmittedOwnerApplicationsForReview(
        { from } as unknown as SupabaseClient,
        {
          submittedAt: "Fri, 14 Aug 2026 10:00:00 GMT(foo)",
          applicationId: "20000000-0000-4000-8000-000000000001",
        },
      ),
    ).rejects.toThrow("Owner Application review cursor is invalid");
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects a supplied empty cursor instead of resetting to page one", async () => {
    const from = vi.fn();

    await expect(
      loadSubmittedOwnerApplicationsForReview(
        { from } as unknown as SupabaseClient,
        {} as never,
      ),
    ).rejects.toThrow("Owner Application review cursor is invalid");
    expect(from).not.toHaveBeenCalled();
  });

  it("preserves a validated microsecond cursor losslessly", () => {
    expect(
      parseSubmittedOwnerApplicationReviewCursor(
        "2026-08-14T10:00:00.123456Z",
        "20000000-0000-4000-8000-000000000001",
      ),
    ).toEqual({
      submittedAt: "2026-08-14T10:00:00.123456Z",
      applicationId: "20000000-0000-4000-8000-000000000001",
    });
  });

  it("loads submitted applications and groups their private document metadata", async () => {
    const applications = result([
      {
        id: "20000000-0000-4000-8000-000000000001",
        legal_name: "Zana Kareem",
        submitted_at: "2026-08-14T10:00:00.000Z",
      },
    ]);
    const documents = result([
      {
        id: "40000000-0000-4000-8000-000000000001",
        application_id: "20000000-0000-4000-8000-000000000001",
        kind: "identity",
        original_filename: "passport.pdf",
      },
    ]);
    const from = vi.fn((table: string) => {
      if (table === "owner_applications") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue(applications),
                }),
              }),
            }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue(documents),
            }),
          }),
        }),
      };
    });

    await expect(
      loadSubmittedOwnerApplicationsForReview({
        from,
      } as unknown as SupabaseClient),
    ).resolves.toEqual({
      applications: [
        {
          applicationId: "20000000-0000-4000-8000-000000000001",
          legalName: "Zana Kareem",
          submittedAt: "2026-08-14T10:00:00.000Z",
          documents: [
            {
              id: "40000000-0000-4000-8000-000000000001",
              kind: "identity",
              originalFilename: "passport.pdf",
            },
          ],
        },
      ],
      nextCursor: null,
    });
  });

  it("loads a bounded page and continues with a stable keyset cursor", async () => {
    const applicationRows = Array.from({ length: 51 }, (_, index) => ({
      id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      legal_name: `Owner ${index + 1}`,
      submitted_at: "2026-08-14T10:00:00.000Z",
    }));
    const documentBatches: string[][] = [];
    const limit = vi
      .fn()
      .mockReturnValueOnce(result(applicationRows))
      .mockReturnValueOnce(result(applicationRows.slice(50)));
    const or = vi.fn().mockReturnValue({ limit });
    const from = vi.fn((table: string) => {
      if (table === "owner_applications") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit,
                  or,
                }),
              }),
            }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          in: vi.fn((_column: string, ids: string[]) => {
            documentBatches.push(ids);
            return {
              order: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue(result([])),
              }),
            };
          }),
        }),
      };
    });

    const client = { from } as unknown as SupabaseClient;
    const firstPage = await loadSubmittedOwnerApplicationsForReview(client);
    expect(firstPage.applications).toHaveLength(50);
    expect(firstPage.nextCursor).toEqual({
      submittedAt: "2026-08-14T10:00:00.000Z",
      applicationId: "20000000-0000-4000-8000-000000000050",
    });

    const secondPage = await loadSubmittedOwnerApplicationsForReview(
      client,
      firstPage.nextCursor ?? undefined,
    );
    expect(secondPage.applications).toHaveLength(1);
    expect(secondPage.nextCursor).toBeNull();
    expect(or).toHaveBeenCalledWith(expect.stringContaining("id.gt.20000000"));
    expect(documentBatches.map((batch) => batch.length)).toEqual([50, 1]);
  });

  it("maps the private application, Cottage Profile and document metadata", async () => {
    const ownerUserId = "10000000-0000-4000-8000-000000000001";
    const application = result({
      id: "20000000-0000-4000-8000-000000000001",
      owner_user_id: ownerUserId,
      status: "draft",
      applicant_kind: "individual",
      legal_name: "Zana Kareem",
      company_name: null,
      licensing_basis: "licence",
      exemption_basis: null,
      submitted_at: null,
    });
    const profile = result({
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
    });
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
    const applicationOwnerEq = vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockReturnValue(application),
      }),
    });
    const from = vi.fn((table: string) => {
      if (table === "owner_applications") {
        return {
          select: vi.fn().mockReturnValue({ eq: applicationOwnerEq }),
        };
      }
      if (table === "owner_verification_documents") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({ order: vi.fn(() => documents) }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockReturnValue(profile),
          }),
        }),
      };
    });
    const getUser = vi.fn().mockResolvedValue({
      data: { user: { id: ownerUserId } },
      error: null,
    });
    const client = { auth: { getUser }, from } as unknown as SupabaseClient;

    await expect(
      new SupabaseOwnerApplicationRepository(client, client).load(),
    ).resolves.toMatchObject({
      status: "draft",
      legalName: "Zana Kareem",
      cottage: { name: "Garden House", capacity: 8 },
      documents: [{ kind: "identity", originalFilename: "passport.pdf" }],
    });
    expect(getUser).toHaveBeenCalledOnce();
    expect(applicationOwnerEq).toHaveBeenCalledWith(
      "owner_user_id",
      ownerUserId,
    );
  });

  it("sends a normalized draft through the atomic save function", async () => {
    const rpc = vi.fn().mockReturnValue(
      result([
        {
          cleanup_id: "50000000-0000-4000-8000-000000000003",
          object_path: "owner/application/identity/obsolete.pdf",
        },
      ]),
    );
    const client = { rpc } as unknown as SupabaseClient;
    const repository = new SupabaseOwnerApplicationRepository(client, client);

    await expect(
      repository.saveDraft({
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
      }),
    ).resolves.toEqual([
      {
        cleanupId: "50000000-0000-4000-8000-000000000003",
        objectPath: "owner/application/identity/obsolete.pdf",
      },
    ]);

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

  it("reconciles an already-committed registration through the server-only client", async () => {
    const authenticatedRpc = vi.fn();
    const privilegedRpc = vi.fn().mockReturnValue(
      result({
        status: "registered",
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
      repository.reconcileDocumentRegistration(
        "50000000-0000-4000-8000-000000000001",
      ),
    ).resolves.toEqual({
      status: "registered",
      documentId: "40000000-0000-4000-8000-000000000001",
      previousObjectPath: "owner/application/identity/old.pdf",
      previousCleanupId: "50000000-0000-4000-8000-000000000002",
    });
    expect(privilegedRpc).toHaveBeenCalledWith(
      "reconcile_owner_verification_document_registration",
      { target_cleanup_id: "50000000-0000-4000-8000-000000000001" },
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

  it("prepares access as the administrator and completes it as the service", async () => {
    const authenticatedRpc = vi.fn().mockReturnValueOnce(
      result({
        grant_id: "60000000-0000-4000-8000-000000000001",
        object_path: "owner/application/identity/document.pdf",
      }),
    );
    const privilegedRpc = vi.fn().mockReturnValueOnce(result("completed"));
    const repository = new SupabaseOwnerApplicationRepository(
      { rpc: authenticatedRpc } as unknown as SupabaseClient,
      { rpc: privilegedRpc } as unknown as SupabaseClient,
    );

    await expect(
      repository.prepareDocumentAccess("40000000-0000-4000-8000-000000000001"),
    ).resolves.toEqual({
      status: "ready",
      grantId: "60000000-0000-4000-8000-000000000001",
      objectPath: "owner/application/identity/document.pdf",
    });
    expect(authenticatedRpc).toHaveBeenCalledWith(
      "prepare_owner_verification_document_access",
      { target_document_id: "40000000-0000-4000-8000-000000000001" },
    );
    await expect(
      repository.completeDocumentAccess(
        "60000000-0000-4000-8000-000000000001",
        60,
      ),
    ).resolves.toBe("completed");
    expect(privilegedRpc).toHaveBeenCalledWith(
      "complete_owner_verification_document_access",
      {
        target_access_grant_id: "60000000-0000-4000-8000-000000000001",
        requested_expires_in_seconds: 60,
      },
    );
    expect(authenticatedRpc).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      code: "RC204",
      message: "Verification document access is denied",
    },
    {
      cause: {
        code: "RC204",
        message: "Verification document access is denied",
      },
    },
  ])(
    "maps an RC204 access error to the domain denial outcome",
    async (error) => {
      const authenticatedRpc = vi.fn().mockReturnValue(result(null, error));
      const repository = new SupabaseOwnerApplicationRepository(
        { rpc: authenticatedRpc } as unknown as SupabaseClient,
        { rpc: vi.fn() } as unknown as SupabaseClient,
      );

      await expect(
        repository.prepareDocumentAccess(
          "40000000-0000-4000-8000-000000000001",
        ),
      ).resolves.toEqual({ status: "denied" });
    },
  );

  it.each([null, ["legal_name", 42]])(
    "rejects malformed missing-item data %#",
    async (data) => {
      const client = {
        rpc: vi.fn().mockReturnValue(result(data)),
      } as unknown as SupabaseClient;

      await expect(
        new SupabaseOwnerApplicationRepository(client, client).missingItems(),
      ).rejects.toThrow("Owner Application missing-item data is invalid");
    },
  );

  it("submits as the applicant and completes cleanup as the service", async () => {
    const authenticatedRpc = vi.fn().mockReturnValue(result(null));
    const privilegedRpc = vi.fn().mockReturnValue(result(null));
    const repository = new SupabaseOwnerApplicationRepository(
      { rpc: authenticatedRpc } as unknown as SupabaseClient,
      { rpc: privilegedRpc } as unknown as SupabaseClient,
    );

    await repository.submit();
    await repository.completeDocumentCleanup(
      "50000000-0000-4000-8000-000000000001",
    );

    expect(authenticatedRpc).toHaveBeenCalledWith("submit_owner_application");
    expect(privilegedRpc).toHaveBeenCalledWith(
      "complete_owner_verification_document_cleanup",
      { target_cleanup_id: "50000000-0000-4000-8000-000000000001" },
    );
    expect(authenticatedRpc).toHaveBeenCalledOnce();
    expect(privilegedRpc).toHaveBeenCalledOnce();
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
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "10000000-0000-4000-8000-000000000001" } },
          error: null,
        }),
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({ maybeSingle }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    await expect(
      new SupabaseOwnerApplicationRepository(client, client).load(),
    ).rejects.toThrow(/Owner Application/);
  });
});

describe("Supabase private verification storage adapter", () => {
  it("removes replaced objects from the private bucket", async () => {
    const remove = vi.fn().mockReturnValue(result([{ name: "old.pdf" }]));
    const from = vi.fn().mockReturnValue({ remove });
    const storage = new SupabaseVerificationDocumentStorage({
      storage: { from },
    } as unknown as SupabaseClient);

    await storage.remove(["owner/application/identity/old.pdf"]);

    expect(from).toHaveBeenCalledWith("owner-verification");
    expect(remove).toHaveBeenCalledWith(["owner/application/identity/old.pdf"]);
  });

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

  it("creates a short-lived URL for the requested private object", async () => {
    const createSignedUrl = vi
      .fn()
      .mockReturnValue(
        result({ signedUrl: "https://storage.test/signed-document" }),
      );
    const from = vi.fn().mockReturnValue({ createSignedUrl });
    const storage = new SupabaseVerificationDocumentStorage({
      storage: { from },
    } as unknown as SupabaseClient);

    await expect(
      storage.createSignedUrl("owner/application/identity/document.pdf", 60),
    ).resolves.toBe("https://storage.test/signed-document");
    expect(from).toHaveBeenCalledWith("owner-verification");
    expect(createSignedUrl).toHaveBeenCalledWith(
      "owner/application/identity/document.pdf",
      60,
    );
  });
});
