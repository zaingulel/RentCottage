import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolveContext } = vi.hoisted(() => ({ resolveContext: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/access/supabase-account-access", () => ({
  SupabaseAccountContextStore: class {
    resolve = resolveContext;
  },
}));

import { createRequestMessaging } from "./request-messaging";

const userId = "11111111-1111-4111-8111-111111111111";
const profileId = "22222222-2222-4222-8222-222222222222";
const conversationId = "33333333-3333-4333-8333-333333333333";
const commandId = "44444444-4444-4444-8444-444444444444";

describe("request messaging", () => {
  beforeEach(() => vi.clearAllMocks());

  it("derives the actor from getUser for each service-only mutation", async () => {
    const identityClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: userId } },
          error: null,
        }),
      },
    };
    resolveContext.mockResolvedValue({ userId, role: "customer" });
    const repository = {
      createConversation: vi
        .fn()
        .mockResolvedValue({ status: "created", conversationId }),
      openBookingConversation: vi
        .fn()
        .mockResolvedValue({ status: "created", conversationId }),
      send: vi.fn().mockResolvedValue({
        status: "sent",
        messageId: "55555555-5555-4555-8555-555555555555",
      }),
    };
    const messaging = createRequestMessaging(
      identityClient as never,
      repository,
    );

    await messaging.createConversation(profileId, commandId);
    await messaging.openBookingConversation(
      "RC-REQ-0123456789ABCDEF",
      commandId,
    );
    await messaging.send({
      conversationId,
      commandId,
      originalLanguage: "en",
      originalBody: "Please prepare the garden.",
    });

    expect(identityClient.auth.getUser).toHaveBeenCalledTimes(3);
    expect(repository.createConversation).toHaveBeenCalledWith({
      actorUserId: userId,
      profileId,
      commandId,
    });
    expect(repository.send).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: userId, conversationId }),
    );
    expect(repository.openBookingConversation).toHaveBeenCalledWith({
      actorUserId: userId,
      bookingRequestReference: "RC-REQ-0123456789ABCDEF",
      commandId,
    });
  });

  it("overwrites a forged runtime actor with the authenticated user", async () => {
    const identityClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: userId } },
          error: null,
        }),
      },
    };
    resolveContext.mockResolvedValue({ userId, role: "customer" });
    const repository = {
      createConversation: vi.fn(),
      openBookingConversation: vi.fn(),
      send: vi.fn().mockResolvedValue({
        status: "sent",
        messageId: "55555555-5555-4555-8555-555555555555",
      }),
    };
    const messaging = createRequestMessaging(
      identityClient as never,
      repository,
    );

    await messaging.send({
      conversationId,
      commandId,
      originalLanguage: "en",
      originalBody: "Please prepare the garden.",
      actorUserId: "99999999-9999-4999-8999-999999999999",
    } as never);

    expect(repository.send).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: userId }),
    );
  });

  it("does not expose mutation methods to administrators", async () => {
    const identityClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: userId } },
          error: null,
        }),
      },
    };
    resolveContext.mockResolvedValue({
      userId,
      role: "platform_administrator",
    });
    const repository = {
      createConversation: vi.fn(),
      openBookingConversation: vi.fn(),
      send: vi.fn(),
    };
    const messaging = createRequestMessaging(
      identityClient as never,
      repository,
    );

    await expect(
      messaging.createConversation(profileId, commandId),
    ).resolves.toEqual({
      status: "access-required",
    });
    expect(repository.createConversation).not.toHaveBeenCalled();
    await expect(
      messaging.openBookingConversation("RC-REQ-0123456789ABCDEF", commandId),
    ).resolves.toEqual({ status: "access-required" });
    expect(repository.openBookingConversation).not.toHaveBeenCalled();
  });

  it("rejects a mismatched authenticated identity and account context", async () => {
    const identityClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: userId } },
          error: null,
        }),
      },
    };
    resolveContext.mockResolvedValue({
      userId: "99999999-9999-4999-8999-999999999999",
      role: "customer",
    });
    const repository = {
      createConversation: vi.fn(),
      openBookingConversation: vi.fn(),
      send: vi.fn(),
    };

    await expect(
      createRequestMessaging(
        identityClient as never,
        repository,
      ).createConversation(profileId, commandId),
    ).resolves.toEqual({ status: "access-required" });
    expect(repository.createConversation).not.toHaveBeenCalled();
  });
});
