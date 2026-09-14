import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  CreateConversationResult,
  MessagingRepository,
  SendMessageResult,
} from "./messaging";
import {
  messageTranslationProvenance,
  type MessageTranslationRepository,
  type PreparedMessageTranslation,
  type SavedMessageTranslation,
} from "./message-translation";

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

function translationResult(
  value: unknown,
):
  | PreparedMessageTranslation
  | SavedMessageTranslation
  | { status: "invalid" | "access-required" | "blocked" } {
  if (!value || typeof value !== "object") {
    throw new Error("Database returned an invalid message translation result");
  }
  const row = value as Record<string, unknown>;
  if (
    row.status === "prepared" &&
    exactKeys(row, [
      "status",
      "messageId",
      "originalLanguage",
      "originalBody",
      "contactProtected",
    ]) &&
    typeof row.messageId === "string" &&
    uuid.test(row.messageId) &&
    ["en", "ar", "ckb"].includes(String(row.originalLanguage)) &&
    typeof row.originalBody === "string" &&
    typeof row.contactProtected === "boolean"
  ) {
    return row as unknown as PreparedMessageTranslation;
  }
  if (
    row.status === "translated" &&
    exactKeys(row, [
      "status",
      "translationId",
      "translatedBody",
      "targetLanguage",
      "provider",
      "model",
      "promptVersion",
    ]) &&
    typeof row.translationId === "string" &&
    uuid.test(row.translationId) &&
    typeof row.translatedBody === "string" &&
    ["en", "ar", "ckb"].includes(String(row.targetLanguage)) &&
    row.provider === messageTranslationProvenance.provider &&
    row.model === messageTranslationProvenance.model &&
    row.promptVersion === messageTranslationProvenance.promptVersion
  ) {
    return row as unknown as SavedMessageTranslation;
  }
  if (
    ["invalid", "access-required", "blocked"].includes(String(row.status)) &&
    exactKeys(row, ["status"])
  ) {
    return row as { status: "invalid" | "access-required" | "blocked" };
  }
  throw new Error("Database returned an invalid message translation result");
}

function reportResult(
  value: unknown,
): Awaited<ReturnType<MessageTranslationRepository["report"]>> {
  if (!value || typeof value !== "object") {
    throw new Error("Database returned an invalid translation report result");
  }
  const row = value as Record<string, unknown>;
  if (
    row.status === "reported" &&
    exactKeys(row, ["status", "reportId"]) &&
    typeof row.reportId === "string" &&
    uuid.test(row.reportId)
  ) {
    return { status: "reported", reportId: row.reportId };
  }
  if (
    ["invalid", "access-required"].includes(String(row.status)) &&
    exactKeys(row, ["status"])
  ) {
    return row as { status: "invalid" | "access-required" };
  }
  throw new Error("Database returned an invalid translation report result");
}

export class SupabaseMessagingRepository
  implements MessagingRepository, MessageTranslationRepository
{
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

  async openBookingConversation(
    input: Parameters<MessagingRepository["openBookingConversation"]>[0],
  ) {
    const { data, error } = await this.client.rpc(
      "open_messaging_conversation_for_booking",
      {
        target_actor_user_id: input.actorUserId,
        target_booking_request_reference: input.bookingRequestReference,
        target_command_id: input.commandId,
      },
    );
    if (error) throw new Error("Messaging is unavailable");
    return createResult(data);
  }

  async createConversationForCottage(input: {
    readonly actorUserId: string;
    readonly publicSlug: string;
    readonly commandId: string;
  }) {
    const { data, error } = await this.client.rpc(
      "create_messaging_conversation_for_cottage",
      {
        target_actor_user_id: input.actorUserId,
        target_public_slug: input.publicSlug,
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

  async prepare(input: Parameters<MessageTranslationRepository["prepare"]>[0]) {
    const { data, error } = await this.client.rpc(
      "prepare_messaging_translation",
      {
        target_actor_user_id: input.actorUserId,
        target_message_id: input.messageId,
        target_language: input.targetLanguage,
        target_provider: messageTranslationProvenance.provider,
        target_model: messageTranslationProvenance.model,
        target_prompt_version: messageTranslationProvenance.promptVersion,
      },
    );
    if (error) throw new Error("Message translation is unavailable");
    const result = translationResult(data);
    if (result.status === "blocked") {
      throw new Error(
        "Database returned an invalid message translation result",
      );
    }
    return result as Awaited<
      ReturnType<MessageTranslationRepository["prepare"]>
    >;
  }

  async save(input: Parameters<MessageTranslationRepository["save"]>[0]) {
    const { data, error } = await this.client.rpc(
      "save_messaging_translation",
      {
        target_actor_user_id: input.actorUserId,
        target_message_id: input.messageId,
        target_language: input.targetLanguage,
        target_provider: messageTranslationProvenance.provider,
        target_model: messageTranslationProvenance.model,
        target_prompt_version: messageTranslationProvenance.promptVersion,
        target_translated_body: input.translatedBody,
      },
    );
    if (error) throw new Error("Message translation is unavailable");
    return translationResult(data) as Awaited<
      ReturnType<MessageTranslationRepository["save"]>
    >;
  }

  async report(input: Parameters<MessageTranslationRepository["report"]>[0]) {
    const { data, error } = await this.client.rpc(
      "report_messaging_translation",
      {
        target_actor_user_id: input.actorUserId,
        target_translation_id: input.translationId,
        target_command_id: input.commandId,
        target_category: input.category,
      },
    );
    if (error) throw new Error("Translation reporting is unavailable");
    return reportResult(data);
  }
}
