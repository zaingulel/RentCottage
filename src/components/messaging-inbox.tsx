import Link from "next/link";
import { ActionFocusTarget } from "./interaction-controls";
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
  navigationFocus = true,
}: {
  readonly locale: Locale;
  readonly items: readonly MessagingInboxItem[];
  readonly nextCursor: {
    readonly activityAt: string;
    readonly conversationId: string;
  } | null;
  readonly publicSlug?: string;
  readonly contextQuery?: string;
  readonly navigationFocus?: boolean;
}) {
  const copy = messagingMessages[locale];
  return (
    <section className="messaging-shell" dir={directionFor(locale)}>
      <h1
        id="messaging-inbox-title"
        tabIndex={-1}
        className="page-title action-focus-target"
      >
        {copy.inbox}
      </h1>
      {navigationFocus && (
        <ActionFocusTarget targetId="messaging-inbox-title" navigation />
      )}
      {items.length === 0 ? (
        <p>{copy.empty}</p>
      ) : (
        <ul className="list-rows">
          {items.map((item) => (
            <li key={item.conversationId}>
              <Link
                className="list-row-title"
                href={`/${locale}/messages/${item.conversationId}${contextQuery ? `?${contextQuery}` : ""}`}
              >
                {item.cottage.name}
              </Link>
              <p className="list-row-meta">
                {item.booking ? (
                  <>
                    <bdi>{item.booking.bookingRequestReference}</bdi>
                    <span className="status-badge">
                      {
                        bookingRequestDisplayStatusMessages[locale][
                          item.booking.paymentStatus ??
                            item.booking.requestStatus
                        ]
                      }
                    </span>
                  </>
                ) : null}
                <time dateTime={item.activityAt}>
                  {formatIraqDateTime(item.activityAt, locale)}
                </time>
              </p>
              <p className="list-row-meta">
                <bdi
                  lang={item.preview?.originalLanguage ?? locale}
                  dir={directionFor(item.preview?.originalLanguage ?? locale)}
                >
                  {item.preview?.originalBody ?? copy.emptyMessages}
                </bdi>
              </p>
            </li>
          ))}
        </ul>
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
