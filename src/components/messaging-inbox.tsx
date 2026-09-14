import Link from "next/link";
import { bookingRequestDisplayStatusMessages } from "@/i18n/booking-request-status-messages";

import { formatIraqDateTime } from "@/i18n/format";
import { messagingMessages } from "@/i18n/messaging-messages";
import { directionFor, type Locale } from "@/i18n/routing";
import type { MessagingInboxItem } from "@/messaging/supabase-messaging-reader";

export function MessagingInbox({
  locale,
  items,
  nextCursor,
  publicSlug,
  contextQuery,
}: {
  readonly locale: Locale;
  readonly items: readonly MessagingInboxItem[];
  readonly nextCursor: {
    readonly activityAt: string;
    readonly conversationId: string;
  } | null;
  readonly publicSlug?: string;
  readonly contextQuery?: string;
}) {
  const copy = messagingMessages[locale];
  return (
    <section className="messaging-shell" dir={directionFor(locale)}>
      <h1>{copy.inbox}</h1>
      {items.length === 0 ? (
        <p>{copy.empty}</p>
      ) : (
        <ol className="messaging-inbox-list">
          {items.map((item) => (
            <li key={item.conversationId}>
              <Link
                href={`/${locale}/messages/${item.conversationId}${contextQuery ? `?${contextQuery}` : ""}`}
              >
                <strong>{item.cottage.name}</strong>
                {item.booking ? (
                  <span>
                    {item.booking.bookingRequestReference} ·{" "}
                    {
                      bookingRequestDisplayStatusMessages[locale][
                        item.booking.paymentStatus ?? item.booking.requestStatus
                      ]
                    }
                  </span>
                ) : null}
                <span
                  lang={item.preview?.originalLanguage ?? locale}
                  dir={directionFor(item.preview?.originalLanguage ?? locale)}
                >
                  {item.preview?.originalBody ?? copy.emptyMessages}
                </span>
                <time dateTime={item.activityAt}>
                  {formatIraqDateTime(item.activityAt, locale)}
                </time>
              </Link>
            </li>
          ))}
        </ol>
      )}
      {nextCursor ? (
        <Link
          href={`/${locale}/messages?activityAt=${encodeURIComponent(nextCursor.activityAt)}&conversationId=${nextCursor.conversationId}${publicSlug ? `&cottage=${publicSlug}` : ""}${contextQuery ? `&${contextQuery}` : ""}`}
        >
          {copy.older}
        </Link>
      ) : null}
    </section>
  );
}
