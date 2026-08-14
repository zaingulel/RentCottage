import { describe, expect, it, vi } from "vitest";

import {
  createOwnerApplication,
  type OwnerApplicationRepository,
  type OwnerApplicationSnapshot,
  type VerificationDocumentStorage,
} from "./owner-application";

const emptySnapshot: OwnerApplicationSnapshot = {
  applicationId: "20000000-0000-0000-0000-000000000001",
  ownerUserId: "10000000-0000-0000-0000-000000000001",
  status: "draft",
  applicantKind: "individual",
  legalName: "",
  companyName: "",
  licensingBasis: "licence",
  exemptionBasis: "",
  cottage: {
    name: "",
    governorate: "",
    approximateLocation: "",
    exactAddress: "",
    capacity: null,
    bedrooms: null,
    bathrooms: null,
    amenities: [],
    description: "",
    houseRules: "",
  },
  documents: [],
  submittedAt: null,
};

const validPdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
function setup(snapshot: OwnerApplicationSnapshot | null = emptySnapshot) {
  const repository: OwnerApplicationRepository = {
    load: vi.fn().mockResolvedValue(snapshot),
    saveDraft: vi.fn().mockResolvedValue([]),
    missingItems: vi.fn().mockResolvedValue([]),
    submit: vi.fn().mockResolvedValue(undefined),
    prepareDocumentUpload: vi
      .fn()
      .mockResolvedValue("50000000-0000-4000-8000-000000000001"),
    registerDocument: vi.fn().mockResolvedValue({
      documentId: "40000000-0000-4000-8000-000000000001",
      previousObjectPath: null,
      previousCleanupId: null,
    }),
    reconcileDocumentRegistration: vi
      .fn()
      .mockResolvedValue({ status: "unregistered" }),
    prepareDocumentAccess: vi.fn().mockResolvedValue({
      grantId: "60000000-0000-4000-8000-000000000001",
      objectPath: "owner/application/identity/document.pdf",
    }),
    completeDocumentAccess: vi.fn().mockResolvedValue("completed"),
    completeDocumentCleanup: vi.fn().mockResolvedValue(undefined),
  };
  const storage: VerificationDocumentStorage = {
    upload: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    createSignedUrl: vi
      .fn()
      .mockResolvedValue("https://storage.test/signed-document"),
  };
  const diagnostics = { report: vi.fn() };

  return {
    repository,
    storage,
    diagnostics,
    application: createOwnerApplication({
      repository,
      storage,
      createId: () => "30000000-0000-0000-0000-000000000001",
      diagnostics,
    }),
  };
}

