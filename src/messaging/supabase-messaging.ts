import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  CreateConversationResult,
  MessagingRepository,
  SendMessageResult,
} from "./messaging";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function exactKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).sort().join("|") === keys.sort().join("|");
}

function createResult(value: unknown): CreateConversationResult {
  if (!value || typeof value !== "object") {
    throw new Error("Database returned an invalid messaging result");
  }
  const row = value as Record<string, unknown>;
  if (
    row.status === "created" &&
    exactKeys(row, ["status", "conversationId"]) &&
    typeof row.conversationId === "string" &&
    uuid.test(row.conversationId)
  ) {
    return { status: "created", conversationId: row.conversationId };
  }
  if (
    ["invalid", "access-required"].includes(String(row.status)) &&
    exactKeys(row, ["status"])
  ) {
    return { status: row.status as "invalid" | "access-required" };
  }
  throw new Error("Database returned an invalid messaging result");
}

function sendResult(value: unknown): SendMessageResult {
  if (!value || typeof value !== "object") {
    throw new Error("Database returned an invalid messaging result");
  }
  const row = value as Record<string, unknown>;
  if (
    row.status === "sent" &&
    exactKeys(row, ["status", "messageId"]) &&
    typeof row.messageId === "string" &&
    uuid.test(row.messageId)
  ) {
    return { status: "sent", messageId: row.messageId };
  }
  if (
    row.status === "blocked" &&
    row.reason === "contact-restricted" &&
    exactKeys(row, ["status", "reason"])
  ) {
    return { status: "blocked", reason: "contact-restricted" };
  }
  if (
    ["invalid", "access-required", "read-only", "retry"].includes(
      String(row.status),
    ) &&
    exactKeys(row, ["status"])
  ) {
    return {
      status: row.status as
        | "invalid"
        | "access-required"
        | "read-only"
        | "retry",
    };
  }
  throw new Error("Database returned an invalid messaging result");
}

export class SupabaseMessagingRepository implements MessagingRepository {
  constructor(private readonly client: SupabaseClient) {}

  async createConversation(
    input: Parameters<MessagingRepository["createConversation"]>[0],
  ) {
    const { data, error } = await this.client.rpc(
      "create_messaging_conversation",
      {
        target_actor_user_id: input.actorUserId,
        target_profile_id: input.profileId,
        target_command_id: input.commandId,
      },
    );
    if (error) throw new Error("Messaging is unavailable");
    return createResult(data);
  }

  async send(input: Parameters<MessagingRepository["send"]>[0]) {
    const { data, error } = await this.client.rpc("admit_messaging_message", {
      target_actor_user_id: input.actorUserId,
      target_conversation_id: input.conversationId,
      target_command_id: input.commandId,
      target_original_language: input.originalLanguage,
      target_original_body: input.originalBody,
    });
    if (error) throw new Error("Messaging is unavailable");
    return sendResult(data);
  }
}
