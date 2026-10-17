import { ActionLink } from "@/components/interaction-controls";

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
    <section className="administrator-messaging" dir={directionFor(locale)}>
      <header className="page-heading">
        <h1 className="page-title">{copy.moderation}</h1>
      </header>
      <ul className="administrator-moderation-list">
        {moderation.items.map((item) =>
          item.type === "blocked" ? (
            <li
              key={item.attemptId}
              className="card administrator-moderation-card"
            >
              <h2 className="card-title">{copy.blockedAttempts}</h2>
              <p>
                <ActionLink
                  kind="text"
                  href={`/${locale}/messages/${item.conversationId}`}
                >
                  {item.actorRole === "customer" ? copy.customer : copy.owner}
                </ActionLink>{" "}
                · {copy.categories[item.category]} ·{" "}
                {formatIraqDateTime(item.occurredAt, locale)}
              </p>
              <p>
                {copy.blockedAttempts}: {item.conversationBlockedAttemptCount}
              </p>
            </li>
          ) : (
            <li
              key={item.reportId}
              className="card administrator-moderation-card"
            >
              <h2 className="card-title">{copy.translationReports}</h2>
              <ActionLink
                kind="text"
                href={`/${locale}/messages/${item.conversationId}`}
              >
                {copy.categories[item.category]}
              </ActionLink>
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
        <ActionLink
          kind="secondary"
          href={`/${locale}/administrator/messages?at=${encodeURIComponent(moderation.nextCursor.at)}&id=${moderation.nextCursor.id}&type=${moderation.nextCursor.type}`}
        >
          {copy.older}
        </ActionLink>
      ) : null}
    </section>
  );
}
