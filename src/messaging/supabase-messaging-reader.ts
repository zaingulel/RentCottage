import type { SupabaseClient } from "@supabase/supabase-js";

import {
  isBookingRequestStatus,
  type BookingRequestStatus,
} from "@/booking-request/booking-request-status";
import { isLocale, type Locale } from "@/i18n/routing";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const requestReference = /^RC-REQ-[A-F0-9]{16}$/;
const paymentStatuses = [
  "capture-processing",
  "payment-required",
  "paid-confirmed",
] as const;

type PaymentStatus = (typeof paymentStatuses)[number] | null;
type ActorRole = "customer" | "cottage_owner" | "platform_administrator";

export interface MessagingBookingSummary {
  readonly bookingRequestReference: string;
  readonly requestStatus: BookingRequestStatus;
  readonly paymentStatus: PaymentStatus;
  readonly responseDeadline: string;
  readonly firstStartsAt: string | null;
  readonly lastEndsAt: string | null;
  readonly writingClosesAt: string | null;
  readonly writingClosed: boolean;
  readonly contactAllowed: boolean;
}

export interface MessagingConversationHeader {
  readonly conversationId: string;
  readonly cottage: {
    readonly profileId: string;
    readonly name: string;
    readonly publicSlug: string | null;
  };
  readonly actorRole: ActorRole;
  readonly createdAt: string;
  readonly canContinueBookingRequest: boolean;
  readonly booking: MessagingBookingSummary | null;
  readonly bookingHistory: readonly MessagingBookingSummary[];
  readonly messageCount: number;
}

export interface MessagingConversation extends MessagingConversationHeader {
  readonly messages: readonly {
    readonly messageId: string;
    readonly senderRole: "customer" | "cottage_owner";
    readonly originalLanguage: Locale;
    readonly originalBody: string;
    readonly contactProtected: boolean;
    readonly translations: readonly {
      readonly translationId: string;
      readonly targetLanguage: Locale;
      readonly translatedBody: string;
      readonly provider: "fictional-local-test";
      readonly model: "deterministic-pairs-v1";
      readonly promptVersion: "message-pairs-v1";
    }[];
    readonly sentAt: string;
  }[];
  readonly nextMessageCursor: number | null;
}

export interface MessagingInboxItem extends MessagingConversationHeader {
  readonly activityAt: string;
  readonly preview: {
    readonly originalLanguage: Locale;
    readonly originalBody: string;
  } | null;
}

