import { describe, expect, it, vi } from "vitest";

import { createMessaging } from "./messaging";

const customerId = "11111111-1111-4111-8111-111111111111";
const profileId = "22222222-2222-4222-8222-222222222222";
const conversationId = "33333333-3333-4333-8333-333333333333";
const commandId = "44444444-4444-4444-8444-444444444444";

describe("messaging", () => {
  it("forwards a validated cottage journey identity to the repository", async () => {
    const repository = {
      createConversation: vi.fn().mockResolvedValue({
        status: "created",
        conversationId,
      }),
      openBookingConversation: vi.fn(),
      send: vi.fn(),
    };
    const messaging = createMessaging(repository);

    await expect(
      messaging.createConversation({
        actorUserId: customerId,
        profileId,
        commandId,
      }),
    ).resolves.toEqual({ status: "created", conversationId });
    expect(repository.createConversation).toHaveBeenCalledWith({
      actorUserId: customerId,
      profileId,
      commandId,
    });
  });

  it("forwards a validated retained booking journey to the repository", async () => {
    const repository = {
      createConversation: vi.fn(),
      openBookingConversation: vi.fn().mockResolvedValue({
        status: "created",
        conversationId,
      }),
      send: vi.fn(),
    };
    const messaging = createMessaging(repository);

    await expect(
      messaging.openBookingConversation({
        actorUserId: customerId,
        bookingRequestReference: "RC-REQ-0123456789ABCDEF",
        commandId,
      }),
    ).resolves.toEqual({ status: "created", conversationId });
    expect(repository.openBookingConversation).toHaveBeenCalledWith({
      actorUserId: customerId,
      bookingRequestReference: "RC-REQ-0123456789ABCDEF",
      commandId,
    });
  });

  it("trims surrounding whitespace at the service boundary", async () => {
    const repository = {
      createConversation: vi.fn(),
      openBookingConversation: vi.fn(),
      send: vi.fn().mockResolvedValue({
        status: "sent",
        messageId: "55555555-5555-4555-8555-555555555555",
      }),
    };
    const messaging = createMessaging(repository);

    await expect(
      messaging.send({
        actorUserId: customerId,
        conversationId,
        commandId,
        originalLanguage: "en",
        originalBody: "  padded  ",
      }),
    ).resolves.toEqual({
      status: "sent",
      messageId: "55555555-5555-4555-8555-555555555555",
    });
    expect(repository.send).toHaveBeenCalledWith(
      expect.objectContaining({ originalBody: "padded" }),
    );
  });

  it("passes message text to the database for authoritative contact admission", async () => {
    const repository = {
      createConversation: vi.fn(),
      openBookingConversation: vi.fn(),
      send: vi.fn().mockResolvedValue({
        status: "blocked",
        reason: "contact-restricted",
      }),
    };
    const messaging = createMessaging(repository);
    const input = {
      actorUserId: customerId,
      conversationId,
      commandId,
      originalLanguage: "ckb" as const,
      originalBody: "ژمارەکەم ۰۷۵۰ ۱۲۳ ۴۵۶۷",
    };

    await expect(messaging.send(input)).resolves.toEqual({
      status: "blocked",
      reason: "contact-restricted",
    });
    expect(repository.send).toHaveBeenCalledWith(input);
  });
});