describe("Owner Application", () => {
  it("saves a partial Draft Owner Application for later visits", async () => {
    const { application, repository } = setup();

    await expect(
      application.saveDraft({
        applicantKind: "individual",
        legalName: "  Zana Kareem  ",
        companyName: "",
        licensingBasis: "licence",
        exemptionBasis: "",
        cottageName: "  Garden House ",
        governorate: "Erbil",
        approximateLocation: "",
        exactAddress: "",
        capacity: "",
        bedrooms: "",
        bathrooms: "",
        amenities: [" garden ", "parking"],
        description: "",
        houseRules: "",
      }),
    ).resolves.toEqual({ status: "saved" });

    expect(repository.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        legalName: "Zana Kareem",
        cottageName: "Garden House",
        capacity: null,
        amenities: ["garden", "parking"],
      }),
    );
  });

  it("removes evidence made obsolete by a saved draft choice", async () => {
    const { application, repository, storage } = setup();
    vi.mocked(repository.saveDraft).mockResolvedValue([
      {
        cleanupId: "50000000-0000-4000-8000-000000000003",
        objectPath: "owner/application/identity/obsolete.pdf",
      },
    ]);

    await expect(
      application.saveDraft({
        applicantKind: "company",
        legalName: "Representative",
        companyName: "Cottage Operations Ltd",
        licensingBasis: "licence",
        exemptionBasis: "",
        cottageName: "Garden House",
        governorate: "Erbil",
        approximateLocation: "Shaqlawa countryside",
        exactAddress: "Eastern orchard road",
        capacity: "8",
        bedrooms: "3",
        bathrooms: "2",
        amenities: ["garden"],
        description: "A quiet family cottage.",
        houseRules: "Families only.",
      }),
    ).resolves.toEqual({ status: "saved" });

    expect(storage.remove).toHaveBeenCalledWith([
      "owner/application/identity/obsolete.pdf",
    ]);
    expect(repository.completeDocumentCleanup).toHaveBeenCalledWith(
      "50000000-0000-4000-8000-000000000003",
    );
  });

  it("reports durable cleanup still pending after a draft choice changes", async () => {
    const { application, repository, storage } = setup();
    vi.mocked(repository.saveDraft).mockResolvedValue([
      {
        cleanupId: "50000000-0000-4000-8000-000000000003",
        objectPath: "owner/application/identity/obsolete.pdf",
      },
    ]);
    vi.mocked(storage.remove).mockRejectedValue(
      new Error("storage unavailable"),
    );

    await expect(
      application.saveDraft({
        applicantKind: "company",
        legalName: "Representative",
        companyName: "Cottage Operations Ltd",
        licensingBasis: "licence",
        exemptionBasis: "",
        cottageName: "Garden House",
        governorate: "Erbil",
        approximateLocation: "Shaqlawa countryside",
        exactAddress: "Eastern orchard road",
        capacity: "8",
        bedrooms: "3",
        bathrooms: "2",
        amenities: [],
        description: "Description",
        houseRules: "Rules",
      }),
    ).resolves.toEqual({ status: "saved_cleanup_required" });
    expect(repository.completeDocumentCleanup).not.toHaveBeenCalled();
  });

  it("reports a saved draft when obsolete-file deletion still needs auditing", async () => {
    const { application, repository } = setup();
    vi.mocked(repository.saveDraft).mockResolvedValue([
      {
        cleanupId: "50000000-0000-4000-8000-000000000003",
        objectPath: "owner/application/identity/obsolete.pdf",
      },
    ]);
    vi.mocked(repository.completeDocumentCleanup).mockRejectedValue(
      new Error("audit unavailable"),
    );

    await expect(
      application.saveDraft({
        applicantKind: "company",
        legalName: "Representative",
        companyName: "Cottage Operations Ltd",
        licensingBasis: "licence",
        exemptionBasis: "",
        cottageName: "Garden House",
        governorate: "Erbil",
        approximateLocation: "Area",
        exactAddress: "Address",
        capacity: "8",
        bedrooms: "3",
        bathrooms: "2",
        amenities: [],
        description: "Description",
        houseRules: "Rules",
      }),
    ).resolves.toEqual({ status: "saved_deletion_audit_required" });
  });

  it("rejects invalid field values before persistence", async () => {
    const { application, repository } = setup();

    await expect(
      application.saveDraft({
        applicantKind: "company",
        legalName: "Representative",
        companyName: "",
        licensingBasis: "licence",
        exemptionBasis: "",
        cottageName: "Cottage",
        governorate: "Erbil",
        approximateLocation: "Area",
        exactAddress: "Address",
        capacity: "0",
        bedrooms: "two",
        bathrooms: "1",
        amenities: [],
        description: "Description",
        houseRules: "Rules",
      }),
    ).resolves.toEqual({
      status: "invalid",
      fields: ["capacity", "bedrooms"],
    });
    expect(repository.saveDraft).not.toHaveBeenCalled();
  });

  it("rejects unbounded text before persistence", async () => {
    const { application, repository } = setup();

    await expect(
      application.saveDraft({
        applicantKind: "individual",
        legalName: "x".repeat(121),
        companyName: "",
        licensingBasis: "exemption",
        exemptionBasis: "Recorded local basis",
        cottageName: "Cottage",
        governorate: "Erbil",
        approximateLocation: "Area",
        exactAddress: "Address",
        capacity: "2",
        bedrooms: "1",
        bathrooms: "1",
        amenities: ["unknown"],
        description: "Description",
        houseRules: "Rules",
      }),
    ).resolves.toEqual({ status: "invalid", fields: ["legalName"] });
    expect(repository.saveDraft).not.toHaveBeenCalled();
  });

  it("rejects amenities outside the supported checklist", async () => {
    const { application, repository } = setup();

    await expect(
      application.saveDraft({
        applicantKind: "individual",
        legalName: "Zana Kareem",
        companyName: "",
        licensingBasis: "licence",
        exemptionBasis: "",
        cottageName: "Cottage",
        governorate: "Erbil",
        approximateLocation: "Area",
        exactAddress: "Address",
        capacity: "2",
        bedrooms: "1",
        bathrooms: "1",
        amenities: ["unknown"],
        description: "Description",
        houseRules: "Rules",
      }),
    ).resolves.toEqual({ status: "invalid", fields: ["amenities"] });
    expect(repository.saveDraft).not.toHaveBeenCalled();
  });

  it("returns every missing submission item without changing status", async () => {
    const { application, repository } = setup();
    vi.mocked(repository.missingItems).mockResolvedValue([
      "legal_name",
      "document:identity",
      "document:payout_account",
    ]);

    await expect(application.submit()).resolves.toEqual({
      status: "incomplete",
      missingItems: [
        "legal_name",
        "document:identity",
        "document:payout_account",
      ],
    });
    expect(repository.submit).not.toHaveBeenCalled();
  });

  it("submits a complete application and returns its durable state", async () => {
    const submitted = {
      ...emptySnapshot,
      status: "submitted" as const,
      submittedAt: "2026-08-14T10:00:00.000Z",
    };
    const { application, repository } = setup(emptySnapshot);
    vi.mocked(repository.load).mockResolvedValueOnce(submitted);

    await expect(application.submit()).resolves.toEqual({
      status: "submitted",
      application: submitted,
    });
    expect(repository.submit).toHaveBeenCalledOnce();
  });

  it.each([
    {
      name: "script.svg",
      type: "image/svg+xml",
      size: 200,
      bytes: new Uint8Array(8),
    },
    {
      name: "empty.pdf",
      type: "application/pdf",
      size: 0,
      bytes: new Uint8Array(1),
    },
    {
      name: "large.pdf",
      type: "application/pdf",
      size: 5_242_881,
      bytes: new Uint8Array(5_242_881),
    },
  ])("rejects unsafe verification upload $name", async (file) => {
    const { application, storage } = setup();

    await expect(
      application.uploadDocument("identity", {
        ...file,
      }),
    ).resolves.toEqual({ status: "invalid_document" });
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("rejects a document whose bytes do not match its declared media type", async () => {
    const { application, repository, storage } = setup();

    await expect(
      application.uploadDocument("identity", {
        name: "script.pdf",
        type: "application/pdf",
        size: 6,
        bytes: new Uint8Array([0x3c, 0x73, 0x63, 0x72, 0x69, 0x70]),
      }),
    ).resolves.toEqual({ status: "invalid_document" });
    expect(repository.prepareDocumentUpload).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("accepts a JPEG with bytes after its end-of-image marker", async () => {
    const { application, storage } = setup();
    const jpegWithTrailingMetadata = new Uint8Array([
      0xff, 0xd8, 0xff, 0xdb, 0xff, 0xd9, 0x00, 0x01,
    ]);

    await expect(
      application.uploadDocument("identity", {
        name: "passport.jpg",
        type: "image/jpeg",
        size: jpegWithTrailingMetadata.byteLength,
        bytes: jpegWithTrailingMetadata,
      }),
    ).resolves.toEqual({ status: "uploaded" });
    expect(storage.upload).toHaveBeenCalledOnce();
  });

  it("uses the production UUID generator with its Crypto receiver", async () => {
    const { repository, storage } = setup();
    const strictCrypto = {
      randomUUID(this: unknown) {
        if (this !== strictCrypto) throw new TypeError("Illegal invocation");
        return "30000000-0000-4000-8000-000000000001";
      },
    };
    vi.stubGlobal("crypto", strictCrypto);
    const application = createOwnerApplication({ repository, storage });

    try {
      await expect(
        application.uploadDocument("identity", {
          name: "passport.pdf",
          type: "application/pdf",
          size: validPdf.byteLength,
          bytes: validPdf,
        }),
      ).resolves.toEqual({ status: "uploaded" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uploads a private document and removes the replaced object", async () => {
    const { application, repository, storage } = setup();
    vi.mocked(repository.registerDocument).mockResolvedValue({
      documentId: "40000000-0000-4000-8000-000000000001",
      previousObjectPath: "owner/application/identity/old.pdf",
      previousCleanupId: "50000000-0000-4000-8000-000000000002",
    });

    await expect(
      application.uploadDocument("identity", {
        name: " passport.PDF ",
        type: "application/pdf",
        size: validPdf.byteLength,
        bytes: validPdf,
      }),
    ).resolves.toEqual({ status: "uploaded" });

    expect(storage.upload).toHaveBeenCalledWith(
      "10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000001/identity/30000000-0000-0000-0000-000000000001.pdf",
      expect.objectContaining({ type: "application/pdf" }),
    );
    expect(repository.prepareDocumentUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "identity",
        originalFilename: "passport.PDF",
        sizeBytes: validPdf.byteLength,
      }),
    );
    expect(repository.registerDocument).toHaveBeenCalledWith(
      "50000000-0000-4000-8000-000000000001",
    );
    expect(
      vi.mocked(repository.prepareDocumentUpload).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(storage.upload).mock.invocationCallOrder[0]);
    expect(storage.remove).toHaveBeenCalledWith([
      "owner/application/identity/old.pdf",
    ]);
    expect(repository.completeDocumentCleanup).toHaveBeenCalledWith(
      "50000000-0000-4000-8000-000000000002",
    );
  });

  it("cleans up a new object when metadata registration fails", async () => {
    const { application, repository, storage } = setup();
    vi.mocked(repository.registerDocument).mockRejectedValue(
      new Error("database unavailable"),
    );

    await expect(
      application.uploadDocument("identity", {
        name: "passport.pdf",
        type: "application/pdf",
        size: validPdf.byteLength,
        bytes: validPdf,
      }),
    ).resolves.toEqual({ status: "unavailable" });
    expect(storage.remove).toHaveBeenCalledWith([
      "10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000001/identity/30000000-0000-0000-0000-000000000001.pdf",
    ]);
  });

  it("keeps a registered object when the commit response is lost", async () => {
    const { application, repository, storage } = setup();
    vi.mocked(repository.registerDocument).mockRejectedValue(
      new Error("response lost after commit"),
    );
    vi.mocked(repository.reconcileDocumentRegistration).mockResolvedValue({
      status: "registered",
      documentId: "40000000-0000-4000-8000-000000000001",
      previousObjectPath: "owner/application/identity/old.pdf",
      previousCleanupId: "50000000-0000-4000-8000-000000000002",
    });

    await expect(
      application.uploadDocument("identity", {
        name: "passport.pdf",
        type: "application/pdf",
        size: validPdf.byteLength,
        bytes: validPdf,
      }),
    ).resolves.toEqual({ status: "uploaded" });
    expect(storage.remove).toHaveBeenCalledTimes(1);
    expect(storage.remove).toHaveBeenCalledWith([
      "owner/application/identity/old.pdf",
    ]);
  });

  it("does not delete an object while registration outcome is unknown", async () => {
    const { application, repository, storage, diagnostics } = setup();
    vi.mocked(repository.registerDocument).mockRejectedValue(
      new Error("response lost"),
    );
    vi.mocked(repository.reconcileDocumentRegistration).mockRejectedValue(
      new Error("database unavailable"),
    );

    await expect(
      application.uploadDocument("identity", {
        name: "passport.pdf",
        type: "application/pdf",
        size: validPdf.byteLength,
        bytes: validPdf,
      }),
    ).resolves.toEqual({ status: "registration_reconciliation_required" });
    expect(storage.remove).not.toHaveBeenCalled();
    expect(diagnostics.report).toHaveBeenCalledWith(
      "document_registration_reconciliation_failed",
      {
        cleanupId: "50000000-0000-4000-8000-000000000001",
        documentKind: "identity",
      },
      expect.any(Error),
    );
  });

  it("reports when an unregistered object cannot be cleaned up", async () => {
    const { application, repository, storage } = setup();
    vi.mocked(repository.registerDocument).mockRejectedValue(
      new Error("database unavailable"),
    );
    vi.mocked(storage.remove).mockRejectedValue(
      new Error("storage unavailable"),
    );

    await expect(
      application.uploadDocument("identity", {
        name: "passport.pdf",
        type: "application/pdf",
        size: validPdf.byteLength,
        bytes: validPdf,
      }),
    ).resolves.toEqual({ status: "failed_cleanup_required" });
  });

  it("reports a truthful replacement result when old-file cleanup fails", async () => {
    const { application, repository, storage } = setup();
    vi.mocked(repository.registerDocument).mockResolvedValue({
      documentId: "40000000-0000-4000-8000-000000000001",
      previousObjectPath: "owner/application/identity/old.pdf",
      previousCleanupId: "50000000-0000-4000-8000-000000000002",
    });
    vi.mocked(storage.remove).mockRejectedValue(
      new Error("storage unavailable"),
    );

    await expect(
      application.uploadDocument("identity", {
        name: "passport.pdf",
        type: "application/pdf",
        size: validPdf.byteLength,
        bytes: validPdf,
      }),
    ).resolves.toEqual({ status: "uploaded_cleanup_required" });
    expect(repository.completeDocumentCleanup).not.toHaveBeenCalled();
  });

  it("reports when a completed deletion cannot be audited", async () => {
    const { application, repository } = setup();
    vi.mocked(repository.registerDocument).mockResolvedValue({
      documentId: "40000000-0000-4000-8000-000000000001",
      previousObjectPath: "owner/application/identity/old.pdf",
      previousCleanupId: "50000000-0000-4000-8000-000000000002",
    });
    vi.mocked(repository.completeDocumentCleanup).mockRejectedValue(
      new Error("audit unavailable"),
    );

    await expect(
      application.uploadDocument("identity", {
        name: "passport.pdf",
        type: "application/pdf",
        size: validPdf.byteLength,
        bytes: validPdf,
      }),
    ).resolves.toEqual({ status: "uploaded_deletion_audit_required" });
  });

  it("returns no private URL when access preparation fails", async () => {
    const { application, repository, storage } = setup();
    vi.mocked(repository.prepareDocumentAccess).mockRejectedValue(
      new Error("audit unavailable"),
    );

    await expect(
      application.createDocumentAccess("40000000-0000-4000-8000-000000000001"),
    ).resolves.toEqual({ status: "unavailable" });
    expect(storage.createSignedUrl).not.toHaveBeenCalled();
  });

  it("withholds a created private URL when its access audit cannot be recorded", async () => {
    const { application, repository, storage } = setup();
    vi.mocked(repository.completeDocumentAccess).mockRejectedValue(
      new Error("audit unavailable"),
    );

    await expect(
      application.createDocumentAccess("40000000-0000-4000-8000-000000000001"),
    ).resolves.toEqual({ status: "unavailable" });
    expect(storage.createSignedUrl).toHaveBeenCalledWith(
      "owner/application/identity/document.pdf",
      60,
    );
    expect(repository.completeDocumentAccess).toHaveBeenCalledWith(
      "60000000-0000-4000-8000-000000000001",
      60,
    );
  });

  it("withholds a signed URL when its prepared grant expired", async () => {
    const { application, repository, storage } = setup();
    vi.mocked(repository.completeDocumentAccess).mockResolvedValue("expired");

    await expect(
      application.createDocumentAccess("40000000-0000-4000-8000-000000000001"),
    ).resolves.toEqual({ status: "unavailable" });
    expect(storage.createSignedUrl).toHaveBeenCalledWith(
      "owner/application/identity/document.pdf",
      60,
    );
    expect(repository.completeDocumentAccess).toHaveBeenCalledWith(
      "60000000-0000-4000-8000-000000000001",
      60,
    );
  });

  it("returns an audited URL that expires after 60 seconds", async () => {
    const { application, repository, storage } = setup();

    await expect(
      application.createDocumentAccess("40000000-0000-4000-8000-000000000001"),
    ).resolves.toEqual({
      status: "ready",
      url: "https://storage.test/signed-document",
      expiresInSeconds: 60,
    });
    expect(repository.prepareDocumentAccess).toHaveBeenCalledWith(
      "40000000-0000-4000-8000-000000000001",
    );
    expect(storage.createSignedUrl).toHaveBeenCalledWith(
      "owner/application/identity/document.pdf",
      60,
    );
    expect(repository.completeDocumentAccess).toHaveBeenCalledWith(
      "60000000-0000-4000-8000-000000000001",
      60,
    );
    expect(
      vi.mocked(storage.createSignedUrl).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(repository.completeDocumentAccess).mock.invocationCallOrder[0],
    );
  });
});
