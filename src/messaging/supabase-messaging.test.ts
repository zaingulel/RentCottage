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
});
