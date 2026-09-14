import Link from "next/link";

import { formatIraqDateTime } from "@/i18n/format";
import { messagingMessages } from "@/i18n/messaging-messages";
import { directionFor, type Locale } from "@/i18n/routing";
import type { MessagingModeration as Moderation } from "@/messaging/supabase-messaging-reader";

export function MessagingModeration({
  locale,
  moderation,
}: {
  readonly locale: Locale;
  readonly moderation: Moderation;
}) {
  const copy = messagingMessages[locale];
  return (
    <section className="messaging-shell" dir={directionFor(locale)}>
      <h1>{copy.moderation}</h1>
      <ul>
        {moderation.items.map((item) =>
          item.type === "blocked" ? (
            <li key={item.attemptId}>
              <strong>{copy.blockedAttempts}</strong>
              <p>
                <Link href={`/${locale}/messages/${item.conversationId}`}>
                  {item.actorRole === "customer" ? copy.customer : copy.owner}
                </Link>{" "}
                · {copy.categories[item.category]} ·{" "}
                {formatIraqDateTime(item.occurredAt, locale)}
              </p>
              <p>
                {copy.blockedAttempts}: {item.conversationBlockedAttemptCount}
              </p>
            </li>
          ) : (
            <li key={item.reportId}>
              <strong>{copy.translationReports}</strong>
              <Link href={`/${locale}/messages/${item.conversationId}`}>
                {copy.categories[item.category]}
              </Link>
              <p
                lang={item.originalLanguage}
                dir={directionFor(item.originalLanguage)}
              >
                {item.originalBody}
              </p>
              <p className="translation-label">
                {copy.automaticTranslation} · {copy.fictionalTranslation}
              </p>
              <p
                lang={item.targetLanguage}
                dir={directionFor(item.targetLanguage)}
              >
                {item.translatedBody}
              </p>
              <small>
                {item.provider} · {item.model} · {item.promptVersion}
              </small>
            </li>
          ),
        )}
      </ul>
      {moderation.nextCursor ? (
        <Link
          href={`/${locale}/administrator/messages?at=${encodeURIComponent(moderation.nextCursor.at)}&id=${moderation.nextCursor.id}&type=${moderation.nextCursor.type}`}
        >
          {copy.older}
        </Link>
      ) : null}
    </section>
  );
}
