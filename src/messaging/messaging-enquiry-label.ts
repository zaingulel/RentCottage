import { formatIraqDateTime } from "@/i18n/format";
import type { Locale } from "@/i18n/routing";
import type { MessagingConversationHeader } from "./supabase-messaging-reader";

export function messagingEnquiryLabel(
  item: MessagingConversationHeader,
  locale: Locale,
) {
  return (
    item.booking?.bookingRequestReference ??
    `${item.cottage.name} · ${formatIraqDateTime(item.createdAt, locale)} · ${item.conversationId.slice(-8)}`
  );
}