export interface MessagingModeration {
  readonly items: readonly (
    | {
        readonly type: "blocked";
        readonly attemptId: string;
        readonly conversationId: string;
        readonly category: "contact";
        readonly actorRole: "customer" | "cottage_owner";
        readonly conversationBlockedAttemptCount: number;
        readonly occurredAt: string;
      }
    | {
        readonly type: "translation-report";
        readonly reportId: string;
        readonly conversationId: string;
        readonly category: "incorrect" | "unclear" | "inappropriate";
        readonly originalLanguage: Locale;
        readonly originalBody: string;
        readonly targetLanguage: Locale;
        readonly translatedBody: string;
        readonly provider: "fictional-local-test";
        readonly model: "deterministic-pairs-v1";
        readonly promptVersion: "message-pairs-v1";
        readonly reportedAt: string;
      }
  )[];
  readonly nextCursor: {
    readonly at: string;
    readonly id: string;
    readonly type: "blocked" | "translation-report";
  } | null;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function nullableTimestamp(value: unknown): value is string | null {
  return value === null || isTimestamp(value);
}

function bookingFrom(value: unknown): MessagingBookingSummary | undefined {
  const row = record(value);
  if (
    !row ||
    !requestReference.test(String(row.bookingRequestReference)) ||
    !isBookingRequestStatus(row.requestStatus) ||
    !(
      row.paymentStatus === null ||
      paymentStatuses.includes(row.paymentStatus as never)
    ) ||
    !isTimestamp(row.responseDeadline) ||
    !nullableTimestamp(row.firstStartsAt) ||
    !nullableTimestamp(row.lastEndsAt) ||
    !nullableTimestamp(row.writingClosesAt) ||
    typeof row.writingClosed !== "boolean" ||
    typeof row.contactAllowed !== "boolean" ||
    (row.paymentStatus === "paid-confirmed" &&
      (row.firstStartsAt === null ||
        row.lastEndsAt === null ||
        row.writingClosesAt === null))
  ) {
    return undefined;
  }
  return row as unknown as MessagingBookingSummary;
}

function headerFrom(value: unknown): MessagingConversationHeader | undefined {
  const row = record(value);
  const cottage = record(row?.cottage);
  const booking = row?.booking === null ? null : bookingFrom(row?.booking);
  const bookingHistory = Array.isArray(row?.bookingHistory)
    ? row.bookingHistory.map(bookingFrom)
    : [];
  if (
    !row ||
    typeof row.conversationId !== "string" ||
    !uuid.test(row.conversationId) ||
    !cottage ||
    typeof cottage.profileId !== "string" ||
    !uuid.test(cottage.profileId) ||
    typeof cottage.name !== "string" ||
    cottage.name.length < 1 ||
    !(cottage.publicSlug === null || typeof cottage.publicSlug === "string") ||
    !["customer", "cottage_owner", "platform_administrator"].includes(
      String(row.actorRole),
    ) ||
    !isTimestamp(row.createdAt) ||
    typeof row.canContinueBookingRequest !== "boolean" ||
    booking === undefined ||
    !Array.isArray(row.bookingHistory) ||
    bookingHistory.some((item) => item === undefined) ||
    !Number.isSafeInteger(row.messageCount) ||
    (row.messageCount as number) < 0
  ) {
    return undefined;
  }
  return {
    conversationId: row.conversationId,
    cottage: cottage as MessagingConversationHeader["cottage"],
    actorRole: row.actorRole as ActorRole,
    createdAt: row.createdAt,
    canContinueBookingRequest: row.canContinueBookingRequest,
    booking,
    bookingHistory: bookingHistory as MessagingBookingSummary[],
    messageCount: row.messageCount as number,
  };
}

function conversationFrom(value: unknown): MessagingConversation | undefined {
  const row = record(value);
  const header = headerFrom(row);
  if (!row || !header || !Array.isArray(row.messages)) return undefined;
  const messages = row.messages.map((value) => {
    const message = record(value);
    const translations = Array.isArray(message?.translations)
      ? message.translations.map((value) => {
          const translation = record(value);
          if (
            !translation ||
            typeof translation.translationId !== "string" ||
            !uuid.test(translation.translationId) ||
            typeof translation.targetLanguage !== "string" ||
            !isLocale(translation.targetLanguage) ||
            typeof translation.translatedBody !== "string" ||
            translation.provider !== "fictional-local-test" ||
            translation.model !== "deterministic-pairs-v1" ||
            translation.promptVersion !== "message-pairs-v1"
          ) {
            return undefined;
          }
          return translation as unknown as MessagingConversation["messages"][number]["translations"][number];
        })
      : [];
    if (
      !message ||
      typeof message.messageId !== "string" ||
      !uuid.test(message.messageId) ||
      !["customer", "cottage_owner"].includes(String(message.senderRole)) ||
      typeof message.originalLanguage !== "string" ||
      !isLocale(message.originalLanguage) ||
      typeof message.originalBody !== "string" ||
      message.originalBody.length < 1 ||
      typeof message.contactProtected !== "boolean" ||
      !Array.isArray(message.translations) ||
      translations.some((translation) => translation === undefined) ||
      !isTimestamp(message.sentAt)
    ) {
      return undefined;
    }
    return {
      ...message,
      translations,
    } as unknown as MessagingConversation["messages"][number];
  });
  if (
    messages.some((message) => message === undefined) ||
    !(
      row.nextMessageCursor === null ||
      (Number.isSafeInteger(row.nextMessageCursor) &&
        (row.nextMessageCursor as number) > 0)
    )
  ) {
    return undefined;
  }
  return {
    ...header,
    messages: messages as MessagingConversation["messages"],
    nextMessageCursor: row.nextMessageCursor as number | null,
  };
}

export class SupabaseMessagingReader {
  constructor(private readonly client: SupabaseClient) {}

  async getConversation(input: {
    readonly conversationId: string;
    readonly beforePosition?: number;
    readonly limit: number;
    readonly publicSlug?: string;
  }): Promise<MessagingConversation> {
    const { data, error } = await this.client.rpc(
      "get_messaging_conversation",
      {
        target_conversation_id: input.conversationId,
        target_before_position: input.beforePosition ?? null,
        target_limit: input.limit,
      },
    );
    const conversation = conversationFrom(data);
    if (error || !conversation) {
      throw new Error("Database returned an invalid messaging conversation");
    }
    return conversation;
  }

