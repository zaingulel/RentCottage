import { describe, expect, it, vi } from "vitest";

import { SupabaseMessagingReader } from "./supabase-messaging-reader";

const conversationId = "33333333-3333-4333-8333-333333333333";
const messageId = "55555555-5555-4555-8555-555555555555";

const booking = {
  bookingRequestReference: "RC-REQ-0123456789ABCDEF",
  requestStatus: "accepted",
  paymentStatus: "paid-confirmed",
  responseDeadline: "2099-08-21T18:00:00.000Z",
  firstStartsAt: "2099-08-21T17:00:00.000Z",
  lastEndsAt: "2099-08-21T21:00:00.000Z",
  writingClosesAt: "2099-09-20T21:00:00.000Z",
  writingClosed: false,
  contactAllowed: true,
};

const header = {
  conversationId,
  cottage: {
    profileId: "22222222-2222-4222-8222-222222222222",
    name: "Fictional Garden Cottage",
    publicSlug: "cottage-00000000000040008000000000000029",
  },
  actorRole: "customer",
  createdAt: "2099-08-20T12:00:00.000Z",
  canContinueBookingRequest: true,
  booking,
  bookingHistory: [booking],
  messageCount: 1,
};

describe("Supabase messaging reader", () => {
  it("parses a bounded conversation page and forwards its position cursor", async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: {
          ...header,
          messages: [
            {
              messageId,
              senderRole: "customer",
              originalLanguage: "en",
              originalBody: "Could you prepare the garden?",
              contactProtected: false,
              translations: [
                {
                  translationId: "66666666-6666-4666-8666-666666666666",
                  targetLanguage: "ar",
                  translatedBody: "هل يمكنك تجهيز الحديقة؟",
                  provider: "fictional-local-test",
                  model: "deterministic-pairs-v1",
                  promptVersion: "message-pairs-v1",
                },
              ],
              sentAt: "2099-08-20T12:01:00.000Z",
            },
          ],
          nextMessageCursor: 7,
        },
        error: null,
      }),
    };

    await expect(
      new SupabaseMessagingReader(client as never).getConversation({
        conversationId,
        beforePosition: 9,
        limit: 20,
      }),
    ).resolves.toMatchObject({
      nextMessageCursor: 7,
      messages: [{ messageId, translations: [{ targetLanguage: "ar" }] }],
    });
    expect(client.rpc).toHaveBeenCalledWith("get_messaging_conversation", {
      target_conversation_id: conversationId,
      target_before_position: 9,
      target_limit: 20,
    });
  });

  it("parses inbox keyset pagination without requiring message bodies", async () => {
    const activityAt = "2099-08-20T12:01:00.000Z";
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: {
          items: [
            {
              ...header,
              activityAt,
              preview: {
                originalBody: "Could you prepare the garden?",
                originalLanguage: "en",
              },
            },
          ],
          nextCursor: { activityAt, conversationId },
        },
        error: null,
      }),
    };

    await expect(
      new SupabaseMessagingReader(client as never).listConversations({
        cursor: { activityAt, conversationId },
        limit: 10,
        publicSlug: "cottage-0123456789abcdef0123456789abcdef",
      }),
    ).resolves.toMatchObject({
      items: [{ conversationId, messageCount: 1 }],
      nextCursor: { activityAt, conversationId },
    });
    expect(client.rpc).toHaveBeenCalledWith("list_messaging_conversations", {
      target_cursor_activity_at: activityAt,
      target_cursor_conversation_id: conversationId,
      target_limit: 10,
      target_public_slug: "cottage-0123456789abcdef0123456789abcdef",
    });
  });

  it("fails closed on inconsistent paid booking facts", async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: {
          ...header,
          booking: { ...booking, lastEndsAt: null, writingClosed: false },
          messages: [],
          nextMessageCursor: null,
        },
        error: null,
      }),
    };

    await expect(
      new SupabaseMessagingReader(client as never).getConversation({
        conversationId,
        limit: 20,
      }),
    ).rejects.toThrow(/invalid messaging conversation/i);
  });
});
