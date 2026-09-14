import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolveContext } = vi.hoisted(() => ({ resolveContext: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/access/supabase-account-access", () => ({
  SupabaseAccountContextStore: class {
    resolve = resolveContext;
  },
}));

import { createRequestMessageTranslation } from "./request-message-translation";

const actorUserId = "11111111-1111-4111-8111-111111111111";
const messageId = "55555555-5555-4555-8555-555555555555";
const translationId = "66666666-6666-4666-8666-666666666666";
const commandId = "77777777-7777-4777-8777-777777777777";

describe("request message translation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveContext.mockResolvedValue({ userId: actorUserId, role: "customer" });
  });

  function identityClient() {
    return {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: actorUserId } },
          error: null,
        }),
      },
    };
  }

  it("derives the participant for translation and reporting", async () => {
    const repository = {
      prepare: vi.fn().mockResolvedValue({ status: "access-required" }),
      save: vi.fn(),
      report: vi
        .fn()
        .mockResolvedValue({ status: "reported", reportId: commandId }),
    };
    const adapter = { translate: vi.fn() };
    const service = createRequestMessageTranslation(
      identityClient() as never,
      repository,
      adapter,
      true,
    );

    await service.translate(messageId, "ar");
    await service.report(translationId, commandId, "incorrect");
    expect(repository.prepare).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId, messageId }),
    );
    expect(repository.report).toHaveBeenCalledWith({
      actorUserId,
      translationId,
      commandId,
      category: "incorrect",
    });
  });

  it("keeps support read-only even with multi-factor assurance", async () => {
    resolveContext.mockResolvedValue({
      userId: actorUserId,
      role: "platform_administrator",
    });
    const repository = { prepare: vi.fn(), save: vi.fn(), report: vi.fn() };
    const service = createRequestMessageTranslation(
      identityClient() as never,
      repository,
      { translate: vi.fn() },
      true,
    );

    await expect(service.translate(messageId, "ar")).resolves.toEqual({
      status: "access-required",
    });
    await expect(
      service.report(translationId, commandId, "incorrect"),
    ).resolves.toEqual({ status: "access-required" });
    expect(repository.prepare).not.toHaveBeenCalled();
    expect(repository.report).not.toHaveBeenCalled();
  });

  it("fails closed when authorization, storage, or the adapter throws", async () => {
    const repository = {
      prepare: vi.fn().mockRejectedValue(new Error("private detail")),
      save: vi.fn(),
      report: vi.fn().mockRejectedValue(new Error("private detail")),
    };
    const service = createRequestMessageTranslation(
      identityClient() as never,
      repository,
      { translate: vi.fn() },
      true,
    );
    await expect(service.translate(messageId, "ar")).resolves.toEqual({
      status: "unavailable",
    });
    await expect(
      service.report(translationId, commandId, "incorrect"),
    ).resolves.toEqual({ status: "unavailable" });

    repository.prepare.mockResolvedValue({
      status: "prepared",
      messageId,
      originalLanguage: "en",
      originalBody: "Could we use the garden?",
      contactProtected: true,
    });
    const adapterFailure = createRequestMessageTranslation(
      identityClient() as never,
      repository,
      { translate: vi.fn().mockRejectedValue(new Error("supplier detail")) },
      true,
    );
    await expect(adapterFailure.translate(messageId, "ar")).resolves.toEqual({
      status: "unavailable",
    });
  });
});