  async listConversations(input: {
    readonly cursor?: {
      readonly activityAt: string;
      readonly conversationId: string;
    };
    readonly limit: number;
    readonly publicSlug?: string;
  }): Promise<{
    readonly items: readonly MessagingInboxItem[];
    readonly nextCursor: {
      readonly activityAt: string;
      readonly conversationId: string;
    } | null;
  }> {
    const { data, error } = await this.client.rpc(
      "list_messaging_conversations",
      {
        target_cursor_activity_at: input.cursor?.activityAt ?? null,
        target_cursor_conversation_id: input.cursor?.conversationId ?? null,
        target_limit: input.limit,
        target_public_slug: input.publicSlug ?? null,
      },
    );
    const page = record(data);
    const cursor = page?.nextCursor === null ? null : record(page?.nextCursor);
    const items = Array.isArray(page?.items)
      ? page.items.map((value) => {
          const row = record(value);
          const header = headerFrom(row);
          const preview = row?.preview === null ? null : record(row?.preview);
          if (
            !row ||
            !header ||
            !isTimestamp(row.activityAt) ||
            !(
              preview === null ||
              (preview &&
                typeof preview.originalLanguage === "string" &&
                isLocale(preview.originalLanguage) &&
                typeof preview.originalBody === "string")
            )
          ) {
            return undefined;
          }
          return {
            ...header,
            activityAt: row.activityAt,
            preview: preview as MessagingInboxItem["preview"],
          };
        })
      : [];
    if (
      error ||
      !page ||
      !Array.isArray(page.items) ||
      items.some((item) => item === undefined) ||
      !(
        cursor === null ||
        (cursor &&
          isTimestamp(cursor.activityAt) &&
          typeof cursor.conversationId === "string" &&
          uuid.test(cursor.conversationId))
      )
    ) {
      throw new Error("Database returned an invalid messaging inbox");
    }
    return {
      items: items as MessagingInboxItem[],
      nextCursor: cursor as {
        activityAt: string;
        conversationId: string;
      } | null,
    };
  }

  async getModeration(input: {
    readonly limit: number;
    readonly cursor?: MessagingModeration["nextCursor"];
  }): Promise<MessagingModeration> {
    const { data, error } = await this.client.rpc("get_messaging_moderation", {
      target_cursor_at: input.cursor?.at ?? null,
      target_cursor_id: input.cursor?.id ?? null,
      target_cursor_type: input.cursor?.type ?? null,
      target_limit: input.limit,
    });
    const result = record(data);
    const items = Array.isArray(result?.items)
      ? result.items.map((value) => {
          const row = record(value);
          if (row?.type === "blocked") {
            return typeof row.attemptId === "string" &&
              uuid.test(row.attemptId) &&
              typeof row.conversationId === "string" &&
              uuid.test(row.conversationId) &&
              row.category === "contact" &&
              ["customer", "cottage_owner"].includes(String(row.actorRole)) &&
              Number.isSafeInteger(row.conversationBlockedAttemptCount) &&
              (row.conversationBlockedAttemptCount as number) > 0 &&
              isTimestamp(row.occurredAt)
              ? (row as unknown as MessagingModeration["items"][number])
              : undefined;
          }
          return row?.type === "translation-report" &&
            typeof row.reportId === "string" &&
            uuid.test(row.reportId) &&
            typeof row.conversationId === "string" &&
            uuid.test(row.conversationId) &&
            ["incorrect", "unclear", "inappropriate"].includes(
              String(row.category),
            ) &&
            typeof row.originalLanguage === "string" &&
            isLocale(row.originalLanguage) &&
            typeof row.originalBody === "string" &&
            typeof row.targetLanguage === "string" &&
            isLocale(row.targetLanguage) &&
            typeof row.translatedBody === "string" &&
            row.provider === "fictional-local-test" &&
            row.model === "deterministic-pairs-v1" &&
            row.promptVersion === "message-pairs-v1" &&
            isTimestamp(row.reportedAt)
            ? (row as unknown as MessagingModeration["items"][number])
            : undefined;
        })
      : [];
    const cursor =
      result?.nextCursor === null ? null : record(result?.nextCursor);
    if (
      error ||
      !result ||
      !Array.isArray(result.items) ||
      items.some((item) => !item) ||
      !(
        cursor === null ||
        (cursor &&
          isTimestamp(cursor.at) &&
          typeof cursor.id === "string" &&
          uuid.test(cursor.id) &&
          ["blocked", "translation-report"].includes(String(cursor.type)))
      )
    ) {
      throw new Error("Database returned invalid messaging moderation");
    }
    return {
      items: items as MessagingModeration["items"],
      nextCursor: cursor as MessagingModeration["nextCursor"],
    };
  }
}
