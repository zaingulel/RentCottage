import { describe, expect, it, vi } from "vitest";

import { SupabaseMessagingRepository } from "./supabase-messaging";

const actorUserId = "11111111-1111-4111-8111-111111111111";
const profileId = "22222222-2222-4222-8222-222222222222";
const conversationId = "33333333-3333-4333-8333-333333333333";
const commandId = "44444444-4444-4444-8444-444444444444";

function clientWith(data: unknown, error: unknown = null) {
  return { rpc: vi.fn().mockResolvedValue({ data, error }) };
}

describe("Supabase messaging repository", () => {
  it("calls the service-only conversation boundary", async () => {
    const client = clientWith({ status: "created", conversationId });
    const repository = new SupabaseMessagingRepository(client as never);

    await expect(
      repository.createConversation({ actorUserId, profileId, commandId }),
    ).resolves.toEqual({ status: "created", conversationId });
    expect(client.rpc).toHaveBeenCalledWith("create_messaging_conversation", {
      target_actor_user_id: actorUserId,
      target_profile_id: profileId,
      target_command_id: commandId,
    });
  });

  it("opens an existing booking only through its retained request reference", async () => {
    const client = clientWith({ status: "created", conversationId });
    const repository = new SupabaseMessagingRepository(client as never);

    await expect(
      repository.openBookingConversation({
        actorUserId,
        bookingRequestReference: "RC-REQ-0123456789ABCDEF",
        commandId,
      }),
    ).resolves.toEqual({ status: "created", conversationId });
    expect(client.rpc).toHaveBeenCalledWith(
      "open_messaging_conversation_for_booking",
      {
        target_actor_user_id: actorUserId,
        target_booking_request_reference: "RC-REQ-0123456789ABCDEF",
        target_command_id: commandId,
      },
    );
  });

  it("passes original content to the database without a client safety verdict", async () => {
    const client = clientWith({
      status: "blocked",
      reason: "contact-restricted",
    });
    const repository = new SupabaseMessagingRepository(client as never);

    await expect(
      repository.send({
        actorUserId,
        conversationId,
        commandId,
        originalLanguage: "ar",
        originalBody: "+964 750 123 4567",
      }),
    ).resolves.toEqual({
      status: "blocked",
      reason: "contact-restricted",
    });
    expect(client.rpc).toHaveBeenCalledWith("admit_messaging_message", {
      target_actor_user_id: actorUserId,
      target_conversation_id: conversationId,
      target_command_id: commandId,
      target_original_language: "ar",
      target_original_body: "+964 750 123 4567",
    });
    expect(client.rpc.mock.calls[0]?.[1]).not.toHaveProperty("safe");
  });

  it("fails closed for malformed database results", async () => {
    const repository = new SupabaseMessagingRepository(
      clientWith({ status: "sent", messageId: "not-a-uuid" }) as never,
    );

    await expect(
      repository.send({
        actorUserId,
        conversationId,
        commandId,
        originalLanguage: "en",
        originalBody: "Please prepare the garden.",
      }),
    ).rejects.toThrow(/invalid messaging result/i);
  });

  it("uses exact-provenance translation and report boundaries", async () => {
    const translationId = "66666666-6666-4666-8666-666666666666";
    const reportId = "77777777-7777-4777-8777-777777777777";
    const client = clientWith({ status: "prepared" });
    client.rpc
      .mockResolvedValueOnce({
        data: {
          status: "prepared",
          messageId: "55555555-5555-4555-8555-555555555555",
          originalLanguage: "en",
          originalBody: "Could we use the garden?",
          contactProtected: true,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          status: "translated",
          translationId,
          translatedBody: "هل يمكننا استخدام الحديقة؟",
          targetLanguage: "ar",
          provider: "fictional-local-test",
          model: "deterministic-pairs-v1",
          promptVersion: "message-pairs-v1",
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { status: "reported", reportId },
        error: null,
      });
    const repository = new SupabaseMessagingRepository(client as never);
    const messageId = "55555555-5555-4555-8555-555555555555";

    await repository.prepare({ actorUserId, messageId, targetLanguage: "ar" });
    await repository.save({
      actorUserId,
      messageId,
      targetLanguage: "ar",
      translatedBody: "هل يمكننا استخدام الحديقة؟",
    });
    await repository.report({
      actorUserId,
      translationId,
      commandId,
      category: "incorrect",
    });

    expect(client.rpc.mock.calls).toEqual([
      [
        "prepare_messaging_translation",
        expect.objectContaining({
          target_actor_user_id: actorUserId,
          target_message_id: messageId,
          target_language: "ar",
          target_provider: "fictional-local-test",
          target_model: "deterministic-pairs-v1",
          target_prompt_version: "message-pairs-v1",
        }),
      ],
      [
        "save_messaging_translation",
        expect.objectContaining({
          target_translated_body: "هل يمكننا استخدام الحديقة؟",
        }),
      ],
      [
        "report_messaging_translation",
        {
          target_actor_user_id: actorUserId,
          target_translation_id: translationId,
          target_command_id: commandId,
          target_category: "incorrect",
        },
      ],
    ]);
  });
});
