import type { Locale } from "@/i18n/routing";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CreateConversationResult =
  | { readonly status: "created"; readonly conversationId: string }
  | { readonly status: "invalid" | "access-required" | "unavailable" };

export type SendMessageResult =
  | { readonly status: "sent"; readonly messageId: string }
  | { readonly status: "blocked"; readonly reason: "contact-restricted" }
  | {
      readonly status:
        | "invalid"
        | "access-required"
        | "read-only"
        | "retry"
        | "unavailable";
    };

export interface MessagingRepository {
  createConversation(input: {
    readonly actorUserId: string;
    readonly profileId: string;
    readonly commandId: string;
  }): Promise<CreateConversationResult>;
  send(input: {
    readonly actorUserId: string;
    readonly conversationId: string;
    readonly commandId: string;
    readonly originalLanguage: Locale;
    readonly originalBody: string;
  }): Promise<SendMessageResult>;
}

export function createMessaging(repository: MessagingRepository) {
  return {
    createConversation(input: {
      readonly actorUserId: string;
      readonly profileId: string;
      readonly commandId: string;
    }): Promise<CreateConversationResult> {
      if (
        !uuid.test(input.actorUserId) ||
        !uuid.test(input.profileId) ||
        !uuid.test(input.commandId)
      ) {
        return Promise.resolve({ status: "invalid" });
      }
      return repository.createConversation(input);
    },
    send(input: {
      readonly actorUserId: string;
      readonly conversationId: string;
      readonly commandId: string;
      readonly originalLanguage: Locale;
      readonly originalBody: string;
    }): Promise<SendMessageResult> {
      const originalBody = input.originalBody.trim();
      if (
        !uuid.test(input.actorUserId) ||
        !uuid.test(input.conversationId) ||
        !uuid.test(input.commandId) ||
        !["en", "ar", "ckb"].includes(input.originalLanguage) ||
        originalBody.length < 1 ||
        originalBody.length > 2_000
      ) {
        return Promise.resolve({ status: "invalid" });
      }
      return repository.send({ ...input, originalBody });
    },
  };
}
