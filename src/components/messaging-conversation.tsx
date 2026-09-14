"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { formatIraqDateTime } from "@/i18n/format";
import { messagingMessages } from "@/i18n/messaging-messages";
import { bookingRequestDisplayStatusMessages } from "@/i18n/booking-request-status-messages";
import { directionFor, type Locale } from "@/i18n/routing";
import {
  reportMessagingTranslation,
  sendMessagingMessage,
  translateMessagingMessage,
} from "@/messaging/actions";
import type { MessagingConversation as Conversation } from "@/messaging/supabase-messaging-reader";
import { LocaleLinks } from "./locale-links";
import {
  ActionButton,
  ActionFeedback,
  FormControl,
} from "./interaction-controls";

type Translation = Conversation["messages"][number]["translations"][number];

export function MessagingConversation({
  locale,
  conversation,
  beforePosition,
  contextQuery,
}: {
  readonly locale: Locale;
  readonly conversation: Conversation;
  readonly beforePosition?: number;
  readonly contextQuery?: string;
}) {
  const copy = messagingMessages[locale];
  const router = useRouter();
  const [body, setBody] = useState("");
  const [sourceLanguage, setSourceLanguage] = useState<Locale>(locale);
  const [sendCommandId, setSendCommandId] = useState(() => crypto.randomUUID());
  const [feedback, setFeedback] = useState<string>();
  const [pending, startTransition] = useTransition();
  const [translationOverrides, setTranslationOverrides] = useState<
    Record<string, Translation>
  >({});
  const [showOriginal, setShowOriginal] = useState<Record<string, boolean>>({});
  const [translationFeedback, setTranslationFeedback] = useState<
    Record<string, string>
  >({});
  const reportCommands = useRef<Record<string, string>>({});
  const [reported, setReported] = useState<Record<string, boolean>>({});
  const [forcedReadOnly, setForcedReadOnly] = useState(false);

  function send() {
    const originalBody = body;
    startTransition(async () => {
      const result = await sendMessagingMessage({
        locale,
        conversationId: conversation.conversationId,
        commandId: sendCommandId,
        originalLanguage: sourceLanguage,
        originalBody,
      });
      if (result.status === "sent") {
        setBody("");
        setFeedback("");
        setSendCommandId(crypto.randomUUID());
        router.push(
          `/${locale}/messages/${conversation.conversationId}${contextQuery ? `?${contextQuery}` : ""}`,
        );
        router.refresh();
      } else if (result.status === "blocked") {
        setFeedback(copy.blocked);
        setSendCommandId(crypto.randomUUID());
      } else {
        setFeedback(
          result.status === "read-only" ? copy.readOnly : copy.unavailable,
        );
        if (result.status === "read-only") {
          setForcedReadOnly(true);
          router.refresh();
        }
      }
    });
  }

  function translate(messageId: string) {
    startTransition(async () => {
      const result = await translateMessagingMessage({
        locale,
        messageId,
        targetLanguage: locale,
      });
      if (result.status === "translated") {
        setTranslationOverrides((current) => ({
          ...current,
          [messageId]: result,
        }));
        setShowOriginal((current) => ({ ...current, [messageId]: false }));
        setTranslationFeedback((current) => ({ ...current, [messageId]: "" }));
      } else {
        setTranslationFeedback((current) => ({
          ...current,
          [messageId]: copy.translationUnavailable,
        }));
      }
    });
  }

  function report(translation: Translation) {
    const commandId =
      reportCommands.current[translation.translationId] ?? crypto.randomUUID();
    reportCommands.current[translation.translationId] = commandId;
    startTransition(async () => {
      const result = await reportMessagingTranslation({
        translationId: translation.translationId,
        commandId,
        category: "incorrect",
      });
      setTranslationFeedback((current) => ({
        ...current,
        [translation.translationId]:
          result.status === "reported" ? "" : copy.unavailable,
      }));
      if (result.status === "reported") {
        setReported((current) => ({
          ...current,
          [translation.translationId]: true,
        }));
      }
    });
  }

  const canMutate = conversation.actorRole !== "platform_administrator";
  const readOnly =
    forcedReadOnly || (conversation.booking?.writingClosed ?? false);
  const detailQuery = [
    beforePosition ? `before=${beforePosition}` : "",
    contextQuery ?? "",
  ]
    .filter(Boolean)
    .join("&");
  const scopedInboxQuery =
    conversation.cottage.publicSlug && contextQuery
      ? `cottage=${conversation.cottage.publicSlug}&${contextQuery}`
      : "";
  return (
    <section className="messaging-shell" dir={directionFor(locale)}>
      <header className="messaging-conversation-header">
        <Link
          href={`/${locale}/messages${scopedInboxQuery ? `?${scopedInboxQuery}` : ""}`}
        >
          {copy.inbox}
        </Link>
        <LocaleLinks
          locale={locale}
          path={`/messages/${conversation.conversationId}`}
          queryString={detailQuery}
        />
        <p>{copy.conversation}</p>
        <h1>{conversation.cottage.name}</h1>
        {conversation.booking ? (
          <dl>
            <div>
              <dt>{copy.booking}</dt>
              <dd>
                {conversation.booking.bookingRequestReference} ·{" "}
                {
                  bookingRequestDisplayStatusMessages[locale][
                    conversation.booking.paymentStatus ??
                      conversation.booking.requestStatus
                  ]
                }
              </dd>
            </div>
            <div>
              <dt>{copy.responseDeadline}</dt>
              <dd>
                {formatIraqDateTime(
                  conversation.booking.responseDeadline,
                  locale,
                )}
              </dd>
            </div>
            {conversation.booking.firstStartsAt &&
            conversation.booking.lastEndsAt ? (
              <div>
                <dt>{copy.bookedPeriod}</dt>
                <dd>
                  {formatIraqDateTime(
                    conversation.booking.firstStartsAt,
                    locale,
                  )}{" "}
                  –{" "}
                  {formatIraqDateTime(conversation.booking.lastEndsAt, locale)}
                </dd>
              </div>
            ) : null}
            {conversation.booking.writingClosesAt ? (
              <div>
                <dt>{copy.writingDeadline}</dt>
                <dd>
                  {formatIraqDateTime(
                    conversation.booking.writingClosesAt,
                    locale,
                  )}
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}
        {conversation.bookingHistory.length > 1 ? (
          <div>
            <h2>{copy.priorRequests}</h2>
            <ul>
              {conversation.bookingHistory.slice(0, -1).map((booking) => (
                <li key={booking.bookingRequestReference}>
                  {booking.bookingRequestReference} ·{" "}
                  {
                    bookingRequestDisplayStatusMessages[locale][
                      booking.paymentStatus ?? booking.requestStatus
                    ]
                  }
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <p>
          {conversation.booking?.contactAllowed
            ? copy.contactAllowed
            : copy.contactProtected}
        </p>
        {contextQuery &&
        conversation.cottage.publicSlug &&
        conversation.canContinueBookingRequest ? (
          <Link
            href={`/${locale}/request/${conversation.cottage.publicSlug}?${contextQuery}&conversation=${conversation.conversationId}`}
          >
            {copy.booking}
          </Link>
        ) : null}
        <ActionButton
          kind="secondary"
          size="regular"
          type="button"
          onClick={() => router.refresh()}
        >
          {copy.refresh}
        </ActionButton>
      </header>
      <ol className="messaging-history" aria-label={copy.messages}>
        {conversation.messages.map((message) => {
          const translation =
            translationOverrides[message.messageId] ??
            message.translations.find((item) => item.targetLanguage === locale);
          const original = showOriginal[message.messageId] || !translation;
          return (
            <li
              key={message.messageId}
              className={`message-${message.senderRole}`}
            >
              <article>
                <p>
                  {message.senderRole === "customer"
                    ? copy.customer
                    : copy.owner}{" "}
                  · {copy.sourceLanguage}:{" "}
                  {message.originalLanguage.toUpperCase()}
                </p>
                {translation && !original ? (
                  <p className="translation-label">
                    {copy.automaticTranslation} · {copy.fictionalTranslation}
                  </p>
                ) : null}
                <p
                  dir={directionFor(
                    original
                      ? message.originalLanguage
                      : translation.targetLanguage,
                  )}
                >
                  {original ? message.originalBody : translation.translatedBody}
                </p>
                <time dateTime={message.sentAt}>
                  {formatIraqDateTime(message.sentAt, locale)}
                </time>
                {translation ? (
                  <>
                    <ActionButton
                      kind="secondary"
                      size="compact"
                      type="button"
                      onClick={() =>
                        setShowOriginal((current) => ({
                          ...current,
                          [message.messageId]: !original,
                        }))
                      }
                    >
                      {original ? copy.viewTranslation : copy.viewOriginal}
                    </ActionButton>
                    {canMutate && !reported[translation.translationId] ? (
                      <ActionButton
                        kind="secondary"
                        size="compact"
                        type="button"
                        pending={pending}
                        onClick={() => report(translation)}
                      >
                        {copy.reportTranslation}
                      </ActionButton>
                    ) : null}
                  </>
                ) : canMutate && message.originalLanguage !== locale ? (
                  <ActionButton
                    kind="secondary"
                    size="compact"
                    type="button"
                    pending={pending}
                    onClick={() => translate(message.messageId)}
                  >
                    {copy.automaticTranslation}
                  </ActionButton>
                ) : null}
                {reported[translation?.translationId ?? ""] ? (
                  <ActionFeedback kind="success">
                    {copy.reported}
                  </ActionFeedback>
                ) : null}
                {translationFeedback[message.messageId] ? (
                  <ActionFeedback kind="error">
                    {translationFeedback[message.messageId]}
                  </ActionFeedback>
                ) : null}
                {translation &&
                translationFeedback[translation.translationId] ? (
                  <ActionFeedback kind="error">
                    {translationFeedback[translation.translationId]}
                  </ActionFeedback>
                ) : null}
              </article>
            </li>
          );
        })}
      </ol>
      <nav aria-label={copy.messages}>
        {conversation.nextMessageCursor ? (
          <Link
            href={`/${locale}/messages/${conversation.conversationId}?before=${conversation.nextMessageCursor}${contextQuery ? `&${contextQuery}` : ""}`}
          >
            {copy.older}
          </Link>
        ) : null}
        {beforePosition ? (
          <Link
            href={`/${locale}/messages/${conversation.conversationId}${contextQuery ? `?${contextQuery}` : ""}`}
          >
            {copy.newer}
          </Link>
        ) : null}
      </nav>
      {canMutate ? (
        readOnly ? (
          <ActionFeedback kind="error">{copy.readOnly}</ActionFeedback>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
          >
            <label>
              {copy.languageLabel}
              <FormControl
                kind="select"
                disabled={pending}
                value={sourceLanguage}
                onChange={(event) => {
                  setSourceLanguage(event.target.value as Locale);
                  setSendCommandId(crypto.randomUUID());
                }}
              >
                <option value="en">English</option>
                <option value="ar">العربية</option>
                <option value="ckb">کوردی</option>
              </FormControl>
            </label>
            <label>
              {copy.messageLabel}
              <FormControl
                kind="textarea"
                disabled={pending}
                required
                minLength={1}
                maxLength={2000}
                value={body}
                onChange={(event) => {
                  setBody(event.target.value);
                  setSendCommandId(crypto.randomUUID());
                }}
              />
            </label>
            <ActionButton
              kind="primary"
              width="full"
              type="submit"
              pending={pending}
            >
              {pending ? copy.sending : copy.send}
            </ActionButton>
            {feedback ? (
              <ActionFeedback kind="error">{feedback}</ActionFeedback>
            ) : null}
          </form>
        )
      ) : null}
    </section>
  );
}
