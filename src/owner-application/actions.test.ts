import { beforeEach, describe, expect, it, vi } from "vitest";

const { application, createRequestClient, revalidatePath, rpc } = vi.hoisted(
  () => ({
    application: {
      saveDraft: vi.fn(),
      uploadDocument: vi.fn(),
      submit: vi.fn(),
      createDocumentAccess: vi.fn(),
    },
    createRequestClient: vi.fn(),
    revalidatePath: vi.fn(),
    rpc: vi.fn(),
  }),
);

vi.mock("./request-owner-application", () => ({
  createRequestOwnerApplication: vi.fn().mockResolvedValue(application),
}));

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/access/supabase-server", () => ({
  createRequestSupabaseClient: createRequestClient,
}));

import {
  createOwnerDocumentAccessAction,
  respondToOwnerApplicationAction,
  saveOwnerApplicationAction,
  submitOwnerApplicationRenewalAction,
  submitOwnerApplicationAction,
  uploadOwnerDocumentAction,
} from "./actions";

function completeForm() {
  const form = new FormData();
  form.set("locale", "en");
  form.set("applicantKind", "individual");
  form.set("legalName", "Zana Kareem");
  form.set("companyName", "");
  form.set("licensingBasis", "licence");
  form.set("exemptionBasis", "");
  form.set("cottageName", "Garden House");
  form.set("governorate", "Erbil");
  form.set("approximateLocation", "Shaqlawa countryside");
  form.set("exactAddress", "Eastern orchard road");
  form.set("capacity", "8");
  form.set("bedrooms", "3");
  form.set("bathrooms", "2");
  form.append("amenities", "garden");
  form.append("amenities", "parking");
  form.set("description", "A quiet family cottage.");
  form.set("houseRules", "Families only.");
  return form;
}

