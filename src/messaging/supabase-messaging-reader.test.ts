import { describe, expect, it, vi } from "vitest";

import { SupabaseMessagingReader } from "./supabase-messaging-reader";

const conversationId = "33333333-3333-4333-8333-333333333333";
const messageId = "55555555-5555-4555-8555-555555555555";

const booking = {
  bookingRequestReference: "RC-REQ-0123456789ABCDEF",
  requestStatus: "accepted",
  paymentStatus: "paid-confirmed",
  lifecycleStatus: "confirmed",
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
  sendRestriction: null,
  createdAt: "2099-08-20T12:00:00.000Z",
  canContinueBookingRequest: true,
  booking,
  bookingHistory: [booking],
  messageCount: 1,
};

describe("Supabase messaging reader", () => {
  it("requires a finite customer-correlated send restriction in conversation and inbox reads", async () => {
    for (const actorRole of [
      "customer",
      "cottage_owner",
      "platform_administrator",
    ]) {
      for (const sendRestriction of [
        null,
        "customer-suspended",
        undefined,
        "unknown",
        false,
      ]) {
        const valid =
          sendRestriction === null ||
          (actorRole === "customer" &&
            sendRestriction === "customer-suspended");
        const restrictedHeader = {
          ...header,
          actorRole,
          sendRestriction,
          canContinueBookingRequest: false,
        };
        const client = { rpc: vi.fn() };
        const reader = new SupabaseMessagingReader(client as never);
        client.rpc.mockResolvedValue({
          data: { ...restrictedHeader, messages: [], nextMessageCursor: null },
          error: null,
        });
        const result = reader.getConversation({ conversationId, limit: 20 });
        if (valid)
          await expect(result).resolves.toMatchObject({
            actorRole,
            sendRestriction,
          });
        else
          await expect(result).rejects.toThrow(
            "Database returned an invalid messaging conversation",
          );
        client.rpc.mockResolvedValue({
          data: {
            items: [
              {
                ...restrictedHeader,
                activityAt: header.createdAt,
                preview: null,
              },
            ],
            nextCursor: null,
          },
          error: null,
        });
        const inbox = reader.listConversations({ limit: 20 });
        if (valid)
          await expect(inbox).resolves.toMatchObject({
            items: [{ actorRole, sendRestriction }],
          });
        else
          await expect(inbox).rejects.toThrow(
            "Database returned an invalid messaging inbox",
          );
      }
    }
  });

  it("refuses an optimistic booking continuation for a suspended customer", async () => {
    const client = {
      rpc: vi
        .fn()
        .mockResolvedValue({
          data: {
            ...header,
            sendRestriction: "customer-suspended",
            canContinueBookingRequest: true,
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
    ).rejects.toThrow("Database returned an invalid messaging conversation");
  });

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

  it("validates lifecycle statuses in current and historical messaging bookings", async () => {
    const bookings = [
      ...[
        "confirmed",
        "completed",
        "no_show",
        "cancelled",
        "incident_pending",
      ].map((lifecycleStatus) => ({ ...booking, lifecycleStatus })),
      {
        ...booking,
        lifecycleStatus: null,
        paymentStatus: null,
        contactAllowed: false,
        firstStartsAt: null,
        lastEndsAt: null,
        writingClosesAt: null,
      },
    ];
    for (const validBooking of bookings) {
      const validHeader = {
        ...header,
        booking: validBooking,
        bookingHistory: [validBooking],
      };
      const client = { rpc: vi.fn() };
      const reader = new SupabaseMessagingReader(client as never);
      client.rpc.mockResolvedValue({
        data: { ...validHeader, messages: [], nextMessageCursor: null },
        error: null,
      });
      await expect(
        reader.getConversation({ conversationId, limit: 20 }),
      ).resolves.toMatchObject({
        booking: validBooking,
        bookingHistory: [validBooking],
      });
      client.rpc.mockResolvedValue({
        data: {
          items: [
            { ...validHeader, activityAt: header.createdAt, preview: null },
          ],
          nextCursor: null,
        },
        error: null,
      });
      await expect(
        reader.listConversations({ limit: 20 }),
      ).resolves.toMatchObject({
        items: [{ booking: validBooking, bookingHistory: [validBooking] }],
      });
    }
  });

  it("rejects corrupt lifecycle statuses in messaging reads", async () => {
    const missingLifecycle = { ...booking } as Partial<typeof booking>;
    delete missingLifecycle.lifecycleStatus;
    const invalidBookings = [
      missingLifecycle,
      ...[undefined, "unknown", "<script>alert(1)</script>", {}, 7].map(
        (lifecycleStatus) => ({ ...booking, lifecycleStatus }),
      ),
      { ...booking, lifecycleStatus: null },
      { ...booking, contactAllowed: false },
      ...["firstStartsAt", "lastEndsAt", "writingClosesAt"].map((field) => ({
        ...booking,
        paymentStatus: "capture-processing",
        [field]: null,
      })),
    ];
    for (const invalidBooking of invalidBookings) {
      for (const position of ["current", "historical"]) {
        const invalidHeader = {
          ...header,
          booking: position === "current" ? invalidBooking : booking,
          bookingHistory: [
            position === "historical" ? invalidBooking : booking,
          ],
        };
        const client = { rpc: vi.fn() };
        const reader = new SupabaseMessagingReader(client as never);
        client.rpc.mockResolvedValue({
          data: { ...invalidHeader, messages: [], nextMessageCursor: null },
          error: null,
        });
        await expect(
          reader.getConversation({ conversationId, limit: 20 }),
        ).rejects.toThrow(
          "Database returned an invalid messaging conversation",
        );
        client.rpc.mockResolvedValue({
          data: {
            items: [
              { ...invalidHeader, activityAt: header.createdAt, preview: null },
            ],
            nextCursor: null,
          },
          error: null,
        });
        await expect(reader.listConversations({ limit: 20 })).rejects.toThrow(
          "Database returned an invalid messaging inbox",
        );
      }
    }
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