describe("Owner Application server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createRequestClient.mockResolvedValue({ rpc });
  });

  it("saves the visible draft fields and refreshes the owner page", async () => {
    application.saveDraft.mockResolvedValue({ status: "saved" });

    await expect(
      saveOwnerApplicationAction({ status: "idle" }, completeForm()),
    ).resolves.toEqual({ status: "saved" });
    expect(application.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        cottageName: "Garden House",
        capacity: "8",
        amenities: ["garden", "parking"],
        licensingBasis: "licence",
        exemptionBasis: "",
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/en/owner/application");
  });

  it("returns submitted values when a draft is invalid", async () => {
    application.saveDraft.mockResolvedValue({
      status: "invalid",
      fields: ["capacity"],
    });
    const form = completeForm();
    form.set("capacity", "101");

    await expect(
      saveOwnerApplicationAction({ status: "idle" }, form),
    ).resolves.toEqual({
      status: "invalid",
      fields: ["capacity"],
      values: expect.objectContaining({
        legalName: "Zana Kareem",
        capacity: "101",
        amenities: ["garden", "parking"],
      }),
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refreshes a saved draft when evidence cleanup remains pending", async () => {
    application.saveDraft.mockResolvedValue({
      status: "saved_cleanup_required",
    });

    await expect(
      saveOwnerApplicationAction({ status: "idle" }, completeForm()),
    ).resolves.toEqual({ status: "saved_cleanup_required" });
    expect(revalidatePath).toHaveBeenCalledWith("/en/owner/application");
  });

  it("passes document bytes through the private upload seam", async () => {
    application.uploadDocument.mockResolvedValue({ status: "uploaded" });
    const form = new FormData();
    form.set("locale", "en");
    form.set("kind", "identity");
    form.set(
      "document",
      new File([new Uint8Array([1, 2, 3])], "passport.pdf", {
        type: "application/pdf",
      }),
    );

    await expect(
      uploadOwnerDocumentAction({ status: "idle" }, form),
    ).resolves.toEqual({ status: "uploaded" });
    expect(application.uploadDocument).toHaveBeenCalledWith(
      "identity",
      expect.objectContaining({
        name: "passport.pdf",
        type: "application/pdf",
        size: 3,
        bytes: new Uint8Array([1, 2, 3]),
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/en/owner/application");
  });

  it("reports a missing locale without blaming the document", async () => {
    const form = new FormData();
    form.set(
      "document",
      new File([new Uint8Array([1])], "passport.pdf", {
        type: "application/pdf",
      }),
    );

    await expect(
      uploadOwnerDocumentAction({ status: "idle" }, form),
    ).resolves.toEqual({ status: "unavailable" });
    expect(application.uploadDocument).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("reports a missing document as invalid without calling the domain", async () => {
    const form = new FormData();
    form.set("locale", "en");

    await expect(
      uploadOwnerDocumentAction({ status: "idle" }, form),
    ).resolves.toEqual({ status: "invalid_document" });
    expect(application.uploadDocument).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects an oversized document before reading or calling the domain", async () => {
    const document = new File([new Uint8Array(5_242_881)], "large.pdf", {
      type: "application/pdf",
    });
    const arrayBuffer = vi.spyOn(document, "arrayBuffer");
    const form = new FormData();
    form.set("locale", "en");
    form.set("kind", "identity");
    form.set("document", document);

    await expect(
      uploadOwnerDocumentAction({ status: "idle" }, form),
    ).resolves.toEqual({ status: "invalid_document" });
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(application.uploadDocument).not.toHaveBeenCalled();
  });

  it.each([
    "uploaded_cleanup_required",
    "uploaded_deletion_audit_required",
    "registration_reconciliation_required",
  ] as const)("refreshes durable metadata for %s", async (status) => {
    application.uploadDocument.mockResolvedValue({ status });
    const form = new FormData();
    form.set("locale", "en");
    form.set("kind", "identity");
    form.set(
      "document",
      new File([new Uint8Array([1])], "passport.pdf", {
        type: "application/pdf",
      }),
    );

    await uploadOwnerDocumentAction({ status: "idle" }, form);

    expect(revalidatePath).toHaveBeenCalledWith("/en/owner/application");
  });

  it("returns exact missing items from submission", async () => {
    application.submit.mockResolvedValue({
      status: "incomplete",
      missingItems: ["legal_name", "document:identity"],
    });
    const form = new FormData();
    form.set("locale", "en");

    await expect(
      submitOwnerApplicationAction({ status: "idle" }, form),
    ).resolves.toEqual({
      status: "incomplete",
      missingItems: ["legal_name", "document:identity"],
    });
  });

  it("returns only an audited signed document result", async () => {
    application.createDocumentAccess.mockResolvedValue({
      status: "ready",
      url: "https://storage.test/signed-document",
      expiresInSeconds: 60,
    });
    const form = new FormData();
    form.set("documentId", "40000000-0000-4000-8000-000000000001");

    await expect(
      createOwnerDocumentAccessAction({ status: "idle" }, form),
    ).resolves.toEqual({
      status: "ready",
      url: "https://storage.test/signed-document",
      expiresInSeconds: 60,
    });
  });

  it.each([undefined, "", "3.5"])(
    "maps requested capacity %# to invalid without calling the provider",
    async (capacity) => {
      const form = new FormData();
      form.set("locale", "en");
      form.set("expectedVersion", "3");
      form.set("requestedField", "capacity");
      if (capacity !== undefined) form.set("capacity", capacity);

      await expect(
        respondToOwnerApplicationAction({ status: "idle" }, form),
      ).resolves.toEqual({ status: "invalid" });
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it("preserves a stale information response as a conflict", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "RC409" } });
    const form = new FormData();
    form.set("locale", "en");
    form.set("expectedVersion", "3");
    form.set("requestedField", "exact_address");
    form.set("exact_address", "Renewed private road");

    await expect(
      respondToOwnerApplicationAction({ status: "idle" }, form),
    ).resolves.toEqual({ status: "conflict" });
  });

  it("keeps an information-response provider outage private and unavailable", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "XX000", message: "private provider detail" },
    });
    const form = new FormData();
    form.set("locale", "en");
    form.set("expectedVersion", "3");
    form.set("requestedField", "exact_address");
    form.set("exact_address", "Renewed private road");

    await expect(
      respondToOwnerApplicationAction({ status: "idle" }, form),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("maps an empty renewal scope to invalid without calling the provider", async () => {
    const form = new FormData();
    form.set("locale", "en");
    form.set("expectedVersion", "8");

    await expect(
      submitOwnerApplicationRenewalAction({ status: "idle" }, form),
    ).resolves.toEqual({ status: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });
});
